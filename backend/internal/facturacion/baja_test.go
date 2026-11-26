package facturacion

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
	"mjbj/internal/fiscal"
	"mjbj/internal/sqlc"
)

// gomez es un responsable inscripto con ficha y cuenta corriente: sus
// facturas manuales le cargan la deuda con la etiqueta como referencia.
func gomez() map[string]string {
	return map[string]string{"receptorNombre": "Gómez SRL", "receptorCuit": "30-71234567-1", "receptorCondicionIva": "responsable_inscripto",
		"guardarComoCliente": "on"}
}

func conFichaDeGomez(t *testing.T, e *entorno) string {
	t.Helper()
	var id string
	e.uno(t, `INSERT INTO customers (nombre, cuit, condicion_iva, limite_credito) VALUES ('Gómez SRL', '30712345671', 'responsable_inscripto', 100000000) RETURNING id`, &id)
	return id
}

func emitirA(t *testing.T, e *entorno, admin *http.Client, precio string) string {
	t.Helper()
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(gomez(), [4]string{"Fenólico", "1", precio, "21"}))
	if st != 200 {
		t.Fatalf("emitir: %d %s", st, b)
	}
	return leerJSON[map[string]string](t, b)["invoiceId"]
}

// darDeBaja confirma la baja con la lista de corridos que muestra la ficha
// en ese momento, como el formulario.
func darDeBaja(t *testing.T, e *entorno, admin *http.Client, id string) (int, string) {
	t.Helper()
	vistos := []string{}
	if serie, err := e.s.Serie(context.Background(), id); err == nil {
		for _, k := range serie.Corren {
			vistos = append(vistos, k.InvoiceID)
		}
	}
	return darDeBajaViendo(t, admin, e, id, vistos)
}

func darDeBajaViendo(t *testing.T, admin *http.Client, e *entorno, id string, vistos []string) (int, string) {
	t.Helper()
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/baja",
		map[string]any{"motivo": "Rechazado por ARCA", "corren": vistos})
	return st, string(b)
}

// **Anular o hacer notas sobre algo sin CAE trababa la serie.** El
// comprobante quedaba «anulado sin CAE»: ARCA seguía esperando ese número y
// el siguiente de la serie no se autorizaba nunca. Sin CAE no hay nada que
// anular: se da de baja.
func TestSinCAENoSeAnulaNiLlevaNotas(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	conFichaDeGomez(t, e)
	id := emitirA(t, e, admin, "12100")
	base := e.srv.URL + "/api/v1/admin/facturacion/comprobantes/" + id
	c, _ := e.s.Obtener(context.Background(), id)
	for nombre, intento := range map[string]func() (int, []byte){
		"anular": func() (int, []byte) {
			return pedir(t, admin, "POST", base+"/anular", map[string]string{"motivo": "Error de carga"})
		},
		"crédito": func() (int, []byte) {
			return pedir(t, admin, "POST", base+"/nota-de-credito", map[string]any{"motivo": "Devolvió una",
				"parciales": []map[string]any{{"itemId": c.Items[0].ID, "cantidad": 1}}})
		},
		"débito": func() (int, []byte) {
			return pedir(t, admin, "POST", base+"/nota-de-debito", map[string]any{"motivo": "Flete olvidado", "concepto": "Flete", "importe": 5000, "alicuota": 21})
		},
	} {
		st, b := intento()
		if st != 422 || !strings.Contains(string(b), sinCAE) {
			t.Errorf("%s sin CAE: %d %s", nombre, st, b)
		}
	}
	var estado string
	var notas int
	e.uno(t, `SELECT estado::text FROM invoices WHERE id = $1`, &estado, id)
	e.uno(t, `SELECT count(*)::int FROM invoices WHERE comprobante_origen_id = $1`, &notas, id)
	if estado != "emitida" || notas != 0 {
		t.Fatalf("quedó %s con %d notas", estado, notas)
	}
	// Ya acreditada entera por notas viejas: el atajo de Anular también mira el CAE.
	e.exec(t, `INSERT INTO invoices (tipo, punto_venta, numero, estado, receptor_nombre, comprobante_origen_id, total)
		VALUES ('nota_credito_a', 3, 1, 'emitida', 'Gómez SRL', $1, 12100)`, id)
	if _, err := e.s.Anular(context.Background(), id, "Error de carga", nil); Mensaje(err) != sinCAE {
		t.Fatalf("atajo de anular: %v", err)
	}
}

