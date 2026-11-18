package reportes

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"mjbj/internal/pruebas"
)

// Los números del dueño, cada bloque con los casos que lo pueden romper: lo
// que no cuenta tiene que quedar afuera (la cuenta saldada, la factura ya
// pagada, la nota de crédito, el cheque endosado, la caja cerrada, el recibo
// anulado, el cobro en línea que ya está en un recibo).
func TestNumerosDelDueno(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	placa, _ := e.catalogo(t)

	// Me deben: A debe 800 de agosto (vencido: 30 días de crédito) y 500 de
	// hace cinco días; B está saldado; C tiene saldo a favor.
	a := e.id(t, `insert into customers (nombre, dias_credito) values ('A', 30) returning id`)
	b := e.id(t, `insert into customers (nombre) values ('B') returning id`)
	c := e.id(t, `insert into customers (nombre) values ('C') returning id`)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, created_at) values
		($1, 'compra', 1000, '2026-08-01T15:00:00Z'), ($1, 'pago', -200, '2026-09-01T15:00:00Z'), ($1, 'compra', 500, '2026-10-10T15:00:00Z'),
		($2, 'compra', 300, '2026-10-01T15:00:00Z'), ($2, 'pago', -300, '2026-10-02T15:00:00Z'),
		($3, 'pago', -50, '2026-10-02T15:00:00Z')`, a, b, c)

	// Debo: una vencida con un pago parcial, una que vence esta semana, una
	// sin vencimiento, una ya pagada y una nota de crédito.
	prov := e.id(t, `insert into suppliers (nombre) values ('Maderas del Sur') returning id`)
	compra := func(tipo string, numero int, total float64, vence any) string {
		return e.id(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision, fecha_vencimiento)
			values ($1, $2, 1, $3, $4, 0, 0, 0, 0, $4, '2026-09-01T00:00:00Z', $5) returning id`, prov, tipo, numero, total, vence)
	}
	f1 := compra("factura_a", 1, 1000, "2026-10-01T00:00:00Z")
	compra("factura_a", 2, 500, "2026-10-18T00:00:00Z")
	compra("factura_b", 3, 50, nil)
	f4 := compra("factura_a", 4, 200, "2026-12-01T00:00:00Z")
	compra("nota_credito_a", 5, 100, nil)
	pago := e.id(t, `insert into supplier_payments (supplier_id, total, neto) values ($1, 600, 600) returning id`, prov)
	e.exec(t, `insert into supplier_payment_allocations (payment_id, purchase_invoice_id, importe) values ($1, $2, 400), ($1, $3, 200)`, pago, f1, f4)

	// Cheques: a cobrar, el vencido en cartera y el depositado que vence el
	// 20; a cubrir, el propio del 17. No: el de fin de noviembre, ni el de un
	// tercero endosado a un proveedor.
	cheque := func(numero, sentido, estado, fecha string, importe float64) {
		e.exec(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado) values ($1, $2, 'Nación', $3, $4, $5)`,
			sentido, numero, fecha, importe, estado)
	}
	cheque("1001", "recibido", "cartera", "2026-10-10T15:00:00Z", 100)
	cheque("1002", "recibido", "depositado", "2026-10-20T15:00:00Z", 200)
	cheque("1003", "recibido", "cartera", "2026-11-30T15:00:00Z", 400)
	cheque("1004", "entregado", "entregado", "2026-10-17T15:00:00Z", 300)
	cheque("1005", "recibido", "entregado", "2026-10-16T15:00:00Z", 50)

	// Plata hoy: la caja abierta de Casa Central (la del Aserradero está
	// cerrada), lo cobrado hoy por banco, Mercado Pago y tarjeta.
	usuario := e.id(t, `select id from "user" limit 1`)
	abierta := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, '2026-10-15T11:00:00Z') returning id`, e.central, usuario)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto) values ($1, 'apertura', 1000), ($1, 'venta', 500), ($1, 'retiro', -200)`, abierta)
	cerrada := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at, cerrada_at, estado) values ($1, $2, '2026-10-14T11:00:00Z', '2026-10-14T20:00:00Z', 'cerrada') returning id`, e.aserradero, usuario)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto) values ($1, 'apertura', 999)`, cerrada)
	recibo := func(numero, estado, cuando string, partes ...[2]any) string {
		id := e.id(t, `insert into receipts (numero, customer_id, recibido_de, total, estado, origen, created_at) values ($1, $2, 'A', 0, $3, 'panel', $4) returning id`,
			numero, a, estado, cuando)
		for i, p := range partes {
			e.exec(t, `insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, $2, $3, $4)`, id, p[0], p[1], i)
		}
		return id
	}
	rhoy := recibo("R-1", "emitido", "2026-10-15T15:00:00Z", [2]any{"transferencia", 100}, [2]any{"mercado_pago", 50}, [2]any{"efectivo", 70})
	recibo("R-2", "emitido", "2026-10-14T15:00:00Z", [2]any{"transferencia", 999})
	recibo("R-3", "anulado", "2026-10-15T14:00:00Z", [2]any{"transferencia", 888})
	venta := e.pedido(t, "M-1", e.central, "entregado", "mostrador", time.Date(2026, 10, 15, 10, 0, 0, 0, Argentina), nil)
	e.exec(t, `update orders set cobrada_at = '2026-10-15T13:00:00Z' where id = $1`, venta)
	e.exec(t, `insert into order_payments (order_id, medio, importe) values ($1, 'debito', 80), ($1, 'transferencia', 20), ($1, 'efectivo', 500)`, venta)
	e.exec(t, `insert into payments (tipo, proveedor, medio, monto, estado, acreditado_at) values ('pedido', 'mercado_pago', 'visa', 30, 'aprobado', '2026-10-15T14:00:00Z')`)
	enRecibo := e.id(t, `insert into payments (customer_id, tipo, proveedor, medio, monto, estado, acreditado_at) values ($1, 'deuda', 'mercado_pago', 'visa', 50, 'aprobado', '2026-10-15T14:00:00Z') returning id`, a)
	e.exec(t, `update receipt_parts set payment_id = $1 where receipt_id = $2 and medio = 'mercado_pago'`, enRecibo, rhoy)

	// Ganancia: octubre hasta hoy contra septiembre hasta el 15 a las 12.
	e.pedido(t, "V-1", e.central, "entregado", "mostrador", time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 1210.0, 600.0})
	e.pedido(t, "V-2", e.central, "cancelado", "mostrador", time.Date(2026, 10, 6, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 9999.0, 1.0})
	e.pedido(t, "V-3", e.central, "entregado", "mostrador", time.Date(2026, 9, 10, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 605.0, 300.0})
	e.pedido(t, "V-4", e.central, "entregado", "mostrador", time.Date(2026, 9, 20, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 121.0, nil})
	e.exec(t, `insert into expenses (fecha, categoria, descripcion, importe, medio) values
		('2026-10-03T00:00:00Z', 'flete', 'a', 100, 'efectivo'), ('2026-09-15T00:00:00Z', 'flete', 'b', 50, 'efectivo'),
		('2026-09-16T00:00:00Z', 'flete', 'c', 30, 'efectivo')`)

	// Las ventas del mostrador se cobran en el acto: ninguna es «sin cobrar».
	e.exec(t, `update orders set estado_pago = 'pagado' where origen = 'mostrador'`)

	c200, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	if err := json.Unmarshal([]byte(cuerpo), &n); c200 != 200 || err != nil {
		t.Fatalf("%d %s", c200, cuerpo)
	}
	if n.MeDeben != (MeDeben{Total: 1300, Vencido: 800, Clientes: 1, ClientesConVencido: 1}) {
		t.Errorf("me deben: %+v", n.MeDeben)
	}
	if n.Debo != (Debo{Total: 1150, Facturas: 3, Vencido: 600, FacturasVencidas: 1, EstaSemana: 500, FacturasEstaSemana: 1}) {
		t.Errorf("debo: %+v", n.Debo)
	}
	if n.Cheques != (ChequesDeLaSemana{ACobrar: Monto{300, 2}, ACubrir: Monto{300, 1}}) {
		t.Errorf("cheques: %+v", n.Cheques)
	}
	p := n.PlataHoy
	if len(p.Cajas) != 1 || p.Cajas[0].Sucursal != "Casa Central" || p.Cajas[0].Esperado != 1300 || p.Efectivo != 1300 ||
		p.Banco != 120 || p.MercadoPago != 80 || p.Tarjetas != 80 || p.Cheques != (Monto{500, 2}) || p.Total != 2000 {
		t.Errorf("plata hoy: %+v", p)
	}
	g := n.Ganancia
	if g.Actual != (Resultado{VentasNetas: 1000, Costo: 600, Gastos: 100, Resultado: 300}) ||
		g.Anterior != (Resultado{VentasNetas: 500, Costo: 300, Gastos: 50, Resultado: 150}) || g.Variacion == nil || *g.Variacion != 100 {
		t.Errorf("ganancia: %+v", g)
	}
	if c, _, _ := pedir(t, ven, e.u+"inicio/dueno"); c != 403 {
		t.Errorf("el vendedor no ve los números del dueño: %d", c)
	}

	// El cierre: el mes entero contra el anterior entero.
	_, cuerpo, _ = pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	var r ResumenDelMes
	_ = json.Unmarshal([]byte(cuerpo), &r)
	if r.Resultado.Actual.Resultado != 300 || r.Resultado.Anterior != (Resultado{VentasNetas: 600, Costo: 300, Gastos: 80, Resultado: 220, LineasSinCosto: 1}) {
		t.Errorf("resultado del cierre: %+v", r.Resultado)
	}
}

func TestVariacionConSigno(t *testing.T) {
	casos := []struct{ actual, previo, quiere float64 }{{300, 150, 100}, {100, -100, 200}, {-50, 100, -150}, {50, 100, -50}}
	for _, c := range casos {
		if v := VariacionConSigno(c.actual, c.previo); v == nil || *v != c.quiere {
			t.Errorf("%v contra %v: %v", c.actual, c.previo, v)
		}
	}
	if VariacionConSigno(10, 0) != nil {
		t.Error("sin anterior no hay comparación")
	}
}

// Para hoy, lo que se sumó: WhatsApp, presupuestos fuera de plazo, pedidos
// atrasados, cortes sin retirar, deuda vencida y, con la tienda apagada, la
// carga del catálogo. Cada uno solo para quien puede abrir su pantalla.
func TestParaHoyLoQueSeSumo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	e.catalogo(t)
	pruebas.TiendaApagada(t, e.pool)
	ahora := e.s.ahora()
	cliente := e.id(t, `insert into customers (nombre, dias_credito) values ('A', 30) returning id`)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'compra', 1000, '2026-08-01T15:00:00Z')`, cliente)
	e.exec(t, `insert into whatsapp_conversaciones (wa_jid, no_leidos) values ('1@s', 2), ('2@s', 0)`)
	e.exec(t, `insert into quotes (numero, contacto_nombre, estado, responde_hasta) values ('P-1', 'X', 'pendiente', $1), ('P-2', 'Y', 'pendiente', $2)`,
		ahora.Add(-time.Hour), ahora.Add(time.Hour))
	q := e.id(t, `insert into quotes (numero, contacto_nombre, estado, necesita_para) values ('P-3', 'Z', 'aceptado', '2026-10-10T12:00:00Z') returning id`)
	pedido := e.pedido(t, "A-1", e.central, "preparando", "mostrador", time.Date(2026, 10, 9, 12, 0, 0, 0, Argentina), nil)
	e.exec(t, `update orders set quote_id = $1 where id = $2`, q, pedido)
	e.exec(t, `insert into cutting_orders (numero, contacto_nombre, material_descripcion, estado) values ('C-1', 'X', 'MDF', 'terminado'), ('C-2', 'Y', 'MDF', 'retirado')`)

	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/pendientes")
	for _, quiere := range []string{`"clave":"whatsapp","cantidad":1`, `"clave":"presupuestos-sin-responder","cantidad":1`,
		`"clave":"pedidos-atrasados","cantidad":1`, `"clave":"cortes-sin-retirar","cantidad":1`, `"clave":"deuda-vencida","cantidad":1`,
		`"clave":"catalogo-precio","cantidad":2`, `"clave":"catalogo-foto","cantidad":2`} {
		if !strings.Contains(cuerpo, quiere) {
			t.Errorf("falta %s en %s", quiere, cuerpo)
		}
	}
	// Las dos medidas tienen unidades: no falta stock.
	if strings.Contains(cuerpo, "catalogo-stock") {
		t.Errorf("stock: %s", cuerpo)
	}
	_, cuerpo, _ = pedir(t, dep, e.u+"inicio/pendientes")
	for _, no := range []string{"whatsapp", "presupuestos-sin-responder", "deuda-vencida", "catalogo-precio", "catalogo-foto"} {
		if strings.Contains(cuerpo, no) {
			t.Errorf("el depósito no ve %s: %s", no, cuerpo)
		}
	}
	if !strings.Contains(cuerpo, "cortes-sin-retirar") || !strings.Contains(cuerpo, "pedidos-atrasados") {
		t.Errorf("depósito: %s", cuerpo)
	}
	// Con la tienda encendida, la carga del catálogo ya no es pendiente.
	e.exec(t, `update site_settings set valor = 'si' where clave = 'tienda_activa'`)
	if _, cuerpo, _ = pedir(t, adm, e.u+"inicio/pendientes"); strings.Contains(cuerpo, "catalogo-") {
		t.Errorf("tienda encendida: %s", cuerpo)
	}
}

