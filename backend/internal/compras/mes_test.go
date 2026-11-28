package compras

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"mjbj/internal/caja"
)

// Las pruebas de lo que encontró el mes simulado en producción (noviembre
// de 2026), cada una con el id del hallazgo.

func (e *entorno) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func (e *entorno) id(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var id string
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return id
}

// H005/H061: una factura que vence hoy no está vencida en Facturas de compra.
func TestFacturaQueVenceHoyNoEstaVencida(t *testing.T) {
	e := armar(t)
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision, fecha_vencimiento)
		values ($1, 'factura_a', 4, 1877, 800, 0, 0, 0, 0, 800, '2026-11-26T00:00:00Z', '2026-11-26T00:00:00Z')`, e.proveedor)
	s := Nuevo(e.pool, silencio)
	arg := zonaArgentina
	for _, ahora := range []time.Time{time.Date(2026, 11, 26, 0, 40, 0, 0, arg), time.Date(2026, 11, 26, 23, 50, 0, 0, arg)} {
		l, err := s.ListarFacturas(context.Background(), FiltroDeFacturas{Estado: "pendiente"}, ahora)
		if err != nil {
			t.Fatal(err)
		}
		if l.Vencidas != 0 || l.ImpagoVencido != 0 || l.Impagas != 1 {
			t.Errorf("%v: %+v", ahora, l)
		}
	}
	l, _ := s.ListarFacturas(context.Background(), FiltroDeFacturas{Estado: "pendiente"}, time.Date(2026, 11, 27, 0, 5, 0, 0, arg))
	if l.Vencidas != 1 || l.ImpagoVencido != 800 {
		t.Errorf("al otro día: %+v", l)
	}
}

// H143: un número de cheque con letras se rechaza en vez de perderlas.
func TestNumeroDeChequeConLetras(t *testing.T) {
	for _, n := range []string{"E-55500777", "Sim-CP-000101"} {
		if RevisarNumeroDeCheque(n) == "" {
			t.Errorf("%s pasó", n)
		}
	}
	for _, n := range []string{"0012-3456", "12 345 678", "55500777"} {
		if p := RevisarNumeroDeCheque(n); p != "" {
			t.Errorf("%s: %s", n, p)
		}
	}
}

// orden armada: OC enviada a e.proveedor con 200 placas a $100.
func (e *entorno) ordenEnviada(t *testing.T, adm *http.Client) string {
	t.Helper()
	linea := map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": 200, "costoUnitario": 100, "alicuotaIva": 21}
	_, b := pedir(t, adm, "POST", e.u+"compras/ordenes", map[string]any{"supplierId": e.proveedor, "branchId": e.central, "lineas": []any{linea}})
	orden := idDe(t, b)
	if co, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/enviada", nil); co != 200 {
		t.Fatalf("enviar: %d %s", co, b)
	}
	return orden
}

// H059: el borrador que sale de la orden se corrige con lo que vino y el
// flete, y la orden queda parcial sin contar la mercadería dos veces.
func TestRecibirDeLaOrdenLoQueVinoDeMenos(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	orden := e.ordenEnviada(t, adm)
	c, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/recibir", map[string]string{"numeroRemito": "0001-00000912"})
	if c != 200 {
		t.Fatalf("recibir: %d %s", c, b)
	}
	recepcion := idDe(t, b)
	// Un segundo borrador de la misma orden no se hace.
	if c, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/recibir", map[string]string{"numeroRemito": "X"}); c != 422 || !strings.Contains(b, "Ya hay una recepción en borrador") {
		t.Errorf("otro borrador: %d %s", c, b)
	}
	var item string
	_ = e.pool.QueryRow(context.Background(), `select id from goods_receipt_items where receipt_id = $1`, recepcion).Scan(&item)
	if c, b := pedir(t, adm, "PUT", e.u+"recepciones/"+recepcion, map[string]any{"gastos": 1500,
		"lineas": []any{map[string]any{"id": item, "cantidad": 150, "costoUnitario": 100}}}); c != 200 {
		t.Fatalf("corregir: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+recepcion+"/confirmar", nil); c != 200 || !strings.Contains(b, `"neto":16500`) {
		t.Fatalf("confirmar: %d %s", c, b)
	}
	if q := e.numero(t, `select qty::float8 from inventory where variant_id = $1`, e.placa); q != 150 {
		t.Errorf("stock: %v", q)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/por-llegar", nil); !strings.Contains(b, `"pendiente":"50.0000"`) {
		t.Errorf("en camino: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/ordenes/"+orden, nil); !strings.Contains(b, `"estado":"parcial"`) || !strings.Contains(b, `"cantidadRecibida":"150.0000"`) {
		t.Errorf("la orden: %s", b)
	}
	// Confirmada, ya no se corrige.
	if c, _ := pedir(t, adm, "PUT", e.u+"recepciones/"+recepcion, map[string]any{"lineas": []any{map[string]any{"id": item, "cantidad": 1, "costoUnitario": 1}}}); c != 422 {
		t.Errorf("corregir confirmada: %d", c)
	}
}

// H060: una recepción anulada deja libre su número de remito; dos vivas con
// el mismo, no.
func TestRemitoDeUnaRecepcionAnulada(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	alta := map[string]any{"supplierId": e.proveedor, "branchId": e.central, "numeroRemito": "0001-00000912",
		"lineas": []any{map[string]any{"variantId": e.tornillo, "cantidad": 10, "costoUnitario": 10, "alicuotaIva": 21}}}
	_, b := pedir(t, adm, "POST", e.u+"recepciones", alta)
	primera := idDe(t, b)
	if c, b := pedir(t, adm, "POST", e.u+"recepciones", alta); c != 422 || !strings.Contains(b, "Ya hay una recepción con ese remito") {
		t.Errorf("repetida: %d %s", c, b)
	}
	if c, _ := pedir(t, adm, "POST", e.u+"recepciones/"+primera+"/anular", map[string]string{"motivo": "Se cargó mal"}); c != 204 {
		t.Fatal("anular")
	}
	if c, b := pedir(t, adm, "POST", e.u+"recepciones", alta); c != 200 {
		t.Errorf("el remito real, después de anular: %d %s", c, b)
	}
}

// H071 y la orden anulada: sus borradores se anulan con ella.
func TestAnularLaOrdenAnulaSuBorrador(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	orden := e.ordenEnviada(t, adm)
	_, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/recibir", map[string]string{"numeroRemito": "R-9"})
	recepcion := idDe(t, b)
	if c, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/anular", map[string]string{"motivo": "No viene"}); c != 200 {
		t.Fatalf("anular: %d %s", c, b)
	}
	var estado string
	_ = e.pool.QueryRow(context.Background(), `select estado::text from goods_receipts where id = $1`, recepcion).Scan(&estado)
	if estado != "anulada" {
		t.Errorf("el borrador quedó %s", estado)
	}
}

// H297 y H203: la orden en borrador se corrige; enviada, no; una fecha
// prometida pasada no se acepta.
func TestCorregirLaOrdenEnBorrador(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	linea := map[string]any{"variantId": e.placa, "descripcion": "Yeso", "cantidad": 10, "costoUnitario": 7800, "alicuotaIva": 21}
	ayer := time.Now().In(zonaArgentina).AddDate(0, 0, -1).Format("2006-01-02")
	if c, b := pedir(t, adm, "POST", e.u+"compras/ordenes", map[string]any{"supplierId": e.proveedor, "branchId": e.central, "fechaPrometida": ayer,
		"lineas": []any{linea}}); c != 422 || !strings.Contains(b, "Esa fecha ya pasó.") {
		t.Errorf("fecha pasada: %d %s", c, b)
	}
	_, b := pedir(t, adm, "POST", e.u+"compras/ordenes", map[string]any{"supplierId": e.proveedor, "branchId": e.central, "lineas": []any{linea}})
	orden := idDe(t, b)
	linea["costoUnitario"] = 17050
	if c, b := pedir(t, adm, "PUT", e.u+"compras/ordenes/"+orden, map[string]any{"supplierId": e.proveedor, "branchId": e.central, "lineas": []any{linea}}); c != 200 {
		t.Fatalf("corregir: %d %s", c, b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/ordenes/"+orden, nil); !strings.Contains(b, `"costoUnitario":"17050.0000"`) || !strings.Contains(b, `"numero":"OC-1"`) {
		t.Errorf("corregida: %s", b)
	}
	pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/enviada", nil)
	if c, b := pedir(t, adm, "PUT", e.u+"compras/ordenes/"+orden, map[string]any{"supplierId": e.proveedor, "branchId": e.central, "lineas": []any{linea}}); c != 422 {
		t.Errorf("enviada: %d %s", c, b)
	}
}

// recepcionConfirmada carga y confirma una recepción de `cantidad` placas a
// `costo` con el remito dado.
func (e *entorno) recepcionConfirmada(t *testing.T, adm *http.Client, remito string, cantidad, costo float64) string {
	t.Helper()
	_, b := pedir(t, adm, "POST", e.u+"recepciones", map[string]any{"supplierId": e.proveedor, "branchId": e.central, "numeroRemito": remito,
		"lineas": []any{map[string]any{"variantId": e.placa, "cantidad": cantidad, "costoUnitario": costo, "alicuotaIva": 21}}})
	id := idDe(t, b)
	if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+id+"/confirmar", nil); c != 200 {
		t.Fatalf("confirmar: %d %s", c, b)
	}
	return id
}

// H199: una factura cubre dos remitos y la deuda no se cuenta dos veces.
func TestUnaFacturaPorDosRemitos(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	r1 := e.recepcionConfirmada(t, adm, "0003-00012110", 10, 100)
	r2 := e.recepcionConfirmada(t, adm, "0003-00012188", 5, 100)
	if s := e.saldo(t); s != 1815 {
		t.Fatalf("deuda de los remitos: %v", s)
	}
	c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 89010,
		"fechaEmision": "2026-11-20", "neto": 1500, "iva21": 315, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0,
		"receiptId": r1, "receiptIds": []any{r2}})
	if c != 200 {
		t.Fatalf("factura: %d %s", c, b)
	}
	if s := e.saldo(t); s != 1815 {
		t.Errorf("la factura de los dos remitos no suma deuda: %v", s)
	}
	if _, b := pedir(t, adm, "GET", e.u+"recepciones", nil); strings.Count(b, `"facturada":true`) != 2 {
		t.Errorf("las dos facturadas: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/facturas/"+idDe(t, b), nil); !strings.Contains(b, "0003-00012110 · 0003-00012188") {
		t.Errorf("ficha: %s", b)
	}
}

// H195: la factura más cara que lo recibido pasa la diferencia al costo si
// quien la carga lo elige.
func TestLaDiferenciaDeLaFacturaPasaAlCosto(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	r := e.recepcionConfirmada(t, adm, "0001-00004602", 100, 20800)
	if costo := e.numero(t, `select costo_promedio::float8 from variant_costs where variant_id = $1`, e.placa); costo != 20800 {
		t.Fatalf("costo: %v", costo)
	}
	c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 2, "numero": 45390,
		"fechaEmision": "2026-11-20", "neto": 2130000, "iva21": 447300, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0,
		"receiptId": r, "ajustarCosto": true})
	if c != 200 {
		t.Fatalf("factura: %d %s", c, b)
	}
	if costo := e.numero(t, `select costo_promedio::float8 from variant_costs where variant_id = $1`, e.placa); costo != 21300 {
		t.Errorf("el costo pasa al facturado: %v", costo)
	}
	if n := e.numero(t, `select count(*)::float8 from cost_history where documento_tipo = 'factura_compra'`); n != 1 {
		t.Errorf("historial: %v", n)
	}
}

// H292/H352: la nota de crédito aplicada baja el saldo de la factura: no
// queda «vencida» por lo que el proveedor devolvió, y se aplica también al
// pagar.
func TestNotaDeCreditoAplicadaALaFactura(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	factura := func(tipo string, numero, total float64, extra map[string]any) (int, string) {
		m := map[string]any{"supplierId": e.proveedor, "tipo": tipo, "puntoVenta": 1, "numero": numero, "fechaEmision": "2026-10-01",
			"fechaVencimiento": "2026-10-01", "neto": total, "iva21": 0, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0}
		for k, v := range extra {
			m[k] = v
		}
		return pedir(t, adm, "POST", e.u+"compras/facturas", m)
	}
	_, b := factura("factura_a", 2011, 1347093, nil)
	f := idDe(t, b)
	if c, b := factura("nota_credito_a", 140, 2000000, map[string]any{"aplicaA": f}); c != 422 || !strings.Contains(b, "le faltan") {
		t.Errorf("nota mayor que la factura: %d %s", c, b)
	}
	if c, b := factura("nota_credito_a", 140, 98494, map[string]any{"aplicaA": f}); c != 200 {
		t.Fatalf("nota: %d %s", c, b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); !strings.Contains(b, `"saldo":1248599`) || strings.Contains(b, "nota_credito") {
		t.Errorf("con saldo: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/facturas?estado=pendiente", nil); !strings.Contains(b, `"impago":1248599`) {
		t.Errorf("listado: %s", b)
	}
	// Una a favor, aplicada al pagar.
	_, b = factura("factura_a", 2012, 1000, nil)
	f2 := idDe(t, b)
	_, b = factura("nota_credito_a", 141, 200, nil)
	nota := idDe(t, b)
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); !strings.Contains(b, `"tipo":"nota_credito_a"`) {
		t.Errorf("la nota a favor se ofrece: %s", b)
	}
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 800, "medio": "transferencia", "retenciones": []any{},
		"imputaciones": []any{map[string]any{"purchaseInvoiceId": f2, "importe": 800}}, "notasDeCredito": []any{nota}})
	if c != 200 {
		t.Fatalf("pago: %d %s", c, b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); strings.Contains(b, "2012") || strings.Contains(b, "nota_credito") {
		t.Errorf("después del pago: %s", b)
	}
	// Mes simulado: la ficha de cada factura muestra la nota que la completa
	// y los medios del pago.
	if _, b := pedir(t, adm, "GET", e.u+"compras/facturas/"+f, nil); !strings.Contains(b, `"numero":"0001-00000140"`) || !strings.Contains(b, `"total":98494`) {
		t.Errorf("ficha con la nota aplicada: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/facturas/"+f2, nil); !strings.Contains(b, `"numero":"0001-00000141"`) || !strings.Contains(b, `"medios":["transferencia"]`) {
		t.Errorf("ficha pagada con nota: %s", b)
	}
}

// H293/H337: el cheque endosado que rebotó se ofrece en Pagos y se repone
// como una factura.
func TestChequeRechazadoSePagaComoUnaFactura(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	cheque := e.id(t, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado) values ('recibido', 'fisico', '55500321', now(), 400000, 'rechazado') returning id`)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, referencia, detalle, cheque_id) values ($1, 'ajuste', 400000, '55500321', 'Cheque rechazado por el banco', $2)`,
		e.proveedor, cheque)
	_, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil)
	if !strings.Contains(b, `"tipo":"cheque_rechazado"`) || !strings.Contains(b, `"numero":"Cheque 55500321"`) {
		t.Fatalf("se ofrece: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/facturas?estado=pendiente", nil); !strings.Contains(b, `"impago":400000`) {
		t.Errorf("suma en lo impago: %s", b)
	}
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 400000, "medio": "transferencia", "referencia": "TRF-1", "retenciones": []any{},
		"cheques": []any{map[string]any{"chequeId": cheque, "importe": 400000}}})
	if c != 200 {
		t.Fatalf("pago: %d %s", c, b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); strings.Contains(b, "cheque_rechazado") {
		t.Errorf("repuesto: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/pagos", nil); !strings.Contains(b, `"numero":"Cheque 55500321"`) {
		t.Errorf("el pago dice a qué se aplicó: %s", b)
	}
	if s := e.saldo(t); s != 0 {
		t.Errorf("saldo: %v", s)
	}
}

// H140/H169/H247/H362: el pago partido dice con qué se pagó.
func TestPagoPartidoDiceSusMedios(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	cheque := e.id(t, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado) values ('recibido', 'fisico', '55500001', now(), 500, 'cartera') returning id`)
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 5000, "medio": "efectivo", "retenciones": []any{},
		"partes": []any{map[string]any{"medio": "cheque", "importe": 500, "chequeId": cheque},
			map[string]any{"medio": "transferencia", "importe": 4500, "referencia": "Sim-TRF-900001"}}})
	if c != 200 {
		t.Fatalf("pago: %d %s", c, b)
	}
	_, b = pedir(t, adm, "GET", e.u+"compras/pagos", nil)
	var pagos []PagoListado
	_ = json.Unmarshal([]byte(b), &pagos)
	if len(pagos) != 1 || pagos[0].Medio != "transferencia" || pagos[0].Referencia == nil || *pagos[0].Referencia != "cheque 55500001 y transferencia Sim-TRF-900001" || len(pagos[0].Partes) != 2 ||
		pagos[0].Partes[1].Referencia == nil || *pagos[0].Partes[1].Referencia != "55500001" {
		t.Errorf("listado: %s", b)
	}
	var detalle string
	_ = e.pool.QueryRow(context.Background(), `select detalle from supplier_movements where supplier_payment_id is not null`).Scan(&detalle)
	if detalle != "Pago cheque 55500001 $\u00a0500 + transferencia Sim-TRF-900001 $\u00a04.500" {
		t.Errorf("la cuenta: %q", detalle)
	}
}

