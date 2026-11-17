package compras

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"mjbj/internal/caja"
)

// Las pruebas de la revisión de compras del 17/11/2026.

// Bug: el listado traía las últimas 60 y sumaba la deuda ahí. Con 65
// facturas impagas, la más vieja no estaba en el «sin pagar».
func TestLaDeudaSumaTodasLasImpagas(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	// 65 facturas de $121 (las cargo directo: lo que se prueba es el listado).
	for i := 1; i <= 65; i++ {
		emision := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC).AddDate(0, 0, i)
		if _, err := e.pool.Exec(ctx, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, fecha_vencimiento, neto, iva21, total)
			values ($1, 'factura_a', 1, $2, $3, $4, 100, 21, 121)`, e.proveedor, i, emision, emision.AddDate(0, 0, 30)); err != nil {
			t.Fatal(err)
		}
	}
	// Una pagada entera: la 65.
	var f65 string
	_ = e.pool.QueryRow(ctx, `select id from purchase_invoices where numero = 65`).Scan(&f65)
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 121, "medio": "transferencia",
		"retenciones": []any{}, "imputaciones": []any{map[string]any{"purchaseInvoiceId": f65, "importe": 121}}})
	if c != 200 {
		t.Fatalf("pago: %d %s", c, b)
	}

	var l ListadoDeFacturas
	_, b = pedir(t, adm, "GET", e.u+"compras/facturas?estado=pendiente", nil)
	_ = json.Unmarshal([]byte(b), &l)
	if l.Impagas != 64 || l.Impago != 64*121 || len(l.Facturas) != 64 {
		t.Fatalf("la deuda tiene que sumar las 64 impagas: %d por %v, %d en la lista", l.Impagas, l.Impago, len(l.Facturas))
	}
	// Por vencimiento: la que vence antes, arriba.
	if l.Facturas[0].Numero != 1 || l.Facturas[63].Numero != 64 {
		t.Errorf("orden por vencimiento: %d … %d", l.Facturas[0].Numero, l.Facturas[63].Numero)
	}
	if l.Vencidas != 64 {
		t.Errorf("vencidas (todas vencieron en 2026): %d", l.Vencidas)
	}
	// Las pagadas, de a páginas.
	_, b = pedir(t, adm, "GET", e.u+"compras/facturas?estado=pagadas", nil)
	l = ListadoDeFacturas{}
	_ = json.Unmarshal([]byte(b), &l)
	if len(l.Facturas) != 1 || l.Facturas[0].Numero != 65 || l.Impago != 64*121 {
		t.Errorf("pagadas: %s", b)
	}
	_, b = pedir(t, adm, "GET", e.u+"compras/facturas?estado=todas&limite=50&pagina=2", nil)
	l = ListadoDeFacturas{}
	_ = json.Unmarshal([]byte(b), &l)
	if len(l.Facturas) != 15 || l.HayMas {
		t.Errorf("segunda página de todas: %d, hayMas %v", len(l.Facturas), l.HayMas)
	}
	// Por proveedor y por fechas de emisión.
	_, b = pedir(t, adm, "GET", e.u+"compras/facturas?estado=pendiente&desde=2026-01-02T00:00:00Z&hasta=2026-01-05T23:59:59Z&proveedor="+e.proveedor, nil)
	l = ListadoDeFacturas{}
	_ = json.Unmarshal([]byte(b), &l)
	if len(l.Facturas) != 4 || l.Impago != 64*121 {
		t.Errorf("con fechas: %d facturas, deuda %v", len(l.Facturas), l.Impago)
	}
	otro := "00000000-0000-4000-8000-000000000000"
	if _, b := pedir(t, adm, "GET", e.u+"compras/facturas?estado=pendiente&proveedor="+otro, nil); !strings.Contains(b, `"impago":0`) {
		t.Errorf("otro proveedor: %s", b)
	}
}

// Bug: pagarle en efectivo a un proveedor no sacaba plata de ninguna caja
// (un gasto sí), y anularlo no tenía nada que devolver.
func TestElPagoEnEfectivoSaleDeLaCaja(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	var usuario, turno string
	_ = e.pool.QueryRow(ctx, `select id from "user" limit 1`).Scan(&usuario)
	_ = e.pool.QueryRow(ctx, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, now() - interval '1 minute') returning id`,
		e.central, usuario).Scan(&turno)
	// La sucursal del turno abierto por quien mira viene marcada.
	if _, b := pedir(t, adm, "GET", e.u+"compras/gastos/sucursales", nil); !strings.Contains(b, `"deLaSesion":true`) {
		t.Errorf("sucursal de la sesión: %s", b)
	}
	// $1000 con $600 en efectivo y $400 por transferencia: salen $600 del turno.
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 1000, "medio": "efectivo",
		"retenciones": []any{}, "branchId": e.central,
		"partes": []any{map[string]any{"medio": "efectivo", "importe": 600}, map[string]any{"medio": "transferencia", "importe": 400}}})
	if c != 200 || strings.Contains(b, "aviso") {
		t.Fatalf("pago: %d %s", c, b)
	}
	pago := idDe(t, b)
	if m := e.numero(t, `select coalesce(sum(monto), 0)::float8 from cash_movements where session_id = $1 and supplier_payment_id = $2`, turno, pago); m != -600 {
		t.Errorf("el efectivo sale del turno: %v", m)
	}
	// La ficha dice de qué caja salió.
	if _, b := pedir(t, adm, "GET", e.u+"compras/pagos/"+pago, nil); !strings.Contains(b, `"caja":"Casa Central"`) || !strings.Contains(b, `"efectivoEnCaja":600`) {
		t.Errorf("ficha: %s", b)
	}
	// Anularlo devuelve el efectivo al turno abierto.
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos/"+pago+"/anular", map[string]string{"motivo": "Se cargó dos veces"})
	if c != 200 || !strings.Contains(sinNBSP(b), "$ 600 en efectivo volvieron a la caja") {
		t.Fatalf("anular: %d %s", c, b)
	}
	if m := e.numero(t, `select coalesce(sum(monto), 0)::float8 from cash_movements where session_id = $1`, turno); m != 0 {
		t.Errorf("el turno queda como antes del pago: %v", m)
	}
	// El movimiento de cuenta del pago y el de la anulación quedan atados al pago.
	if n := e.numero(t, `select count(*)::float8 from supplier_movements where supplier_payment_id = $1`, pago); n != 2 {
		t.Errorf("movimientos atados al pago: %v", n)
	}

	// Sin sucursal, o sin turno: se registra igual y avisa.
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 100, "medio": "efectivo", "retenciones": []any{}})
	if c != 200 || !strings.Contains(b, "No se eligió de qué caja salió el efectivo") {
		t.Errorf("sin sucursal: %d %s", c, b)
	}
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 100, "medio": "efectivo", "retenciones": []any{},
		"branchId": e.aserradero})
	if c != 200 || !strings.Contains(b, "No había caja abierta") {
		t.Errorf("sin turno: %d %s", c, b)
	}
	// Una transferencia no toca la caja.
	antes := e.numero(t, `select count(*)::float8 from cash_movements`)
	pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 100, "medio": "transferencia", "retenciones": []any{},
		"branchId": e.central})
	if n := e.numero(t, `select count(*)::float8 from cash_movements`); n != antes {
		t.Errorf("la transferencia tocó la caja")
	}
	// Anular el pago con el turno ya cerrado: avisa que no entró a ninguno.
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 50, "medio": "efectivo", "retenciones": []any{},
		"branchId": e.central})
	if c != 200 {
		t.Fatalf("pago chico: %d %s", c, b)
	}
	chico := idDe(t, b)
	_, _ = e.pool.Exec(ctx, `update cash_sessions set estado = 'cerrada', cerrada_at = now() where id = $1`, turno)
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos/"+chico+"/anular", map[string]string{"motivo": "error"}); c != 200 || !strings.Contains(b, "no tiene turno abierto") {
		t.Errorf("anular sin turno: %d %s", c, b)
	}
}