// **La baja del 3 de 5.** El 3 sale de la serie y el 5, el último, pasa a
// 3; el 4 se queda con su número (H235). El próximo que se emita es el 5. La deuda del 3 se va con él y los
// movimientos de los corridos cambian de etiqueta, sin que la cuenta muestre
// dos «0003». Lo que era queda en el listado, con a quién se le corrió el
// número.
func TestBajaDelTerceroDeCinco(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	cliente := conFichaDeGomez(t, e)
	var ids []string
	for _, p := range []string{"1000", "2000", "3000", "4000", "5000"} {
		ids = append(ids, emitirA(t, e, admin, p))
	}
	// El 1 y el 2 salieron; el 3 lo rechazó ARCA; el 4 y el 5 esperan.
	e.exec(t, `UPDATE invoices SET cae = '7' || numero, estado = 'autorizada' WHERE numero <= 2`)
	e.exec(t, `UPDATE invoices SET estado = 'rechazada', observaciones_arca = '[10013] DocTipo' WHERE id = $1`, ids[2])
	e.exec(t, `INSERT INTO arca_log (invoice_id, operacion, ambiente, solicitud, respuesta) VALUES ($1, 'FECAESolicitar', 'homologacion', '<pedido/>', '<rechazo/>')`, ids[2])

	_, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+ids[2]+"/serie", nil)
	serie := leerJSON[SerieDelComprobante](t, b)
	if serie.Bloqueo != nil || len(serie.Corren) != 1 || serie.Corren[0].De != 5 || serie.Corren[0].A != 3 || serie.AnterioresSinCae != 0 ||
		serie.Deuda != 3000 {
		t.Fatalf("serie: %s", b)
	}
	if st, b := darDeBaja(t, e, admin, ids[2]); st != 200 || !strings.Contains(b, `"etiqueta":"Factura A 0003-00000003"`) {
		t.Fatalf("baja: %d %s", st, b)
	}
	numero := func(id string) int64 {
		var n int64
		e.uno(t, `SELECT numero FROM invoices WHERE id = $1`, &n, id)
		return n
	}
	if numero(ids[3]) != 4 || numero(ids[4]) != 3 {
		t.Fatalf("corridos: %d %d", numero(ids[3]), numero(ids[4]))
	}
	var quedan int
	e.uno(t, `SELECT count(*)::int FROM invoices WHERE id = $1`, &quedan, ids[2])
	if quedan != 0 {
		t.Fatal("el dado de baja sigue")
	}
	var refs string
	e.uno(t, `SELECT string_agg(referencia || ' ' || detalle || ' ' || monto::text, ' | ' ORDER BY monto) FROM account_movements WHERE customer_id = $1`, &refs, cliente)
	if refs != "Factura A 0003-00000001 Factura A 0003-00000001 1000.00 | Factura A 0003-00000002 Factura A 0003-00000002 2000.00 | "+
		"Factura A 0003-00000004 Factura A 0003-00000004 4000.00 | Factura A 0003-00000003 Factura A 0003-00000003 5000.00" {
		t.Fatalf("cuenta corriente: %s", refs)
	}
	// El próximo toma el 5, no el 6.
	nuevo := emitirA(t, e, admin, "100")
	if numero(nuevo) != 5 {
		t.Fatalf("el siguiente: %d", numero(nuevo))
	}
	// La foto: renglones, movimientos y lo que contestó ARCA.
	var renglones, movimientos, arca int
	e.uno(t, `SELECT jsonb_array_length(comprobante->'renglones') FROM invoices_dadas_de_baja`, &renglones)
	e.uno(t, `SELECT jsonb_array_length(comprobante->'movimientos') FROM invoices_dadas_de_baja`, &movimientos)
	e.uno(t, `SELECT jsonb_array_length(comprobante->'arca') FROM invoices_dadas_de_baja`, &arca)
	if renglones != 1 || movimientos != 1 || arca != 1 {
		t.Fatalf("la foto: %d renglones, %d movimientos, %d de ARCA", renglones, movimientos, arca)
	}
	_, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/dados-de-baja", nil)
	lista := leerJSON[[]DadoDeBaja](t, b)
	if len(lista) != 1 || lista[0].Numero != 3 || lista[0].Motivo != "Rechazado por ARCA" || lista[0].UsuarioNombre != "Persona" ||
		len(lista[0].Renumerados) != 1 || lista[0].Renumerados[0].ReceptorNombre != "Gómez SRL" {
		t.Fatalf("listado: %s", b)
	}
	// La bitácora: la baja y la del que se movió.
	var anotados int
	e.uno(t, `SELECT count(*)::int FROM audit_log WHERE descripcion LIKE 'Dio de baja Factura A 0003-00000003%' OR descripcion LIKE '%por la baja del 0003-00000003'`, &anotados)
	if anotados != 2 {
		t.Fatalf("bitácora: %d", anotados)
	}
	// El doble clic: el segundo no encuentra nada.
	if st, b := darDeBaja(t, e, admin, ids[2]); st != 422 || !strings.Contains(b, "ya no está") {
		t.Fatalf("otra vez: %d %s", st, b)
	}
	// Un vendedor no entra.
	vendedor := e.staff(t, "v@mjbj.test", sqlc.StaffRoleVendedor)
	if st, _ := darDeBaja(t, e, vendedor, ids[3]); st != 403 {
		t.Fatalf("vendedor: %d", st)
	}
}