// H200/H359: el gasto con factura entra al libro IVA con su crédito fiscal,
// nace pagado y no repite el comprobante.
func TestGastoConFactura(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	gasto := map[string]any{"fecha": "2026-11-10", "categoria": "servicios", "descripcion": "Luz del aserradero", "importe": 398700,
		"medio": "transferencia", "branchId": e.aserradero, "supplierId": e.proveedor,
		"factura": map[string]any{"tipo": "factura_a", "puntoVenta": 7, "numero": 1234, "iva21": 69195.87}}
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 200 {
		t.Fatalf("gasto: %d %s", c, b)
	}
	if n := e.numero(t, `select neto::float8 from purchase_invoices`); n != 329504.13 {
		t.Errorf("neto: %v", n)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/facturas?estado=pendiente", nil); !strings.Contains(b, `"impagas":0`) {
		t.Errorf("nace pagada: %s", b)
	}
	if s := e.saldo(t); s != 0 {
		t.Errorf("no suma deuda: %v", s)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 422 || !strings.Contains(b, "ya está cargado") {
		t.Errorf("la misma factura dos veces: %d %s", c, b)
	}
	q := "?desde=2026-11-01T00:00:00Z&hasta=2026-11-30T23:59:59.999Z"
	if _, b := pedir(t, adm, "GET", e.u+"compras/gastos"+q, nil); !strings.Contains(b, `"conFactura":true`) || !strings.Contains(b, `"sucursal":"Aserradero"`) {
		t.Errorf("listado: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor, nil); !strings.Contains(b, `"descripcion":"Luz del aserradero"`) {
		t.Errorf("en la ficha del proveedor (H065): %s", b)
	}
}

// H376: el gasto en efectivo no deja el cajón por debajo del cambio fijo.
func TestGastoNoBajaDelCambioFijo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	var usuario string
	_ = e.pool.QueryRow(context.Background(), `select id from "user" limit 1`).Scan(&usuario)
	e.exec(t, `update branches set fondo_base = 50000 where id = $1`, e.central)
	turno := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, now() - interval '2 minutes') returning id`, e.central, usuario)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto, creado_por) values ($1, 'apertura', 50000, $2)`, turno, usuario)
	hoy := time.Now().In(zonaArgentina).Format("2006-01-02")
	gasto := map[string]any{"fecha": hoy, "categoria": "flete", "descripcion": "Flete", "importe": 48000, "medio": "efectivo", "branchId": e.central}
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 422 || !strings.Contains(b, "cambio fijo") {
		t.Errorf("debajo del cambio: %d %s", c, b)
	}
	delete(gasto, "branchId")
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 422 || !strings.Contains(b, "de qué caja") {
		t.Errorf("sin caja: %d %s", c, b)
	}
}

