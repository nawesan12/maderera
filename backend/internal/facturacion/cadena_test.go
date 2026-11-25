package facturacion

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"mjbj/internal/fiscal"
	"mjbj/internal/sqlc"
)

// **La primera venta del mostrador no decide por el estudio.** Hay dos
// comprobantes sin CAE de hace diez días. Se carga el certificado y el
// mostrador vende: antes la cadena los autorizaba con la fecha de hoy, sin
// bitácora y sin mandarle a nadie el comprobante válido. Ahora la venta queda
// pendiente y lo de atrás no se toca; cuando alguien autoriza la serie desde
// Facturación, cada fecha movida queda anotada y los tres clientes reciben
// su comprobante.
func TestLaVentaNoArrastraLoAtrasado(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	var viejos []string
	for i := 0; i < 2; i++ {
		_, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(consumidor(), [4]string{"Fenólico", "1", "12100", "21"}))
		viejos = append(viejos, leerJSON[map[string]string](t, b)["invoiceId"])
	}
	hace := time.Now().AddDate(0, 0, -10)
	e.exec(t, `UPDATE invoices SET fecha_emision = $1, estado = 'rechazada'`, hace)
	e.exec(t, `DELETE FROM trabajos WHERE tipo = 'factura.aviso'`)

	r, err := e.s.EmitirParaLaVenta(ctx, PedidoDeComprobante{ReceptorNombre: "Mostrador", UsuarioID: "u",
		Lineas: []LineaDeVenta{{Descripcion: "Clavos", Unidad: "kg", Cantidad: 2, PrecioUnitario: 1500}}})
	if err != nil {
		t.Fatal(err)
	}
	if r.Autorizado || r.InvoiceID == nil || !strings.Contains(r.Aviso, "se autoriza desde Facturación") {
		t.Fatalf("la venta: %+v", r)
	}
	var conCAE, movidas int
	e.uno(t, `SELECT count(*)::int FROM invoices WHERE cae IS NOT NULL`, &conCAE)
	e.uno(t, `SELECT count(*)::int FROM invoices WHERE fecha_emision_original IS NOT NULL`, &movidas)
	if conCAE != 0 || movidas != 0 || e.sim.Llamadas("FECAESolicitar") != 0 {
		t.Fatalf("la venta arrastró: %d con CAE, %d fechas movidas, %d pedidos", conCAE, movidas, e.sim.Llamadas("FECAESolicitar"))
	}

	autorizarPorAPI(t, e, admin, *r.InvoiceID)
	e.uno(t, `SELECT count(*)::int FROM invoices WHERE cae IS NOT NULL`, &conCAE)
	var anotadas, avisos int
	e.uno(t, `SELECT count(*)::int FROM audit_log WHERE descripcion LIKE '%sale a ARCA con fecha%'`, &anotadas)
	e.uno(t, `SELECT count(DISTINCT carga->>'invoiceId')::int FROM trabajos WHERE tipo = 'factura.aviso'`, &avisos)
	if conCAE != 3 || anotadas != 2 || avisos != 3 {
		t.Fatalf("desde Facturación: %d con CAE, %d fechas anotadas, %d avisos", conCAE, anotadas, avisos)
	}
}

// Las ventas que llegan al mismo tiempo sí se autorizan en cadena (son del
// mismo día): la que ganó el candado autoriza la anterior, y a esa se le
// manda su comprobante.
func TestLaVentaAutorizaLaDelMismoDia(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	primero, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 1000}}}})
	if err != nil {
		t.Fatal(err)
	}
	r, err := e.s.EmitirParaLaVenta(ctx, PedidoDeComprobante{ReceptorNombre: "Mostrador", UsuarioID: "u",
		Lineas: []LineaDeVenta{{Descripcion: "Clavos", Unidad: "kg", Cantidad: 2, PrecioUnitario: 1500}}})
	if err != nil || !r.Autorizado {
		t.Fatalf("la venta: %v %+v", err, r)
	}
	var avisos int
	e.uno(t, `SELECT count(*)::int FROM trabajos WHERE tipo = 'factura.aviso' AND carga->>'invoiceId' = $1`, &avisos, primero)
	if avisos != 1 {
		t.Fatalf("el anterior no se avisó: %d", avisos)
	}
}

// **Una venta anulada no va a ARCA.** El cajero anuló la venta y la factura
// sin CAE quedó en la serie: la cadena la hubiera autorizado (IVA de una
// venta que no existió). Frena y pide la baja.
func TestLaVentaAnuladaNoSeAutoriza(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	pedido := pedidoConAlicuotas(t, e)
	e.exec(t, `UPDATE orders SET estado = 'cancelado' WHERE id = $1`, pedido)
	id, err := e.s.EmitirComprobante(ctx, DatosEmision{OrderID: &pedido, ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 1000}}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.Autorizar(ctx, id); !strings.Contains(Mensaje(err), "dalo de baja") {
		t.Fatalf("la anulada: %v", err)
	}
	dos, _ := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: 2000}}}})
	if _, err := e.s.Autorizar(ctx, dos); !strings.Contains(Mensaje(err), "de una venta anulada: dalo de baja") {
		t.Fatalf("detrás de la anulada: %v", err)
	}
	if e.sim.Llamadas("FECAESolicitar") != 0 {
		t.Fatal("la anulada salió a ARCA")
	}
}

// **El CAE recuperado conserva la fecha de ARCA.** ARCA autorizó el 2 hoy y
// el CAE se perdió; el reintento es tres días después. El camino corto lo
// pasaba a la fecha nueva antes de enterarse (10016) de que ya estaba
// autorizado, y la base quedaba con otra fecha que ARCA.
func TestElCAERecuperadoConservaLaFecha(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	emitir := func(precio float64) string {
		id, err := e.s.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
			Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 1, PrecioFinalUnitario: precio}}}})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	uno, dos := emitir(1000), emitir(2000)
	if _, err := e.s.Autorizar(ctx, uno); err != nil {
		t.Fatal(err)
	}
	corte := errors.New("el proceso se cortó")
	e.s.despuesDelCAE = func(string) error { return corte }
	if _, err := e.s.Autorizar(ctx, dos); !errors.Is(err, corte) {
		t.Fatalf("tendría que cortarse: %v", err)
	}
	e.s.despuesDelCAE = nil
	dado, _ := e.sim.Emitido(3, 6, 2)

	despues := time.Now().AddDate(0, 0, 3)
	e.s.ahora = func() time.Time { return despues }
	e.sim.Ahora = func() time.Time { return despues }
	_, cadena, err := e.s.AutorizarConFechas(ctx, dos)
	if err != nil {
		t.Fatalf("el reintento: %v", err)
	}
	var fecha time.Time
	var original *time.Time
	var cae string
	if err := e.pool.QueryRow(ctx, `SELECT fecha_emision, fecha_emision_original, cae FROM invoices WHERE id = $1`, dos).Scan(&fecha, &original, &cae); err != nil {
		t.Fatal(err)
	}
	if cae != dado.Cae || fiscal.FechaArca(fecha) != dado.CbteFch || original != nil || len(cadena.Movidas) != 0 {
		t.Fatalf("recuperado con fecha %s (ARCA %s), original %v, movidas %+v", fiscal.FechaArca(fecha), dado.CbteFch, original, cadena.Movidas)
	}
}