// Lo que frena la baja, cada cosa con su mensaje.
func TestLoQueFrenaLaBaja(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	conFichaDeGomez(t, e)
	uno, dos, tres := emitirA(t, e, admin, "1000"), emitirA(t, e, admin, "2000"), emitirA(t, e, admin, "3000")
	frena := func(id, mensaje string) {
		t.Helper()
		if st, b := darDeBaja(t, e, admin, id); st != 422 || !strings.Contains(b, mensaje) {
			t.Fatalf("tendría que frenar con %q: %d %s", mensaje, st, b)
		}
	}
	// Un posterior con CAE: ARCA ya pasó ese número.
	e.exec(t, `UPDATE invoices SET cae = '1', estado = 'autorizada' WHERE id = $1`, tres)
	frena(dos, "El 0003-00000003 ya tiene CAE")
	frena(tres, "Tiene CAE")
	e.exec(t, `UPDATE invoices SET cae = NULL, estado = 'emitida' WHERE id = $1`, tres)

	// Notas encima.
	e.exec(t, `INSERT INTO invoices (tipo, punto_venta, numero, estado, receptor_nombre, comprobante_origen_id, total)
		VALUES ('nota_credito_a', 3, 1, 'emitida', 'Gómez SRL', $1, 1000)`, dos)
	frena(dos, "Tiene notas encima")
	e.exec(t, `DELETE FROM invoices WHERE comprobante_origen_id = $1`, dos)

	// Plata sin recibo: es el único rastro.
	e.exec(t, `INSERT INTO invoice_payments (invoice_id, medio, monto) VALUES ($1, 'efectivo', 100)`, dos)
	frena(dos, "cobros sin recibo")
	e.exec(t, `DELETE FROM invoice_payments WHERE invoice_id = $1`, dos)

	// Cobrado con recibo: se anula el recibo primero, a la vista.
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+uno+"/cobros",
		map[string]string{"partes": `[{"medio":"transferencia","importe":"1000"}]`})
	if st != 200 {
		t.Fatalf("cobrar: %d %s", st, b)
	}
	recibo := leerJSON[ResultadoDeCobro](t, b).ReceiptID
	frena(uno, "Está cobrado con el recibo")
	if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error {
		_, _, err := cobros.AnularRecibo(ctx, tx, *recibo, "Se da de baja la factura", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if st, b := darDeBaja(t, e, admin, uno); st != 200 {
		t.Fatalf("con el recibo anulado: %d %s", st, b)
	}
	// La cuenta queda en cero con lo del 1: la compra se fue con la baja, y
	// el pago y su anulación se compensan.
	var saldo float64
	e.uno(t, `SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE referencia NOT LIKE 'Factura A%'`, &saldo)
	if saldo != 0 {
		t.Fatalf("lo del recibo: %v", saldo)
	}
	var cobrosEnFoto int
	e.uno(t, `SELECT jsonb_array_length(comprobante->'cobros') FROM invoices_dadas_de_baja`, &cobrosEnFoto)
	if cobrosEnFoto != 1 {
		t.Fatalf("los cobros en la foto: %d", cobrosEnFoto)
	}
}

// **ARCA ya tiene el número.** El CAE se perdió en un corte: liberar el
// número sería perder un comprobante autorizado. Se reintenta.
func TestBajaConArcaQueYaLoTiene(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	id, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 1000}}}})
	if err != nil {
		t.Fatal(err)
	}
	e.sim.Fijar(3, 6, 1)
	if st, b := darDeBaja(t, e, admin, id); st != 422 || !strings.Contains(b, "ARCA ya lo tiene") {
		t.Fatalf("baja con ARCA adelante: %d %s", st, b)
	}
	e.sim.Fijar(3, 6, 0)
	if st, b := darDeBaja(t, e, admin, id); st != 200 {
		t.Fatalf("baja: %d %s", st, b)
	}
}