// El pago tiene fecha: hoy por defecto, de antes si se carga tarde, nunca
// del futuro. El acumulado del mes de las retenciones sale de esa fecha.
func TestLaFechaDelPago(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ahora := time.Now()
	manana := ahora.In(caja.Argentina).AddDate(0, 0, 1).Format("2006-01-02")
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 100, "medio": "transferencia",
		"retenciones": []any{}, "fecha": manana}); c != 422 || !strings.Contains(b, "posterior a hoy") {
		t.Errorf("pago de mañana: %d %s", c, b)
	}
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 100, "medio": "transferencia",
		"retenciones": []any{}, "fecha": "2026-02-10"})
	if c != 200 {
		t.Fatalf("pago de febrero: %d %s", c, b)
	}
	pago := idDe(t, b)
	var fecha, mov time.Time
	_ = e.pool.QueryRow(context.Background(), `select fecha from supplier_payments where id = $1`, pago).Scan(&fecha)
	_ = e.pool.QueryRow(context.Background(), `select created_at from supplier_movements where supplier_payment_id = $1`, pago).Scan(&mov)
	if diaArgentino(fecha) != "2026-02-10" || diaArgentino(mov) != "2026-02-10" {
		t.Errorf("la fecha del pago: %v, del movimiento: %v", fecha, mov)
	}
	// Sin fecha, ahora.
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 100, "medio": "transferencia", "retenciones": []any{}})
	if c != 200 {
		t.Fatalf("pago de hoy: %d %s", c, b)
	}
	_ = e.pool.QueryRow(context.Background(), `select fecha from supplier_payments where id = $1`, idDe(t, b)).Scan(&fecha)
	if diaArgentino(fecha) != diaArgentino(ahora) {
		t.Errorf("sin fecha es hoy: %v", fecha)
	}
}

