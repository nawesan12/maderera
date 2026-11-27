package portal

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"mjbj/internal/clientes"
)

// Lo que encontró el mes simulado en producción (noviembre de 2026).

func TestImputarALaDeudaMasVieja(t *testing.T) {
	// H208: la empresa compró dos pedidos a cuenta y pagó casi todo; los
	// dos decían «Pago pendiente».
	debe := Imputar([]Asiento{
		{870400, "PED-1004", false, false},
		{4113000, "PED-1006", false, false},
		{-3483400, "REC-0001", false, false},
	})
	if debe["PED-1004"] != 0 || debe["PED-1006"] != 1500000 {
		t.Errorf("FIFO: %v", debe)
	}
	// La nota de crédito de un faltante baja su pedido, no el más viejo.
	debe = Imputar([]Asiento{
		{1000, "PED-1", false, false},
		{2000, "PED-2", false, false},
		{-500, "PED-2", false, false},
		{-1000, "REC-1", false, false},
	})
	if debe["PED-1"] != 0 || debe["PED-2"] != 1500 {
		t.Errorf("nota de crédito con referencia: %v", debe)
	}
	// Un ajuste suelto ocupa su lugar en la fila y no aparece.
	debe = Imputar([]Asiento{
		{300, "", false, false},
		{1000, "PED-1", false, false},
		{-800, "REC-1", false, false},
	})
	if debe["PED-1"] != 500 || len(debe) != 1 {
		t.Errorf("ajuste suelto: %v", debe)
	}
	// Pagar de más no deja negativos.
	if debe = Imputar([]Asiento{{100, "PED-1", false, false}, {-300, "REC-1", false, false}}); debe["PED-1"] != 0 {
		t.Errorf("a favor: %v", debe)
	}
}