// **Reintentar diez días después.** ARCA acepta cinco días para atrás: el
// comprobante sale con la fecha de hoy, y los anteriores que autoriza la
// cadena también. La fecha original queda guardada y en la bitácora. Una
// nota de crédito sobre el original movido lleva la fecha nueva del
// asociado.
func TestReintentoConLaFechaDeHoy(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	var ids []string
	for i := 0; i < 3; i++ {
		_, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(consumidor(), [4]string{"Fenólico", "1", "12100", "21"}))
		ids = append(ids, leerJSON[map[string]string](t, b)["invoiceId"])
	}
	hace := time.Now().AddDate(0, 0, -10)
	e.exec(t, `UPDATE invoices SET fecha_emision = $1`, hace)

	// Con la fecha vieja, el simulador lo rechaza como ARCA.
	viejo := &comprobanteArca{}
	if c, err := leerParaArca(ctx, e.pool, ids[0]); err != nil || c == nil {
		t.Fatal(err)
	} else {
		viejo = c
	}
	a := &arca{s: e.s, cfg: e.s.env.Leer()}
	if r, err := a.solicitarSinMover(ctx, viejo); err != nil || r.Autorizado || !strings.Contains(r.Observaciones, "5 días") {
		t.Fatalf("con la fecha vieja: %v %+v", err, r)
	}

	_, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+ids[2]+"/serie", nil)
	if s := leerJSON[SerieDelComprobante](t, b); s.AnterioresSinCae != 2 {
		t.Fatalf("anteriores: %s", b)
	}
	autorizarPorAPI(t, e, admin, ids[2])
	hoy := fiscal.FechaArca(time.Now())
	for _, id := range ids {
		var fecha time.Time
		var original *time.Time
		var cae *string
		if err := e.pool.QueryRow(ctx, `SELECT fecha_emision, fecha_emision_original, cae FROM invoices WHERE id = $1`, id).Scan(&fecha, &original, &cae); err != nil {
			t.Fatal(err)
		}
		if cae == nil || fiscal.FechaArca(fecha) != hoy || original == nil || fiscal.FechaArca(*original) != fiscal.FechaArca(hace) {
			t.Fatalf("%s: cae %v, fecha %v, original %v", id, cae, fecha, original)
		}
	}
	var anotados int
	e.uno(t, `SELECT count(*)::int FROM audit_log WHERE descripcion LIKE '%sale a ARCA con fecha%'`, &anotados)
	if anotados != 3 {
		t.Fatalf("bitácora de fechas: %d", anotados)
	}
	c, _ := e.s.Obtener(ctx, ids[0])
	if c.FechaEmisionOriginal == nil {
		t.Fatal("la ficha no trae la fecha original")
	}
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+ids[0]+"/anular", map[string]string{"motivo": "Error de carga"})
	if st != 200 {
		t.Fatalf("anular: %d %s", st, b)
	}
	autorizarPorAPI(t, e, admin, leerJSON[map[string]string](t, b)["invoiceId"])
}