// Anular una factura: la cuenta vuelve, sale del libro IVA, los pagos que la
// cancelaban quedan a cuenta, y el número queda libre para la correcta.
func TestAnularUnaFacturaDeCompra(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 1274,
		"fechaEmision": "2026-10-01", "neto": 1000, "iva21": 210, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0})
	if c != 200 {
		t.Fatalf("factura: %d %s", c, b)
	}
	factura := idDe(t, b)
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 500, "medio": "transferencia", "retenciones": []any{},
		"imputaciones": []any{map[string]any{"purchaseInvoiceId": factura, "importe": 500}}})
	if c != 200 {
		t.Fatalf("pago: %d %s", c, b)
	}
	pago := idDe(t, b)
	if s := e.saldo(t); s != 710 {
		t.Fatalf("antes: %v", s)
	}
	// La ficha: con su pago.
	if _, b := pedir(t, adm, "GET", e.u+"compras/facturas/"+factura, nil); !strings.Contains(b, `"pagoId":"`+pago+`"`) || !strings.Contains(b, `"pagado":500`) {
		t.Errorf("ficha: %s", b)
	}
	if c, _ := pedir(t, ven, "POST", e.u+"compras/facturas/"+factura+"/anular", map[string]string{"motivo": "x"}); c != 403 {
		t.Errorf("el vendedor no anula: %d", c)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/facturas/"+factura+"/anular", map[string]string{"motivo": " "}); c != 422 || !strings.Contains(b, "Poné el motivo") {
		t.Errorf("sin motivo: %d %s", c, b)
	}
	c, b = pedir(t, adm, "POST", e.u+"compras/facturas/"+factura+"/anular", map[string]string{"motivo": "Era de otro proveedor"})
	if c != 200 || !strings.Contains(sinNBSP(b), "bajó $ 1.210") || !strings.Contains(sinNBSP(b), "$ 500 que se le habían pagado quedaron a cuenta") {
		t.Fatalf("anular: %d %s", c, b)
	}
	// La cuenta: la factura se fue, el pago queda (a favor nuestro).
	if s := e.saldo(t); s != -500 {
		t.Errorf("después: %v", s)
	}
	if n := e.numero(t, `select count(*)::float8 from supplier_payment_allocations`); n != 0 {
		t.Errorf("el pago quedó sin aplicar: %v", n)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/libro-iva?desde=2026-10-01T00:00:00Z&hasta=2026-10-31T23:59:59.999Z", nil); strings.Contains(b, factura) {
		t.Errorf("la anulada sigue en el libro: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); b != "[]\n" {
		t.Errorf("la anulada no se paga: %s", b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/facturas/"+factura+"/anular", map[string]string{"motivo": "otra vez"}); c != 422 || !strings.Contains(b, "ya estaba anulada") {
		t.Errorf("dos veces: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 10, "medio": "transferencia", "retenciones": []any{},
		"imputaciones": []any{map[string]any{"purchaseInvoiceId": factura, "importe": 10}}}); c != 422 || !strings.Contains(b, "está anulada") {
		t.Errorf("pagar una anulada: %d %s", c, b)
	}
	// El mismo número se vuelve a cargar.
	if c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 1274,
		"fechaEmision": "2026-10-01", "neto": 100, "iva21": 21, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0}); c != 200 {
		t.Errorf("recargar el número: %d %s", c, b)
	}
	// Todas las facturas, con la anulada marcada.
	if _, b := pedir(t, adm, "GET", e.u+"compras/facturas?estado=todas", nil); !strings.Contains(b, `"anuladaAt":"`) {
		t.Errorf("todas: %s", b)
	}
}