func TestMisDatosFiscales(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	u := e.srv.URL + "/api/v1/cuenta/"

	// H078: el dígito verificador.
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "Juan", "cuit": "23-33555013-8", "condicionIva": "monotributista"}); c != 422 ||
		!strings.Contains(b, "El CUIT no es válido") {
		t.Errorf("CUIT con verificador mal: %d %s", c, b)
	}
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "Juan", "cuit": "23-33555013-7", "condicionIva": "monotributista"}); c != 200 {
		t.Fatalf("CUIT bien: %d %s", c, b)
	}
	// Sin facturas ni cuenta, cambiarlo queda en la bitácora.
	var anotado int
	_ = e.pool.QueryRow(ctx, `select count(*) from audit_log where entidad = 'cliente' and entidad_id = $1`, idJuan).Scan(&anotado)
	if anotado != 1 {
		t.Errorf("bitácora: %d", anotado)
	}

	// H079: con cuenta corriente, lo fiscal ya no se cambia desde acá.
	if _, err := e.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, referencia) values ($1, 'compra', 1000, 'PED-1')`, idJuan); err != nil {
		t.Fatal(err)
	}
	if _, b := pedir(t, juan, "GET", u+"ficha", nil); !strings.Contains(b, `"datosFiscalesFijos":true`) {
		t.Errorf("ficha: %s", b)
	}
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "Juan", "cuit": "", "condicionIva": "consumidor_final"}); c != 422 ||
		!strings.Contains(b, "desde el local") {
		t.Errorf("pasarse a consumidor final: %d %s", c, b)
	}
	// El nombre y el teléfono sí; lo fiscal se queda como estaba.
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "Juan Pérez", "telefono": "223 555"}); c != 200 {
		t.Fatalf("nombre: %d %s", c, b)
	}
	_, b := pedir(t, juan, "GET", u+"ficha", nil)
	if !strings.Contains(b, `"nombre":"Juan Pérez"`) || !strings.Contains(b, `"cuit":"23335550137"`) || !strings.Contains(b, `"condicionIva":"monotributista"`) {
		t.Errorf("ficha después: %s", b)
	}
}

func TestPedidosParaElCliente(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	u := e.srv.URL + "/api/v1/cuenta/"
	pedido := func(numero, estado, origen, medio, notas string, total float64) {
		if _, err := e.pool.Exec(ctx, `insert into orders (numero, contacto_nombre, customer_id, total, subtotal, estado, origen, medio_pago, notas)
			values ($1, 'Juan', $2, $3, $3, $4::estado_pedido, $5::origen_pedido, $6::medio_pago, nullif($7, ''))`,
			numero, idJuan, total, estado, origen, medio, notas); err != nil {
			t.Fatal(err)
		}
	}
	pedido("PED-1004", "entregado", "mostrador", "cuenta_corriente", "Pidió por WhatsApp. Ojo, paga tarde", 870400)
	pedido("PED-1006", "pendiente", "mostrador", "cuenta_corriente", "", 4113000)
	pedido("PED-1121", "cancelado", "mostrador", "cuenta_corriente", "Anulada: se cargó a la Mueblería y era de la Constructora", 100)
	pedido("PED-1200", "cancelado", "tienda", "transferencia", "Tocar timbre\nAnulada: sin stock", 100)
	pedido("PED-1130", "cancelado", "telefono", "transferencia", "", 100)
	for _, m := range []struct {
		tipo  string
		monto float64
		ref   string
	}{{"compra", 870400, "PED-1004"}, {"compra", 4113000, "PED-1006"}, {"pago", -3483400, "REC-0001"}} {
		if _, err := e.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, referencia) values ($1, $2::tipo_movimiento_cuenta, $3, $4)`,
			idJuan, m.tipo, m.monto, m.ref); err != nil {
			t.Fatal(err)
		}
	}

	_, b := pedir(t, juan, "GET", u+"pedidos", nil)
	var lista []Pedido
	_ = json.Unmarshal([]byte(b), &lista)
	porNumero := map[string]Pedido{}
	for _, p := range lista {
		porNumero[p.Numero] = p
	}
	// H386: la venta del mostrador anulada sin remito ni factura no se lista.
	if _, ok := porNumero["PED-1121"]; ok {
		t.Errorf("la venta anulada del cliente equivocado sigue en la lista: %s", b)
	}
	if _, ok := porNumero["PED-1200"]; !ok {
		t.Errorf("el pedido de la tienda cancelado tiene que seguir: %s", b)
	}
	// H310: el cancelado que se tomó por teléfono también es del cliente.
	if _, ok := porNumero["PED-1130"]; !ok {
		t.Errorf("el pedido por teléfono cancelado tiene que seguir: %s", b)
	}
	// Sin ningún retiro no hay «en acopio» (mes simulado, PED-1133).
	if porNumero["PED-1006"].EnAcopio {
		t.Errorf("PED-1006 no tuvo retiros: %+v", porNumero["PED-1006"])
	}
	// H208: lo que falta de cada pedido a cuenta.
	if p := porNumero["PED-1004"]; p.DebeEnCuenta == nil || *p.DebeEnCuenta != 0 {
		t.Errorf("PED-1004: %+v", p)
	}
	if p := porNumero["PED-1006"]; p.DebeEnCuenta == nil || *p.DebeEnCuenta != 1500000 {
		t.Errorf("PED-1006: %+v", p)
	}
	if p := porNumero["PED-1200"]; p.DebeEnCuenta != nil {
		t.Errorf("un pedido sin cuenta no debe nada en la cuenta: %+v", p)
	}

	// H302 (segunda vuelta): la nota de crédito de una devolución con
	// factura lleva la etiqueta de la factura en la cuenta, pero baja lo que
	// falta de su pedido y no la deuda más vieja.
	pedido("PED-1007", "entregado", "mostrador", "cuenta_corriente", "", 500000)
	var idPed, factura, nota, mov string
	if err := e.pool.QueryRow(ctx, `select id from orders where numero = 'PED-1007'`).Scan(&idPed); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, referencia) values ($1, 'compra', 500000, 'PED-1007')`, idJuan); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(ctx, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, order_id)
		values ('factura_a', 15, 2, 'Juan', 413223.14, 86776.86, 0, 0, 0, 500000, 'emitida', now(), $1) returning id`, idPed).Scan(&factura); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(ctx, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, order_id, comprobante_origen_id)
		values ('nota_credito_a', 15, 1, 'Juan', 82644.63, 17355.37, 0, 0, 0, 100000, 'emitida', now(), $1, $2) returning id`, idPed, factura).Scan(&nota); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(ctx, `insert into account_movements (customer_id, tipo, monto, detalle, referencia)
		values ($1, 'nota_credito', -100000, 'Devolución de la venta PED-1007: faltante', 'Factura A 0015-00000002') returning id`, idJuan).Scan(&mov); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into devoluciones (clave, order_id, invoice_id, nota_id, importe, destino, motivo, account_movement_id)
		values ('h302', $1, $2, $3, 100000, 'cuenta', 'faltante', $4)`, idPed, factura, nota, mov); err != nil {
		t.Fatal(err)
	}
	_, b = pedir(t, juan, "GET", u+"pedidos", nil)
	lista = nil
	_ = json.Unmarshal([]byte(b), &lista)
	for _, p := range lista {
		porNumero[p.Numero] = p
	}
	if p := porNumero["PED-1007"]; p.DebeEnCuenta == nil || *p.DebeEnCuenta != 400000 {
		t.Errorf("PED-1007 tras la nota de la devolución: %+v", p)
	}
	if p := porNumero["PED-1006"]; p.DebeEnCuenta == nil || *p.DebeEnCuenta != 1500000 {
		t.Errorf("la nota de PED-1007 no es de PED-1006: %+v", p)
	}
	// Lo de abajo mira PED-1004 y PED-1200 solos.
	if _, err := e.pool.Exec(ctx, `delete from devoluciones where clave = 'h302'`); err != nil {
		t.Fatal(err)
	}

	// La lista dice «Verificando tu pago» como el detalle: trae lo informado.
	pedido("PED-1129", "pendiente", "tienda", "transferencia", "", 300000)
	if _, err := e.pool.Exec(ctx, `insert into payments (order_id, proveedor, monto, estado)
		select id, 'transferencia', 300000, 'en_revision' from orders where numero = 'PED-1129'`); err != nil {
		t.Fatal(err)
	}
	_, b = pedir(t, juan, "GET", u+"pedidos", nil)
	if !strings.Contains(b, `"numero":"PED-1129"`) || !strings.Contains(b, `"enRevision":300000`) {
		t.Errorf("lo informado en la lista: %s", b)
	}

	// H084: las notas del vendedor no le llegan como «Tu nota».
	if _, b := pedir(t, juan, "GET", u+"pedidos/PED-1004", nil); strings.Contains(b, "paga tarde") || !strings.Contains(b, `"debeEnCuenta":0`) {
		t.Errorf("notas del vendedor: %s", b)
	}
	// H310/H386: la del cliente queda, el motivo de la anulación no.
	if _, b := pedir(t, juan, "GET", u+"pedidos/PED-1200", nil); !strings.Contains(b, `"notas":"Tocar timbre"`) || strings.Contains(b, "sin stock") {
		t.Errorf("notas de la tienda: %s", b)
	}
	// El detalle de la anulada se sigue abriendo por número.
	if c, b := pedir(t, juan, "GET", u+"pedidos/PED-1121", nil); c != 200 || strings.Contains(b, "Mueblería") {
		t.Errorf("detalle de la anulada: %d %s", c, b)
	}
}