// solicitarSinMover pide el CAE con la fecha que tiene, sin pasarla a hoy
// (para ver que el simulador rechaza lo que ARCA rechaza).
func (a *arca) solicitarSinMover(ctx context.Context, c *comprobanteArca) (fiscal.Resultado, error) {
	aut, err := a.s.paraArca(ctx, c)
	if err != nil {
		return fiscal.Resultado{}, err
	}
	auth, err := a.auth(ctx)
	if err != nil {
		return fiscal.Resultado{}, err
	}
	body, err := fiscal.Llamar(ctx, a.cfg, a.s.bitacoraArca(), "FECAESolicitar", fiscal.CuerpoAutorizar(*aut, a.cfg.Cuit, auth), &c.id)
	if err != nil {
		return fiscal.Resultado{}, err
	}
	return fiscal.LeerAutorizacion(body), nil
}

// **La B desde el umbral, sin documento, no se numera.** ARCA la rechazaría
// y el número quemado trabaría la serie. Con DNI sale. La venta del
// mostrador por el monto exacto queda registrada y avisa: el comprobante se
// emite después desde el pedido, con el documento.
func TestLaBDesdeElUmbral(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	umbral := fiscal.MontoIdentificarConsumidorFinal(time.Now())
	venta := func(cuit *string) (string, error) {
		return e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final", ReceptorCuit: cuit,
			Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Galpón", Cantidad: 1, PrecioFinalUnitario: umbral}}}})
	}
	if _, err := venta(nil); !strings.Contains(Mensaje(err), "hay que cargar el DNI o CUIT del comprador") {
		t.Fatalf("sin documento: %v", err)
	}
	var numerados int
	e.uno(t, `SELECT count(*)::int FROM invoices`, &numerados)
	if numerados != 0 {
		t.Fatal("quemó un número")
	}
	r, err := e.s.EmitirParaLaVenta(ctx, PedidoDeComprobante{ReceptorNombre: "Mostrador", UsuarioID: "u",
		Lineas: []LineaDeVenta{{Descripcion: "Galpón", Unidad: "unidad", Cantidad: 1, PrecioUnitario: umbral}}})
	if err != nil || r.InvoiceID != nil || !strings.Contains(r.Aviso, "La venta quedó registrada") {
		t.Fatalf("mostrador en el borde: %v %+v", err, r)
	}
	dni := "30123456"
	id, err := venta(&dni)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.Autorizar(ctx, id); err != nil {
		t.Fatalf("con DNI: %v", err)
	}
	// Corregir el receptor de un rechazado tampoco deja sacarle el documento.
	e.exec(t, `UPDATE invoices SET estado = 'rechazada', cae = NULL WHERE id = $1`, id)
	if err := e.s.CorregirReceptor(ctx, id, map[string]string{"receptorNombre": "CF", "receptorCondicionIva": "consumidor_final"}); !strings.Contains(Mensaje(err), "DNI o CUIT") {
		t.Fatalf("corregir sin documento: %v", err)
	}
}

// Un pedido cancelado (la venta anulada en el mostrador) no se factura:
// después de una baja no vuelve a la cola.
func TestPedidoCanceladoNoSeFactura(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	pedido := pedidoConAlicuotas(t, e)
	e.exec(t, `UPDATE orders SET estado = 'cancelado' WHERE id = $1`, pedido)
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido+"/facturar", nil)
	if st != 422 || !strings.Contains(string(b), "cancelado") {
		t.Fatalf("facturar un cancelado: %d %s", st, b)
	}
}