// Anular la factura de una recepción devuelve solo la diferencia que cargó
// y libera la recepción para la factura correcta.
func TestAnularLaFacturaDeUnaRecepcion(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	c, b := pedir(t, adm, "POST", e.u+"recepciones", map[string]any{"supplierId": e.proveedor, "branchId": e.central, "numeroRemito": "R-1",
		"lineas": []any{map[string]any{"variantId": e.tornillo, "cantidad": 100, "costoUnitario": 10, "alicuotaIva": 21}}})
	if c != 200 {
		t.Fatalf("recepción: %d %s", c, b)
	}
	recepcion := idDe(t, b)
	pedir(t, adm, "POST", e.u+"recepciones/"+recepcion+"/confirmar", nil)
	c, b = pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 1,
		"fechaEmision": "2026-10-20", "neto": 1100, "iva21": 231, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0, "receiptId": recepcion})
	if c != 200 {
		t.Fatalf("factura: %d %s", c, b)
	}
	factura := idDe(t, b)
	if s := e.saldo(t); s != 1331 {
		t.Fatalf("con la diferencia: %v", s)
	}
	// La ficha trae la mercadería de la recepción.
	if _, b := pedir(t, adm, "GET", e.u+"compras/facturas/"+factura, nil); !strings.Contains(b, `"producto":"Tornillo"`) || !strings.Contains(b, `"numeroRemito":"R-1"`) {
		t.Errorf("ficha: %s", b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/facturas/"+factura+"/anular", map[string]string{"motivo": "Mal cargada"}); c != 200 {
		t.Fatalf("anular: %d %s", c, b)
	}
	if s := e.saldo(t); s != 1210 {
		t.Errorf("queda la deuda de la recepción: %v", s)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 1,
		"fechaEmision": "2026-10-20", "neto": 1000, "iva21": 210, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0, "receiptId": recepcion}); c != 200 {
		t.Errorf("la recepción quedó libre: %d %s", c, b)
	}
	if s := e.saldo(t); s != 1210 {
		t.Errorf("con la correcta: %v", s)
	}
}

// Corregir una factura: la diferencia va a la cuenta; no baja de lo pagado.
func TestCorregirUnaFacturaDeCompra(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	alta := map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 7, "fechaEmision": "2026-10-01",
		"neto": 1000, "iva21": 210, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0}
	c, b := pedir(t, adm, "POST", e.u+"compras/facturas", alta)
	if c != 200 {
		t.Fatalf("factura: %d %s", c, b)
	}
	factura := idDe(t, b)
	pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 1000, "medio": "transferencia", "retenciones": []any{},
		"imputaciones": []any{map[string]any{"purchaseInvoiceId": factura, "importe": 1000}}})
	corregida := map[string]any{}
	for k, v := range alta {
		corregida[k] = v
	}
	corregida["neto"], corregida["iva21"], corregida["numero"] = 2000, 420, 8
	if c, b := pedir(t, adm, "PUT", e.u+"compras/facturas/"+factura, corregida); c != 422 || !strings.Contains(b, "Poné el motivo") {
		t.Errorf("sin motivo: %d %s", c, b)
	}
	corregida["motivo"] = "Se tipeó la mitad"
	c, b = pedir(t, adm, "PUT", e.u+"compras/facturas/"+factura, corregida)
	if c != 200 || !strings.Contains(sinNBSP(b), "se ajustó en $ 1.210") {
		t.Fatalf("corregir: %d %s", c, b)
	}
	if s := e.saldo(t); s != 2420-1000 {
		t.Errorf("la cuenta con la corrección: %v", s)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/libro-iva?desde=2026-10-01T00:00:00Z&hasta=2026-10-31T23:59:59.999Z", nil); !strings.Contains(b, `"total":2420`) || !strings.Contains(b, `"numero":8`) {
		t.Errorf("el libro lee la corregida: %s", b)
	}
	// No puede quedar por debajo de lo pagado.
	corregida["neto"], corregida["iva21"] = 500, 105
	if c, b := pedir(t, adm, "PUT", e.u+"compras/facturas/"+factura, corregida); c != 422 || !strings.Contains(sinNBSP(b), "Ya se le pagaron $ 1.000") {
		t.Errorf("por debajo de lo pagado: %d %s", c, b)
	}
	// Ni cambiar de proveedor.
	var otro string
	_ = e.pool.QueryRow(context.Background(), `insert into suppliers (nombre) values ('Otro') returning id`).Scan(&otro)
	corregida["neto"], corregida["iva21"], corregida["supplierId"] = 2000, 420, otro
	if c, b := pedir(t, adm, "PUT", e.u+"compras/facturas/"+factura, corregida); c != 422 || !strings.Contains(b, "anulá la factura") {
		t.Errorf("otro proveedor: %d %s", c, b)
	}
}