// «Me deben» suma lo entregado sin cobrar que no pasó por la cuenta
// corriente, por su saldo: el dueño vio «Me deben $0» con mercadería
// entregada y sin cobrar. Lo que ya es deuda de la cuenta no se cuenta dos
// veces.
func TestMeDebenConPedidosSinCobrar(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	cliente := e.id(t, `insert into customers (nombre, dias_credito) values ('Constructora', 30) returning id`)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at) values ($1, 'compra', 1000, 'P-CC', '2026-10-10T15:00:00Z')`, cliente)
	cuando := time.Date(2026, 10, 12, 10, 0, 0, 0, Argentina)
	pedido := func(numero, origen, estado, estadoPago string, medio any, total float64, cli *string) string {
		id := e.pedido(t, numero, e.central, estado, origen, cuando, cli)
		e.exec(t, `update orders set estado_pago = $2, medio_pago = $3, total = $4 where id = $1`, id, estadoPago, medio, total)
		return id
	}
	// Cuentan: el entregado en efectivo y pendiente, y el señado (por su saldo).
	pedido("P-1", "presupuesto", "entregado", "pendiente", "efectivo", 500, nil)
	senado := pedido("P-2", "tienda", "entregado", "pendiente", "transferencia", 800, nil)
	e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, acreditado_at) values ($1, 'pedido', 'transferencia', 'transferencia', 200, 'aprobado', '2026-10-11T15:00:00Z')`, senado)
	// No cuentan: a cuenta corriente (ya está en la cuenta: la de P-CC),
	// pagado, cancelado, todavía «listo», la venta del mostrador «parcial» y
	// el del checkout que asentó su compra en la cuenta.
	pedido("P-CC", "presupuesto", "entregado", "pendiente", "cuenta_corriente", 1000, &cliente)
	pedido("P-3", "presupuesto", "entregado", "pagado", "efectivo", 300, nil)
	pedido("P-4", "presupuesto", "cancelado", "pendiente", "efectivo", 300, nil)
	pedido("P-5", "presupuesto", "listo", "pendiente", "efectivo", 300, nil)
	pedido("P-6", "mostrador", "entregado", "parcial", "efectivo", 300, &cliente)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at) values ($1, 'compra', 200, 'P-7', '2026-10-12T15:00:00Z')`, cliente)
	pedido("P-7", "tienda", "entregado", "pendiente", nil, 200, &cliente)

	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	if err := json.Unmarshal([]byte(cuerpo), &n); err != nil {
		t.Fatal(cuerpo)
	}
	// La cuenta corriente: 1000 + 200 (P-7) del único cliente, nada vencido.
	quiere := MeDeben{Total: 2300, Vencido: 0, Clientes: 1, ClientesConVencido: 0, PedidosSinCobrar: Monto{Total: 1100, Cantidad: 2}}
	if n.MeDeben != quiere {
		t.Errorf("me deben: %+v, quería %+v", n.MeDeben, quiere)
	}
}

// Las anuladas de los últimos siete días: Devuelto es el efectivo que salió
// de la caja (el mismo número que el arqueo), no el total de la venta; y
// las que siguen con su factura viva se cuentan aparte.
func TestAnuladasDeLaSemana(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	usuario := e.id(t, `select id from "user" limit 1`)
	turno := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, '2026-10-08T11:00:00Z') returning id`, e.central, usuario)
	anulada := func(numero string, total float64, cuando time.Time, efectivo float64) string {
		id := e.pedido(t, numero, e.central, "cancelado", "mostrador", cuando.Add(-time.Hour), nil)
		e.exec(t, `update orders set total = $2, estado_pago = 'reintegrado' where id = $1`, id, total)
		e.exec(t, `insert into order_status_history (order_id, estado, nota, created_by_user_id, created_at) values ($1, 'cancelado', 'Anulada en el mostrador: error', $2, $3)`, id, usuario, cuando)
		if efectivo > 0 {
			e.exec(t, `insert into cash_movements (session_id, tipo, monto, order_id, created_at) values ($1, 'devolucion', $2, $3, $4)`, turno, -efectivo, id, cuando)
		}
		return id
	}
	factura := func(pedido, tipo, estado string, numero int) {
		e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
			values ($1, 3, $2, 'X', 100, 21, 0, 0, 0, 121, $3, '2026-10-14T15:00:00Z', '7612345678', $4)`, tipo, numero, estado, pedido)
	}
	// Hoy: 300 en efectivo y 200 con tarjeta, con la factura viva.
	conFactura := anulada("M-1", 500, time.Date(2026, 10, 15, 10, 0, 0, 0, Argentina), 300)
	factura(conFactura, "factura_b", "autorizada", 1)
	// Ayer, a cuenta corriente: no salió plata.
	anulada("M-2", 400, time.Date(2026, 10, 14, 18, 0, 0, 0, Argentina), 0)
	// El sábado, con tarjeta: tampoco salió del cajón. Su factura ya tiene
	// la nota de crédito que la anula.
	conNota := anulada("M-3", 250, time.Date(2026, 10, 10, 18, 0, 0, 0, Argentina), 0)
	factura(conNota, "factura_b", "anulada", 2)
	factura(conNota, "nota_credito_b", "autorizada", 3)
	// Hace siete días a las 23:30: afuera, con su devolución.
	anulada("M-4", 999, time.Date(2026, 10, 8, 23, 30, 0, 0, Argentina), 999)
	// Una venta vigente no cuenta.
	e.pedido(t, "M-5", e.central, "entregado", "mostrador", time.Date(2026, 10, 15, 9, 0, 0, 0, Argentina), nil)

	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	if err := json.Unmarshal([]byte(cuerpo), &n); err != nil {
		t.Fatal(cuerpo)
	}
	if quiere := (Anuladas{Cantidad: 3, Total: 1150, Devuelto: 300, ConFacturaViva: 1}); n.Anuladas != quiere {
		t.Errorf("anuladas: %+v, quería %+v", n.Anuladas, quiere)
	}
}

// Un costo en $0 no es un costo: el renglón cuenta como sin costo y no suma
// al margen. La fila que mezcla renglones con y sin costo mide su margen
// contra la venta de los que tienen (NetoCosteado). Y Reportes, la Ganancia
// del mes y el resultado del Cierre dan la misma venta sin IVA.
func TestCostoCeroYUnSoloVendido(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, tirante := e.catalogo(t)
	// 1210 con costo 600, 605 a costo $0 (la recepción cargada en cero) y
	// 121 sin costo: vendido sin IVA 1000 + 500 + 100.
	e.pedido(t, "V-1", e.central, "entregado", "mostrador", time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina), nil,
		[4]any{placa, 1.0, 1210.0, 600.0}, [4]any{placa, 1.0, 605.0, 0.0}, [4]any{tirante, 1.0, 121.0, nil})

	_, cuerpo, _ := pedir(t, adm, e.u+"reportes/ventas?corte=producto&periodo=mes")
	var filas []FilaDeReporte
	if err := json.Unmarshal([]byte(cuerpo), &filas); err != nil {
		t.Fatal(cuerpo)
	}
	var vendido float64
	for _, f := range filas {
		vendido += f.NetoVenta
		if f.Etiqueta == "Fenólico" {
			if f.Costo == nil || *f.Costo != 600 || f.NetoCosteado != 1000 || f.NetoVenta != 1500 || f.LineasSinCosto != 1 {
				t.Errorf("fenólico: %+v", f)
			}
			if m := MargenDeLaFila(f); m == nil || *m != 400 {
				t.Errorf("margen del fenólico: %v", m)
			}
		}
	}
	if vendido != 1600 {
		t.Errorf("vendido sin IVA en Reportes: %v", vendido)
	}
	_, cuerpo, _ = pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	_ = json.Unmarshal([]byte(cuerpo), &n)
	if g := n.Ganancia.Actual; g.VentasNetas != vendido || g.Costo != 600 || g.LineasSinCosto != 2 {
		t.Errorf("ganancia: %+v", g)
	}
	_, cuerpo, _ = pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	var r ResumenDelMes
	_ = json.Unmarshal([]byte(cuerpo), &r)
	if r.Resultado.Actual.VentasNetas != vendido {
		t.Errorf("resultado del cierre: %+v", r.Resultado.Actual)
	}
}

// «Sin factura» del Cierre: lo vendido en el mes sin factura autorizada, con
// el neto de la cabecera (envío y descuento incluidos). La factura en
// borrador no factura; la cancelada no cuenta; la venta facturada en otro
// mes tampoco es «sin factura». Y no llega a los asientos.
func TestCierreSinFactura(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, _ := e.catalogo(t)
	octubre := time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina)
	factura := func(pedido, estado string, numero int, cae any, emitida string) {
		e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
			values ('factura_b', 3, $1, 'X', 1000, 210, 0, 0, 0, 1210, $2, $3, $4, $5)`, numero, estado, emitida, cae, pedido)
	}
	facturado := e.pedido(t, "F-1", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 1210.0, 600.0})
	factura(facturado, "autorizada", 1, "761", "2026-10-05T15:00:00Z")
	// Sin factura: 1210 con IVA más 121 de envío → 1100 sin IVA.
	sinFactura := e.pedido(t, "F-2", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 1210.0, 600.0})
	e.exec(t, `update orders set total = 1331 where id = $1`, sinFactura)
	// En borrador: 605 → 500.
	borrador := e.pedido(t, "F-3", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 605.0, 300.0})
	factura(borrador, "borrador", 2, nil, "2026-10-05T15:00:00Z")
	e.pedido(t, "F-4", e.central, "cancelado", "mostrador", octubre, nil, [4]any{placa, 1.0, 999.0, 1.0})
	// De octubre, facturado el 2 de noviembre: no es «sin factura».
	tarde := e.pedido(t, "F-5", e.central, "entregado", "mostrador", time.Date(2026, 10, 31, 20, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 1210.0, 600.0})
	factura(tarde, "autorizada", 3, "762", "2026-11-02T15:00:00Z")

	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	var r ResumenDelMes
	if err := json.Unmarshal([]byte(cuerpo), &r); err != nil {
		t.Fatal(cuerpo)
	}
	if r.SinFactura != (Totales{Total: 1600, Cantidad: 2}) {
		t.Errorf("sin factura: %+v", r.SinFactura)
	}
	if r.Ventas.Cantidad != 1 || r.Ventas.Neto != 1000 {
		t.Errorf("facturado: %+v", r.Ventas)
	}
	_, asientos, _ := pedir(t, adm, e.u+"cierre/asientos?periodo=2026-10")
	if strings.Contains(asientos, "1600") || strings.Contains(strings.ToLower(asientos), "sin factura") {
		t.Errorf("«sin factura» no va a los asientos: %s", asientos)
	}
}

// Una venta anulada con factura viva es un pendiente del cierre.
func TestCierreAnuladaConFacturaViva(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	viva := e.pedido(t, "A-1", e.central, "cancelado", "mostrador", time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina), nil)
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
		values ('factura_b', 3, 1, 'X', 100, 21, 0, 0, 0, 121, 'autorizada', '2026-10-05T15:00:00Z', '761', $1)`, viva)
	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	if !strings.Contains(cuerpo, `"clave":"facturas-vivas"`) || !strings.Contains(cuerpo, `"cantidad":1`) {
		t.Errorf("pendientes: %s", cuerpo)
	}
	e.exec(t, `update invoices set estado = 'anulada'`)
	if _, cuerpo, _ = pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10"); strings.Contains(cuerpo, "facturas-vivas") {
		t.Errorf("con la nota de crédito ya no es pendiente: %s", cuerpo)
	}
}