// **Dos a la vez.** La baja del 2 mientras se autoriza el 3 de la misma
// serie (que pasa primero por el 2): los candados van en el mismo orden en
// los dos lados y ninguno espera al otro para siempre. Al final la serie no
// tiene huecos y ARCA y la base dicen lo mismo. Y dos bajas del mismo
// comprobante: una sale, la otra dice que ya no está.
func TestBajaYAutorizarALaVez(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	emitir := func() string {
		_, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(consumidor(), [4]string{"Fenólico", "1", "12100", "21"}))
		return leerJSON[map[string]string](t, b)["invoiceId"]
	}
	uno := emitir()
	autorizarPorAPI(t, e, admin, uno)
	dos, tres := emitir(), emitir()
	e.exec(t, `UPDATE invoices SET receptor_cuit = '20123456789' WHERE id = $1`, dos)
	if _, err := e.s.Autorizar(ctx, dos); err == nil {
		t.Fatal("el 2 tendría que rechazarse")
	}

	listo := make(chan struct{})
	var wg sync.WaitGroup
	resultados := make([]string, 4)
	for i, f := range []func() string{
		func() string { _, err := e.s.Autorizar(ctx, tres); return Mensaje(err) },
		func() string { st, b := darDeBaja(t, e, admin, dos); return http.StatusText(st) + b },
		func() string { st, b := darDeBaja(t, e, admin, dos); return http.StatusText(st) + b },
		func() string { _, err := e.s.Autorizar(ctx, tres); return Mensaje(err) },
	} {
		wg.Add(1)
		go func() { defer wg.Done(); resultados[i] = f() }()
	}
	go func() { wg.Wait(); close(listo) }()
	select {
	case <-listo:
	case <-time.After(30 * time.Second):
		t.Fatal("se trabaron")
	}
	bajas := 0
	for _, r := range resultados[1:3] {
		switch {
		case strings.HasPrefix(r, "OK"):
			bajas++
		case !strings.Contains(r, "ya no está"):
			t.Fatalf("la otra baja: %s", r)
		}
	}
	if bajas != 1 {
		t.Fatalf("bajas: %v", resultados)
	}
	// El que era el 3 es el 2; si no se autorizó en la carrera, sale ahora.
	if _, err := e.s.Autorizar(ctx, tres); err != nil && !strings.Contains(Mensaje(err), "ya está autorizado") {
		t.Fatalf("el 3, ahora 2: %v", err)
	}
	var numeros string
	var conCae int
	e.uno(t, `SELECT string_agg(numero::text, ',' ORDER BY numero) FROM invoices`, &numeros)
	e.uno(t, `SELECT count(*)::int FROM invoices WHERE cae IS NOT NULL`, &conCae)
	if numeros != "1,2" || int64(conCae) != e.sim.Ultimo(3, 6) || conCae != 2 {
		t.Fatalf("serie %s, %d con CAE, ARCA en %d", numeros, conCae, e.sim.Ultimo(3, 6))
	}
}