// El alta: el vencimiento a mano y las percepciones por impuesto.
func TestVencimientoYPercepcionesDeLaFactura(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 9,
		"fechaEmision": "2026-10-01", "fechaVencimiento": "2026-10-15", "neto": 1000, "iva21": 210, "iva105": 0, "iva27": 0, "exento": 0,
		"percepciones": 0, "percepcionIva": 30, "percepcionIibb": 25.5})
	if c != 200 {
		t.Fatalf("factura: %d %s", c, b)
	}
	var f FichaDeFactura
	_, b = pedir(t, adm, "GET", e.u+"compras/facturas/"+idDe(t, b), nil)
	_ = json.Unmarshal([]byte(b), &f)
	if f.FechaVencimiento == nil || f.FechaVencimiento.UTC().Format("2006-01-02") != "2026-10-15" || f.Percepciones != 55.5 || f.PercepcionIva != 30 ||
		f.PercepcionIibb != 25.5 || f.Total != 1265.5 {
		t.Errorf("ficha: %s", b)
	}
	// Sin vencimiento, la emisión más los días de pago (30).
	c, b = pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 10,
		"fechaEmision": "2026-10-01", "neto": 100, "iva21": 21, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0})
	if c != 200 {
		t.Fatalf("factura sin vencimiento: %d %s", c, b)
	}
	f = FichaDeFactura{}
	_, b = pedir(t, adm, "GET", e.u+"compras/facturas/"+idDe(t, b), nil)
	_ = json.Unmarshal([]byte(b), &f)
	if f.FechaVencimiento == nil || f.FechaVencimiento.UTC().Format("2006-01-02") != "2026-10-31" {
		t.Errorf("vencimiento por días de pago: %v", f.FechaVencimiento)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 11,
		"fechaEmision": "2026-10-01", "fechaVencimiento": "2026-09-01", "neto": 100, "iva21": 21, "iva105": 0, "iva27": 0, "exento": 0,
		"percepciones": 0}); c != 422 || !strings.Contains(b, "anterior a la fecha") {
		t.Errorf("vence antes de emitirse: %d %s", c, b)
	}
}

// La ficha del proveedor: cada movimiento dice de qué factura o pago salió.
// La orden de pago sale en PDF.
func TestLosMovimientosLlevanASuOrigenYLaOrdenDePago(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	iibb := e.regimen(t, "IIBB-MI", "iibb", 1.5)
	c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 1274,
		"fechaEmision": "2026-10-01", "neto": 1000, "iva21": 210, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0})
	if c != 200 {
		t.Fatalf("factura: %d %s", c, b)
	}
	factura := idDe(t, b)
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 1210, "medio": "transferencia", "referencia": "TR-1",
		"retenciones": []any{map[string]any{"regimenId": iibb, "base": 1000}}, "imputaciones": []any{map[string]any{"purchaseInvoiceId": factura, "importe": 1210}}})
	if c != 200 {
		t.Fatalf("pago: %d %s", c, b)
	}
	pago := idDe(t, b)
	_, b = pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor, nil)
	if !strings.Contains(b, `"purchaseInvoiceId":"`+factura+`"`) || !strings.Contains(b, `"supplierPaymentId":"`+pago+`"`) {
		t.Errorf("movimientos: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/pagos/"+pago, nil); !strings.Contains(b, `"numero":"0003-00001274"`) || !strings.Contains(b, `"importe":15`) {
		t.Errorf("ficha del pago: %s", b)
	}
	req := e.srv.URL + "/api/v1/admin/compras/pagos/" + pago + "/pdf"
	if c, b := pedir(t, adm, "GET", req, nil); c != 200 || !strings.HasPrefix(b, "%PDF") {
		t.Errorf("orden de pago: %d %.20s", c, b)
	}
	if c, _ := pedir(t, adm, "GET", e.u+"compras/pagos/"+fmt.Sprint("00000000-0000-4000-8000-000000000000"), nil); c != 404 {
		t.Errorf("pago que no existe: %d", c)
	}
}

// sinNBSP: Monto separa el signo del número con un espacio duro.
func sinNBSP(s string) string { return strings.ReplaceAll(s, "\u00a0", " ") }