func TestPresupuestoConSuPedido(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	var q string
	if err := e.pool.QueryRow(ctx, `insert into quotes (numero, customer_id, contacto_nombre, estado, subtotal, total)
		values ('P-2026-0013', $1, 'Juan', 'aceptado', 1000, 1000) returning id`, idJuan).Scan(&q); err != nil {
		t.Fatal(err)
	}
	if _, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/presupuestos/P-2026-0013", nil); strings.Contains(b, `"pedido":"`) {
		t.Errorf("sin pedido todavía: %s", b)
	}
	if _, err := e.pool.Exec(ctx, `insert into orders (numero, contacto_nombre, customer_id, quote_id, total, subtotal)
		values ('PED-1300', 'Juan', $1, $2, 1000, 1000)`, idJuan, q); err != nil {
		t.Fatal(err)
	}
	if _, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/presupuestos/P-2026-0013", nil); !strings.Contains(b, `"pedido":"PED-1300"`) {
		t.Errorf("H215, el pedido del presupuesto: %s", b)
	}
}

// H210: el cliente ve su corte atado al pedido, con el estado y el despiece.
func TestPedidoConSuCorte(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	var pedido, corte string
	if err := e.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, customer_id, total, subtotal)
		values ('PED-1005', 'Juan', $1, 1000, 1000) returning id`, idJuan).Scan(&pedido); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(ctx, `insert into cutting_orders (numero, contacto_nombre, customer_id, order_id, material_descripcion, placas, estado)
		values ('CRT-1', 'Juan', $1, $2, 'Melamina blanca 18 mm', 2, 'terminado') returning id`, idJuan, pedido).Scan(&corte); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into cutting_items (cutting_order_id, largo_mm, ancho_mm, cantidad, orden) values ($1, 600, 400, 4, 0)`, corte); err != nil {
		t.Fatal(err)
	}
	_, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/pedidos/PED-1005", nil)
	if !strings.Contains(b, `"numero":"CRT-1"`) || !strings.Contains(b, `"estado":"terminado"`) || !strings.Contains(b, `"largoMm":600`) {
		t.Errorf("el corte del pedido: %s", b)
	}
}

// H302: la nota de crédito de un faltante aparece en su pedido y baja lo que
// falta pagar de ese pedido, no del más viejo.
func TestPedidoConSuNotaDeCredito(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	if _, err := e.pool.Exec(ctx, `insert into orders (numero, contacto_nombre, customer_id, total, subtotal, medio_pago)
		values ('PED-1004', 'Juan', $1, 1000, 1000, 'cuenta_corriente'), ('PED-1006', 'Juan', $1, 4113000, 4113000, 'cuenta_corriente')`, idJuan); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, referencia, detalle, created_at) values
		($1, 'compra', 1000, 'PED-1004', null, now() - interval '3 day'),
		($1, 'compra', 4113000, 'PED-1006', null, now() - interval '2 day'),
		($1, 'nota_credito', -187000, 'PED-1006', 'Faltante en REM-0002: 10 machimbres', now() - interval '1 day')`, idJuan); err != nil {
		t.Fatal(err)
	}
	_, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/pedidos/PED-1006", nil)
	if !strings.Contains(b, `"monto":-187000`) || !strings.Contains(b, "Faltante en REM-0002") || !strings.Contains(b, `"debeEnCuenta":3926000`) {
		t.Errorf("la nota de crédito del faltante: %s", b)
	}
	if _, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/pedidos/PED-1004", nil); !strings.Contains(b, `"debeEnCuenta":1000`) {
		t.Errorf("la del faltante no es del pedido más viejo: %s", b)
	}
}