// H097: el depósito recibe sin ver precios; cargar a mano es del admin.
func TestElDepositoRecibeSinPrecios(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	orden := e.ordenEnviada(t, adm)
	if _, b := pedir(t, dep, "GET", e.u+"recepciones/por-recibir", nil); !strings.Contains(b, `"numero":"OC-1"`) || strings.Contains(b, "costo") {
		t.Errorf("por recibir: %s", b)
	}
	c, b := pedir(t, dep, "POST", e.u+"compras/ordenes/"+orden+"/recibir", map[string]string{"numeroRemito": "R-5"})
	if c != 200 {
		t.Fatalf("recibir: %d %s", c, b)
	}
	recepcion := idDe(t, b)
	if _, b := pedir(t, dep, "GET", e.u+"recepciones/"+recepcion, nil); strings.Contains(b, `"costoUnitario":"100`) {
		t.Errorf("ve el costo: %s", b)
	}
	var item string
	_ = e.pool.QueryRow(context.Background(), `select id from goods_receipt_items where receipt_id = $1`, recepcion).Scan(&item)
	// Manda solo la cantidad; el costo y el flete quedan.
	if c, b := pedir(t, dep, "PUT", e.u+"recepciones/"+recepcion, map[string]any{"lineas": []any{map[string]any{"id": item, "cantidad": 180}}}); c != 200 {
		t.Fatalf("corregir: %d %s", c, b)
	}
	if costo := e.numero(t, `select costo_unitario::float8 from goods_receipt_items where id = $1`, item); costo != 100 {
		t.Errorf("costo tocado: %v", costo)
	}
	if c, _ := pedir(t, dep, "POST", e.u+"recepciones/"+recepcion+"/confirmar", nil); c != 200 {
		t.Errorf("confirmar")
	}
	if c, _ := pedir(t, dep, "POST", e.u+"recepciones", map[string]any{"supplierId": e.proveedor, "branchId": e.central,
		"lineas": []any{map[string]any{"variantId": e.tornillo, "cantidad": 1, "costoUnitario": 1, "alicuotaIva": 21}}}); c != 403 {
		t.Errorf("a mano: %d", c)
	}
}