// **El recibo fija su reparto al emitirse** (cobros.FijarReparto): la
// factura de contado sin CAE todavía es una seña para el CSV (Anticipos de
// clientes), sin cliente también —la cuenta sale de la factura que cobra—.
// Con CAE, el cobro de su factura va a Deudores.
func TestElReciboFijaSuReparto(t *testing.T) {
	e := armar(t, true)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	campos := consumidor()
	campos["comoPaga"], campos["medio"] = "contado", "transferencia"
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos, [4]string{"Fenólico", "1", "12100", "21"}))
	if st != 200 {
		t.Fatalf("emitir de contado: %d %s", st, b)
	}
	var d, a, bb float64
	if err := e.pool.QueryRow(context.Background(), `SELECT reparto_deudores::float8, reparto_anticipo::float8, reparto_b::float8 FROM receipts`).
		Scan(&d, &a, &bb); err != nil {
		t.Fatal(err)
	}
	if d != 0 || a != 12100 || bb != 0 {
		t.Fatalf("contado sin CAE: deudores %v, anticipo %v, B %v", d, a, bb)
	}
	// Con CAE, el cobro de la factura cancela Deudores.
	conFichaDeGomez(t, e)
	id := emitirA(t, e, admin, "1000")
	autorizarPorAPI(t, e, admin, id)
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/cobros",
		map[string]string{"partes": `[{"medio":"transferencia","importe":"1000"}]`})
	if st != 200 {
		t.Fatalf("cobrar: %d %s", st, b)
	}
	recibo := leerJSON[ResultadoDeCobro](t, b).ReceiptID
	if err := e.pool.QueryRow(context.Background(), `SELECT reparto_deudores::float8, reparto_anticipo::float8, reparto_b::float8 FROM receipts WHERE id = $1`, *recibo).
		Scan(&d, &a, &bb); err != nil {
		t.Fatal(err)
	}
	if d != 1000 || a != 0 || bb != 0 {
		t.Fatalf("con CAE: deudores %v, anticipo %v, B %v", d, a, bb)
	}
}

// **La baja de una nota deshace lo que la nota hizo.** Factura A con CAE de
// Gómez; se anula y ARCA rechaza la nota de crédito. Antes la baja borraba la
// nota y dejaba la factura «anulada» sin nota detrás y el crédito en la
// cuenta del cliente. Ahora la factura vuelve a estar autorizada, sin
// acreditar, y la cuenta queda como antes de la nota. Lo mismo con una nota
// de débito y lo `debitado`.
func TestBajaDeUnaNota(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	cliente := conFichaDeGomez(t, e)
	factura := emitirA(t, e, admin, "12100")
	e.exec(t, `UPDATE invoices SET cae = '71', estado = 'autorizada' WHERE id = $1`, factura)
	saldo := func() float64 {
		var s float64
		e.uno(t, `SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = $1`, &s, cliente)
		return s
	}
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+factura+"/anular", map[string]string{"motivo": "Error de carga"})
	if st != 200 {
		t.Fatalf("anular: %d %s", st, b)
	}
	nc := leerJSON[map[string]string](t, b)["invoiceId"]
	if saldo() != 0 {
		t.Fatalf("con la nota: %v", saldo())
	}
	serie, err := e.s.Serie(ctx, nc)
	if err != nil || serie.Bloqueo != nil || serie.Deuda != -12100 {
		t.Fatalf("serie de la nota: %+v %v", serie, err)
	}
	if st, b := darDeBaja(t, e, admin, nc); st != 200 {
		t.Fatalf("baja de la nota: %d %s", st, b)
	}
	c, _ := e.s.Obtener(ctx, factura)
	if c.Estado != "autorizada" || c.Acreditado != "0.00" || saldo() != 12100 {
		t.Fatalf("la factura quedó %s, acreditado %s, saldo %v", c.Estado, c.Acreditado, saldo())
	}
	// Se puede volver a anular.
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+factura+"/nota-de-debito",
		map[string]any{"motivo": "Flete olvidado", "concepto": "Flete", "importe": 5000, "alicuota": 21})
	if st != 200 {
		t.Fatalf("débito: %d %s", st, b)
	}
	nd := leerJSON[map[string]string](t, b)["invoiceId"]
	if saldo() != 17100 {
		t.Fatalf("con el débito: %v", saldo())
	}
	if st, b := darDeBaja(t, e, admin, nd); st != 200 {
		t.Fatalf("baja del débito: %d %s", st, b)
	}
	c, _ = e.s.Obtener(ctx, factura)
	if c.Estado != "autorizada" || c.Debitado != "0.00" || saldo() != 12100 {
		t.Fatalf("después del débito: %s, debitado %s, saldo %v", c.Estado, c.Debitado, saldo())
	}
}