// H302: el cheque que rebotó vuelve sobre el pedido que había pagado; no es
// una deuda nueva al final de la fila.
func TestImputarElChequeRechazado(t *testing.T) {
	debe := Imputar([]Asiento{
		{3168000, "PED-1128", false, false},
		{-264000, "PED-1128", false, false},
		{-1500000, "REC-0002", false, false},
		{1000000, "55500321", true, false},
	})
	if debe["PED-1128"] != 2404000 {
		t.Errorf("el pedido vuelve a deber lo del cheque: %v", debe)
	}
	if _, ok := debe["55500321"]; ok {
		t.Errorf("el cheque no es un comprobante con deuda propia: %v", debe)
	}
	// Si rebota más de lo libre, lo que sobra no se le carga a otro pedido.
	debe = Imputar([]Asiento{
		{1000, "PED-1", false, false},
		{-1000, "PED-1", false, false},
		{500, "CH-1", true, false},
	})
	if debe["PED-1"] != 0 {
		t.Errorf("lo revertido de más: %v", debe)
	}
}

// H090: la cuenta web creada antes que la ficha del mostrador, vinculada
// después desde el panel, ya está vinculada.
func TestFichaVinculadaDespues(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	obra, idObra := e.web(t, "obra@prueba.test")
	if _, b := pedir(t, obra, "GET", e.srv.URL+"/api/v1/cuenta/ficha", nil); !strings.Contains(b, `"vinculada":false`) {
		t.Fatalf("recién creada: %s", b)
	}
	if _, err := e.pool.Exec(ctx, `insert into audit_log (usuario_nombre, accion, entidad, entidad_id, descripcion) values ('Admin', 'editar', 'cliente', $1, $2)`,
		idObra, clientes.DescripcionDeVinculo); err != nil {
		t.Fatal(err)
	}
	if _, b := pedir(t, obra, "GET", e.srv.URL+"/api/v1/cuenta/ficha", nil); !strings.Contains(b, `"vinculada":true`) {
		t.Errorf("vinculada desde el panel: %s", b)
	}
}

// Tercera prueba, PED-1218: la nota de crédito de una devolución baja lo que
// cuesta el pedido, no es un pago. Un pago con la referencia del pedido sí.
func TestLaNotaDeCreditoNoEsUnPago(t *testing.T) {
	debe, neto := ImputarConNeto([]Asiento{
		{3168000, "PED-1218", false, false},
		{-264000, "PED-1218", false, true},
	})
	if debe["PED-1218"] != 2904000 || neto["PED-1218"] != 2904000 {
		t.Fatalf("solo la nota: debe %v, cuesta %v", debe, neto)
	}
	debe, neto = ImputarConNeto([]Asiento{
		{3168000, "PED-1218", false, false},
		{-264000, "PED-1218", false, true},
		{-1000000, "PED-1218", false, false},
	})
	if debe["PED-1218"] != 1904000 || neto["PED-1218"] != 2904000 {
		t.Fatalf("con un pago: debe %v, cuesta %v", debe, neto)
	}
}