// Sin cambio fijo, el piso del cajón es cero: un gasto en efectivo no lo deja
// en negativo (mes simulado: con fondo_base en 0 el control no corría).
func TestElGastoNoDejaElCajonEnNegativo(t *testing.T) {
	casos := []struct {
		enCaja, base, importe float64
		ok                    bool
		motivo                string
	}{
		{20000, 0, 20000, true, ""},
		{20000, 0, 20000.5, false, "En el cajón hay $\u00a020.000: de esa caja salen hasta $\u00a020.000."},
		{0, 0, 1, false, "En el cajón de esa caja no hay efectivo."},
		{60000, 50000, 10000, true, ""},
		{60000, 50000, 10001, false, "Deja el cajón sin el cambio fijo ($\u00a050.000): de esa caja salen hasta $\u00a010.000."},
	}
	for _, c := range casos {
		ok, motivo := AlcanzaElCajon(c.enCaja, c.base, c.importe)
		if ok != c.ok || motivo != c.motivo {
			t.Errorf("AlcanzaElCajon(%v, %v, %v) = %v %q", c.enCaja, c.base, c.importe, ok, motivo)
		}
	}
}

// Un gasto mal cargado se anula (mes simulado): el efectivo vuelve al
// turno abierto, la factura que vino con él se anula y deja de contar.
func TestAnularUnGasto(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	var usuario string
	_ = e.pool.QueryRow(ctx, `select id from "user" limit 1`).Scan(&usuario)
	e.exec(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, now() - interval '1 hour')`, e.central, usuario)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto, created_at) select id, 'apertura', 50000, abierta_at from cash_sessions`)
	hoy := time.Now().In(caja.Argentina).Format("2006-01-02")
	gasto := map[string]any{"fecha": hoy, "categoria": "flete", "descripcion": "Flete del puerto", "importe": 12000, "medio": "efectivo", "branchId": e.central}
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 200 {
		t.Fatalf("gasto: %d %s", c, b)
	}
	var id string
	_ = e.pool.QueryRow(ctx, `select id from expenses`).Scan(&id)
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos/"+id+"/anular", map[string]any{"motivo": " "}); c != 422 || !strings.Contains(b, "Poné el motivo") {
		t.Errorf("sin motivo: %d %s", c, b)
	}
	c, b := pedir(t, adm, "POST", e.u+"compras/gastos/"+id+"/anular", map[string]any{"motivo": "Se cargó en efectivo y fue transferencia"})
	if c != 200 || !strings.Contains(b, "volvieron a la caja") {
		t.Fatalf("anular: %d %s", c, b)
	}
	if m := e.numero(t, `select sum(monto)::float8 from cash_movements`); m != 50000 {
		t.Errorf("el cajón vuelve a lo que tenía: %v", m)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos/"+id+"/anular", map[string]any{"motivo": "otra vez"}); c != 422 || !strings.Contains(b, "ya estaba anulado") {
		t.Errorf("dos veces: %d %s", c, b)
	}
	desde := time.Now().AddDate(0, 0, -2).UTC().Format(time.RFC3339)
	hasta := time.Now().AddDate(0, 0, 2).UTC().Format(time.RFC3339)
	q := "?desde=" + desde + "&hasta=" + hasta
	if _, b := pedir(t, adm, "GET", e.u+"compras/gastos/por-categoria"+q, nil); strings.Contains(b, "flete") {
		t.Errorf("el anulado no suma: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/gastos"+q, nil); !strings.Contains(b, `"motivoAnulacion":"Se cargó en efectivo y fue transferencia"`) {
		t.Errorf("listado: %s", b)
	}
}