// **El fiado no traba la serie.** Una factura pasada a cuenta corriente y
// rechazada por ARCA: el pase no es plata, es la marca de que la deuda quedó
// en la cuenta, y esa deuda se va con la baja.
func TestBajaDeUnaFacturaFiada(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	cliente := conFichaDeGomez(t, e)
	id := emitirA(t, e, admin, "12100")
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/cobros",
		map[string]string{"modo": "cuenta_corriente", "monto": "12100"})
	if st != 200 {
		t.Fatalf("pasar a cuenta: %d %s", st, b)
	}
	// Ya en la cuenta, no se pasa otra vez.
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/cobros",
		map[string]string{"modo": "cuenta_corriente", "monto": "12100"}); st != 422 {
		t.Fatalf("pasar a cuenta dos veces: %d %s", st, b)
	}
	if st, b := darDeBaja(t, e, admin, id); st != 200 {
		t.Fatalf("baja: %d %s", st, b)
	}
	var saldo float64
	var cobrosEnFoto int
	e.uno(t, `SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = $1`, &saldo, cliente)
	e.uno(t, `SELECT jsonb_array_length(comprobante->'cobros') FROM invoices_dadas_de_baja`, &cobrosEnFoto)
	if saldo != 0 || cobrosEnFoto != 1 {
		t.Fatalf("saldo %v, cobros en la foto %d", saldo, cobrosEnFoto)
	}
}

// **Lo que se confirma es lo que se corre.** El admin ve «correr 1»; mientras
// escribe el motivo se emite otro en la serie. La baja no sigue.
func TestLaSerieCambioAntesDeConfirmar(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	conFichaDeGomez(t, e)
	uno, dos := emitirA(t, e, admin, "1000"), emitirA(t, e, admin, "2000")
	serie, _ := e.s.Serie(ctx, uno)
	if len(serie.Corren) != 1 || serie.Corren[0].InvoiceID != dos {
		t.Fatalf("serie: %+v", serie)
	}
	emitirA(t, e, admin, "3000")
	if st, b := darDeBajaViendo(t, admin, e, uno, []string{dos}); st != 422 || !strings.Contains(b, "La serie cambió") {
		t.Fatalf("con la serie cambiada: %d %s", st, b)
	}
	if st, b := darDeBaja(t, e, admin, uno); st != 200 {
		t.Fatalf("con la lista nueva: %d %s", st, b)
	}
}

// **El recibo del corrido nombra su número nuevo.** El 2 se cobró con
// recibo; se da de baja el 1 y el 2 pasa a 1: el concepto del recibo y su
// renglón en la cuenta dicen el 1, y Dados de baja lista el recibo para
// reenviarlo.
func TestElReciboDelCorridoCambiaDeNumero(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	conFichaDeGomez(t, e)
	uno, dos := emitirA(t, e, admin, "1000"), emitirA(t, e, admin, "2000")
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+dos+"/cobros",
		map[string]string{"partes": `[{"medio":"transferencia","importe":"2000"}]`})
	if st != 200 {
		t.Fatalf("cobrar: %d %s", st, b)
	}
	recibo := *leerJSON[ResultadoDeCobro](t, b).ReceiptID
	if st, b := darDeBaja(t, e, admin, uno); st != 200 {
		t.Fatalf("baja: %d %s", st, b)
	}
	var concepto, detalle, numero string
	e.uno(t, `SELECT concepto FROM receipts WHERE id = $1`, &concepto, recibo)
	e.uno(t, `SELECT detalle FROM account_movements WHERE receipt_id = $1`, &detalle, recibo)
	e.uno(t, `SELECT numero FROM receipts WHERE id = $1`, &numero, recibo)
	if concepto != "Cobro de Factura A 0003-00000001" || !strings.HasPrefix(detalle, "Cobro de Factura A 0003-00000001") {
		t.Fatalf("el recibo dice %q, la cuenta %q", concepto, detalle)
	}
	_, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/dados-de-baja", nil)
	lista := leerJSON[[]DadoDeBaja](t, b)
	if len(lista) != 1 || len(lista[0].Renumerados) != 1 || len(lista[0].Renumerados[0].Recibos) != 1 || lista[0].Renumerados[0].Recibos[0] != numero {
		t.Fatalf("dados de baja: %s", b)
	}
}