// M2S1-017 y M3S3-012: el pago de un pedido va primero a ese pedido (el
// recibo del pedido, el que cobra su factura o el que lo nombra), y lo que
// sobra a la deuda más vieja. Antes cada pedido mostraba lo que se debía
// del otro.
func TestElPagoVaASuPedido(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	ids := map[string]string{}
	for _, p := range []struct {
		n     string
		total float64
	}{{"PED-1004", 836000}, {"PED-1019", 1610400}, {"PED-1250", 486000}, {"PED-1252", 352200}} {
		var id string
		if err := e.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, customer_id, total, subtotal, medio_pago, estado)
			values ($1, 'Juan', $2, $3, $3, 'cuenta_corriente', 'entregado') returning id`, p.n, idJuan, p.total).Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids[p.n] = id
	}
	dia := 0
	mov := func(tipo string, monto float64, ref string, recibo *string) {
		dia++
		if _, err := e.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, referencia, receipt_id, created_at)
			values ($1, $2::tipo_movimiento_cuenta, $3, $4, $5, now() - make_interval(days => 40 - $6::int))`, idJuan, tipo, monto, ref, recibo, dia); err != nil {
			t.Fatal(err)
		}
	}
	recibo := func(numero string, total float64, pedido, concepto string) *string {
		var id string
		if err := e.pool.QueryRow(ctx, `insert into receipts (numero, customer_id, recibido_de, total, origen, concepto, order_id)
			values ($1, $2, 'Juan', $3, 'panel', nullif($4, ''), nullif($5, '')::uuid) returning id`, numero, idJuan, total, concepto, ids[pedido]).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return &id
	}
	debe := func() map[string]float64 {
		_, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/pedidos", nil)
		var lista []Pedido
		_ = json.Unmarshal([]byte(b), &lista)
		r := map[string]float64{}
		for _, p := range lista {
			if p.DebeEnCuenta != nil {
				r[p.Numero] = *p.DebeEnCuenta
			}
		}
		return r
	}
	mov("compra", 836000, "PED-1004", nil)
	mov("pago", -25000, "REC-0001", recibo("REC-0001", 25000, "", ""))
	mov("pago", -300000, "REC-0004", recibo("REC-0004", 300000, "", ""))
	mov("compra", 1610400, "PED-1019", nil)
	mov("pago", -1800000, "REC-0005", recibo("REC-0005", 1800000, "PED-1019", "Cobro del pedido PED-1019"))
	if d := debe(); d["PED-1019"] != 0 || d["PED-1004"] != 321400 {
		t.Fatalf("el pago del pedido va a ese pedido: %v", d)
	}

	// El cobro de la factura de un pedido es de ese pedido, aunque haya
	// otro más viejo.
	mov("compra", 486000, "PED-1250", nil)
	mov("compra", 352200, "PED-1252", nil)
	var factura string
	if err := e.pool.QueryRow(ctx, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, order_id)
		values ('factura_a', 15, 101, 'Juan', 291074.38, 61125.62, 0, 0, 0, 352200, 'emitida', now(), $1) returning id`, ids["PED-1252"]).Scan(&factura); err != nil {
		t.Fatal(err)
	}
	r82 := recibo("REC-0082", 352200, "", "Cobro de Factura A 0015-00000101")
	if _, err := e.pool.Exec(ctx, `insert into invoice_payments (invoice_id, medio, monto, receipt_id) values ($1, 'transferencia', 352200, $2)`, factura, *r82); err != nil {
		t.Fatal(err)
	}
	mov("pago", -352200, "REC-0082", r82)
	if d := debe(); d["PED-1252"] != 0 || d["PED-1250"] != 486000 || d["PED-1004"] != 321400 {
		t.Fatalf("la factura cobrada: %v", d)
	}

	// Anular el recibo del pedido lo vuelve a dejar debiendo a él.
	mov("ajuste", 352200, "REC-0082", r82)
	if d := debe(); d["PED-1252"] != 352200 || d["PED-1250"] != 486000 || d["PED-1004"] != 321400 {
		t.Fatalf("la anulación vuelve sobre su pedido: %v", d)
	}
}
