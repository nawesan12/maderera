package reportes

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"mjbj/internal/compras"
	"mjbj/internal/csvexcel"
	"mjbj/internal/facturacion"
	"mjbj/internal/jsmath"
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
	// El libro del proveedor, como lo dejan CargarFactura y el pago: las
	// cuatro facturas, la nota de crédito y el pago.
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto) values ($1, 'factura', 1750), ($1, 'nota_credito', -100), ($1, 'pago', -600)`, prov)

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
	// El libro debe 1050 (la nota de crédito sin imputar resta): lo de esta
	// semana se topea en lo que queda después de lo vencido.
	if n.Debo != (Debo{Total: 1050, Facturas: 3, Vencido: 600, FacturasVencidas: 1, EstaSemana: 450, FacturasEstaSemana: 1, Proveedores: 1}) {
		t.Errorf("debo: %+v", n.Debo)
	}
	if n.Cheques != (ChequesDeLaSemana{ACobrar: Monto{300, 2}, ACubrir: Monto{300, 1}}) {
		t.Errorf("cheques: %+v", n.Cheques)
	}
	p := n.PlataHoy
	if len(p.Cajas) != 1 || p.Cajas[0].Sucursal != "Casa Central" || p.Cajas[0].Esperado != 1300 || p.Efectivo != 1300 ||
		p.Banco != 120 || p.MercadoPago != 80 || p.Tarjetas != 80 || p.Cheques != (Monto{500, 2}) ||
		// El depositado sin acreditar sigue siendo plata de la casa (H406).
		// Lo movido hoy en el banco (120) no suma sin un saldo cargado (M2S2-100).
		// El retiro a la caja fuerte está en su saldo (recorrido M4-113).
		p.CajaFuerte != 200 || p.ChequesDepositados != (Monto{200, 1}) || p.Total != 2280 {
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
	// Septiembre: los 100 de V-4, sin costo, quedan afuera del resultado.
	if r.Resultado.Actual.Resultado != 300 ||
		r.Resultado.Anterior != (Resultado{VentasNetas: 600, VentasSinCosto: 100, Costo: 300, Gastos: 80, Resultado: 120, LineasSinCosto: 1}) {
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

// **«Debo» daba una cifra en el Resumen y otra en Pagos.** El Resumen sumaba
// solo las facturas de compra: dejaba afuera el saldo inicial de ISIS, los
// ajustes y la deuda que nace con el remito, y un pago sin imputar lo dejaba
// por encima de lo que se debe. Ahora sale del libro de cada proveedor, el
// mismo que lista Pagos (incluidos los inactivos con deuda), y las dos
// pantallas dicen lo mismo.
func TestDeboSaleDelLibro(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	proveedor := func(nombre, estado string) string {
		return e.id(t, `insert into suppliers (nombre, estado) values ($1, $2::estado_proveedor) returning id`, nombre, estado)
	}
	libro := func(prov, tipo string, monto float64) {
		e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto) values ($1, $2::tipo_movimiento_proveedor, $3)`, prov, tipo, monto)
	}
	// El saldo inicial que vino de ISIS, sin ninguna factura.
	isis := proveedor("Saldo de ISIS", "activo")
	libro(isis, "ajuste", 1000)
	// Lo recibido con remito, todavía sin factura.
	remito := proveedor("Con remito", "activo")
	libro(remito, "factura", 500)
	// Una factura vencida de 800 y un pago a cuenta de 500 sin imputar: se
	// deben 300 y lo vencido no puede pasar de ahí.
	aCuenta := proveedor("Pago a cuenta", "activo")
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision, fecha_vencimiento)
		values ($1, 'factura_a', 1, 1, 800, 0, 0, 0, 0, 800, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')`, aCuenta)
	libro(aCuenta, "factura", 800)
	libro(aCuenta, "pago", -500)
	// Un anticipo: el saldo a favor no descuenta lo que se le debe a otro.
	anticipo := proveedor("Anticipo", "activo")
	libro(anticipo, "pago", -200)
	// Uno al que ya no se le compra, con deuda.
	inactivo := proveedor("Inactivo", "inactivo")
	libro(inactivo, "ajuste", 100)
	// Uno dado de baja del todo no cuenta.
	borrado := proveedor("Borrado", "activo")
	libro(borrado, "ajuste", 9999)
	e.exec(t, `update suppliers set active = false where id = $1`, borrado)

	d, err := e.s.Debo(ctx, ahoraDePrueba)
	if err != nil {
		t.Fatal(err)
	}
	if d != (Debo{Total: 1900, Facturas: 1, Vencido: 300, FacturasVencidas: 1, SinFactura: 1600, Proveedores: 4}) {
		t.Fatalf("debo: %+v", d)
	}
	// La misma cifra que Pagos: la suma de los libros con saldo positivo.
	lista, err := compras.Nuevo(e.pool, silencio).ListarProveedores(ctx, "", "")
	if err != nil {
		t.Fatal(err)
	}
	suma := 0.0
	for _, p := range lista {
		if p.Saldo > 0.005 {
			suma += p.Saldo
		}
	}
	if jsmath.Redondear2(suma) != d.Total {
		t.Fatalf("Pagos dice %v y el Resumen %v", suma, d.Total)
	}
}

func TestDeudaConProveedor(t *testing.T) {
	casos := []struct {
		libro, facturado, vencido, semana float64
		quiere                            DeudaDeUnProveedor
	}{
		{0, 500, 500, 0, DeudaDeUnProveedor{}},
		{-200, 0, 0, 0, DeudaDeUnProveedor{}},
		{1000, 0, 0, 0, DeudaDeUnProveedor{Debe: 1000, SinFactura: 1000}},
		{300, 800, 800, 0, DeudaDeUnProveedor{Debe: 300, Vencido: 300}},
		{1050, 1150, 600, 500, DeudaDeUnProveedor{Debe: 1050, Vencido: 600, EstaSemana: 450}},
		{1500, 1000, 400, 300, DeudaDeUnProveedor{Debe: 1500, Vencido: 400, EstaSemana: 300, SinFactura: 500}},
	}
	for _, c := range casos {
		if r := DeudaConProveedor(c.libro, c.facturado, c.vencido, c.semana); r != c.quiere {
			t.Errorf("%+v: %+v", c, r)
		}
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
	e.exec(t, `update invoices set comprobante_origen_id = (select id from invoices where numero = 2) where numero = 3`)
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
// del mes y el resultado del Cierre dan la misma venta sin IVA; la Ganancia
// deja afuera lo vendido sin costo, como el margen de Reportes.
func TestCostoCeroYUnSoloVendido(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, tirante := e.catalogo(t)
	// 1210 con costo 600, 605 a costo $0 (la recepción cargada en cero) y
	// 121 sin costo: vendido sin IVA 1000 + 500 + 100.
	e.pedido(t, "V-1", e.central, "entregado", "mostrador", time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina), nil,
		[4]any{placa, 1.0, 1210.0, 600.0}, [4]any{placa, 1.0, 605.0, 0.0}, [4]any{tirante, 1.0, 121.0, nil})

	_, cuerpo, _ := pedir(t, adm, e.u+"reportes/ventas?corte=producto&periodo=mes")
	var rep ReporteDeVentas
	if err := json.Unmarshal([]byte(cuerpo), &rep); err != nil {
		t.Fatal(cuerpo)
	}
	for _, f := range rep.Filas {
		if f.Etiqueta == "Fenólico" {
			if f.Costo == nil || *f.Costo != 600 || f.NetoCosteado != 1000 || f.NetoVenta != 1500 || f.LineasSinCosto != 1 {
				t.Errorf("fenólico: %+v", f)
			}
			if m := MargenDeLaFila(f); m == nil || *m != 400 {
				t.Errorf("margen del fenólico: %v", m)
			}
		}
	}
	vendido := rep.Totales.NetoVenta
	if vendido != 1600 || rep.Totales.NetoCosteado != 1000 || rep.Totales.LineasSinCosto != 2 {
		t.Errorf("totales de Reportes: %+v", rep.Totales)
	}
	_, cuerpo, _ = pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	_ = json.Unmarshal([]byte(cuerpo), &n)
	// 1600 vendido, 600 sin costo afuera, 600 de costo: 400, el margen de
	// Reportes (1000 − 600). Contar los 600 sin costo daba 1000.
	quiere := Resultado{VentasNetas: vendido, VentasSinCosto: 600, Costo: 600, Resultado: 400, LineasSinCosto: 2}
	if g := n.Ganancia.Actual; g != quiere {
		t.Errorf("ganancia: %+v, quería %+v", g, quiere)
	}
	if m := rep.Totales.MargenDelTotal(); m == nil || *m != n.Ganancia.Actual.Resultado {
		t.Errorf("la ganancia sin gastos es el margen de Reportes: %v", m)
	}
	_, cuerpo, _ = pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	var r ResumenDelMes
	_ = json.Unmarshal([]byte(cuerpo), &r)
	// Lo vendido del cierre, partido por factura, es lo que tiene costo: lo
	// sin costo va aparte (M3S1-020).
	if r.Resultado.Actual != quiere || r.Vendido.Total != rep.Totales.NetoCosteado {
		t.Errorf("resultado del cierre: %+v, vendido %+v", r.Resultado.Actual, r.Vendido)
	}
}

// Los totales de Reportes son los del período entero, no la suma de las 50
// filas que se ven: con 60 productos, cada corte da el mismo «Vendido sin
// IVA», el mismo costo y el mismo margen que la Ganancia del mes. Y el CSV
// cierra el total con esos números.
func TestTotalesDeReportesSinTope(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	e.catalogo(t)
	cat := e.id(t, `select id from categories limit 1`)
	cuando := time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina)
	for i := range 60 {
		p := e.id(t, `insert into products (slug, name, category_id, description, unit) values ($1, $1, $2, '', 'unidad') returning id`,
			fmt.Sprintf("p%02d", i), cat)
		v := e.id(t, `insert into product_variants (product_id, sku, label) values ($1, $2, 'u') returning id`, p, fmt.Sprintf("S%02d", i))
		var costo any = float64(50 + i)
		if i%3 == 0 {
			costo = nil
		}
		e.pedido(t, fmt.Sprintf("T-%02d", i), e.central, "entregado", "mostrador", cuando, nil, [4]any{v, 1.0, float64(121 * (i + 1)), costo})
	}
	// Uno sin vendedor ni usuario y un renglón libre, sin variante: también
	// cuentan.
	e.pedido(t, "T-L", e.central, "entregado", "tienda", cuando, nil, [4]any{nil, 1.0, 242.0, nil})

	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	_ = json.Unmarshal([]byte(cuerpo), &n)
	g := n.Ganancia.Actual
	for _, corte := range []string{"producto", "rubro", "elaboracion", "cliente", "vendedor", "sucursal", "canal"} {
		_, cuerpo, _ := pedir(t, adm, e.u+"reportes/ventas?periodo=mes&corte="+corte)
		var rep ReporteDeVentas
		if err := json.Unmarshal([]byte(cuerpo), &rep); err != nil {
			t.Fatal(cuerpo)
		}
		tt := rep.Totales
		if jsmath.Redondear2(tt.NetoVenta) != g.VentasNetas || tt.Costo == nil || jsmath.Redondear2(*tt.Costo) != g.Costo ||
			jsmath.Redondear2(tt.NetoVenta-tt.NetoCosteado) != g.VentasSinCosto {
			t.Errorf("%s: totales %+v, ganancia %+v", corte, tt, g)
		}
		if corte == "producto" && (len(rep.Filas) != 50 || tt.Filas != 61) {
			t.Errorf("producto: %d filas, %d en total", len(rep.Filas), tt.Filas)
		}
		// Los cortes sin tope suman exacto sus filas.
		if corte != "producto" && corte != "rubro" && corte != "cliente" {
			suma := 0.0
			for _, f := range rep.Filas {
				suma += f.NetoVenta
			}
			if jsmath.Redondear2(suma) != g.VentasNetas {
				t.Errorf("%s: las filas suman %v, el total %v", corte, suma, g.VentasNetas)
			}
		}
	}
	_, csv, _ := pedir(t, adm, e.u+"reportes/ventas/archivo?corte=producto&periodo=mes")
	lineas := strings.Split(strings.TrimSpace(csv), "\r\n")
	total := strings.Split(lineas[len(lineas)-1], ";")
	if len(lineas) != 52 || total[4] != csvexcel.NumeroCsv(g.VentasNetas, 2) || total[6] != csvexcel.NumeroCsv(g.Costo, 2) {
		t.Errorf("total del csv: %d líneas, %v", len(lineas), total)
	}
}

// El Cierre parte el «Vendido sin IVA» según la factura, con la misma base
// (los renglones), y las tres partes suman exacto: facturado (de cualquier
// mes), el ticket interno del mostrador y lo que tendría que estar
// facturado. La factura en borrador no factura, la cancelada no cuenta y
// nada de esto va a los asientos.
func TestCierreVendidoPorFactura(t *testing.T) {
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
	// Interno: del mostrador y sin comprobante. Con 121 de envío, que no es
	// venta de renglones: 1000.
	interno := e.pedido(t, "F-2", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 1210.0, 600.0})
	e.exec(t, `update orders set total = 1331, costo_envio = 121 where id = $1`, interno)
	// Sin factura: el comprobante quedó en borrador (500). El pedido web
	// pendiente (100) todavía no se vendió: ni se entregó ni se facturó
	// (H162).
	borrador := e.pedido(t, "F-3", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 605.0, 300.0})
	factura(borrador, "borrador", 2, nil, "2026-10-05T15:00:00Z")
	e.pedido(t, "F-6", e.central, "pendiente", "tienda", octubre, nil, [4]any{placa, 1.0, 121.0, 60.0})
	e.pedido(t, "F-4", e.central, "cancelado", "mostrador", octubre, nil, [4]any{placa, 1.0, 999.0, 1.0})
	// De octubre, facturado el 2 de noviembre: facturado.
	tarde := e.pedido(t, "F-5", e.central, "entregado", "mostrador", time.Date(2026, 10, 31, 20, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 1210.0, 600.0})
	factura(tarde, "autorizada", 3, "762", "2026-11-02T15:00:00Z")
	// Facturado y esperando el CAE (sin certificado): sin CAE, no sin
	// factura (H422).
	esperando := e.pedido(t, "F-7", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 484.0, 200.0})
	factura(esperando, "emitida", 4, nil, "2026-10-05T15:00:00Z")
	// Y la percepción de IIBB que nos hizo un proveedor (H165).
	prov := e.id(t, `insert into suppliers (nombre) values ('Placas del Sur') returning id`)
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, percepciones, percepcion_iibb, total)
		values ($1, 'factura_a', 3, 88412, '2026-10-26T00:00:00Z', 1000, 210, 30, 30, 1240)`, prov)

	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	var r ResumenDelMes
	if err := json.Unmarshal([]byte(cuerpo), &r); err != nil {
		t.Fatal(cuerpo)
	}
	v := r.Vendido
	quiere := VendidoDelMes{Total: 3900, Facturado: Totales{2000, 2}, SinCae: Totales{400, 1}, Interno: Totales{1000, 1}, SinFactura: Totales{500, 1}}
	if v != quiere {
		t.Errorf("vendido: %+v, quería %+v", v, quiere)
	}
	if r.PercepcionesIibb != (Totales{30, 1}) {
		t.Errorf("percepciones de IIBB: %+v", r.PercepcionesIibb)
	}
	if v.Total != r.Resultado.Actual.VentasNetas || jsmath.Redondear2(v.Facturado.Total+v.SinCae.Total+v.Interno.Total+v.SinFactura.Total) != v.Total {
		t.Errorf("no cierra con el resultado: %+v %+v", v, r.Resultado.Actual)
	}
	if r.Ventas.Cantidad != 1 || r.Ventas.Neto != 1000 {
		t.Errorf("facturado neto: %+v", r.Ventas)
	}
	// Con la regla del descuento, las partes siguen sumando el resultado.
	e.exec(t, `update site_settings set valor = 'si' where clave = 'ganancia_descuento'`)
	e.exec(t, `update orders set subtotal = 1210, total = 1089 where id = $1`, facturado)
	_, cuerpo, _ = pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	_ = json.Unmarshal([]byte(cuerpo), &r)
	if v := r.Vendido; v.Total != r.Resultado.Actual.VentasNetas || v.Total != 3800 || !r.Resultado.Actual.ConDescuento ||
		jsmath.Redondear2(v.Facturado.Total+v.SinCae.Total+v.Interno.Total+v.SinFactura.Total) != v.Total {
		t.Errorf("con descuento: %+v %+v", v, r.Resultado.Actual)
	}
	_, asientos, _ := pedir(t, adm, e.u+"cierre/asientos?periodo=2026-10")
	if strings.Contains(strings.ToLower(asientos), "sin factura") || strings.Contains(strings.ToLower(asientos), "interno") {
		t.Errorf("lo vendido sin factura no va a los asientos: %s", asientos)
	}
}

// «Factura viva» se decide por los importes: la nota de crédito que ARCA
// rechazó no acredita aunque la original haya quedado «anulada», y dos notas
// parciales con CAE que suman el total sí, aunque la original siga
// «autorizada». El Resumen y el Cierre cuentan lo mismo, de cualquier fecha,
// y Facturación las lista.
func TestCierreAnuladaConFacturaViva(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	viva := e.pedido(t, "A-1", e.central, "cancelado", "mostrador", time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina), nil)
	original := e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
		values ('factura_b', 3, 1, 'X', 100, 21, 0, 0, 0, 121, 'autorizada', '2026-10-05T15:00:00Z', '761', $1) returning id`, viva)
	nota := func(numero int, total float64, estado string, cae any) string {
		return e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id, comprobante_origen_id)
			values ('nota_credito_b', 3, $1, 'X', 0, 0, 0, 0, 0, $2, $3, '2026-10-06T15:00:00Z', $4, $5, $6) returning id`, numero, total, estado, cae, viva, original)
	}
	cuenta := func() (string, int, string) {
		_, pend, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
		_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
		var n NumerosDelDueno
		_ = json.Unmarshal([]byte(cuerpo), &n)
		pag, err := facturacion.Nuevo(e.pool, silencio).ListarPagina(context.Background(),
			facturacion.Filtros{Estado: facturacion.EstadoAnuladaViva}, 10, 0)
		if err != nil {
			t.Fatal(err)
		}
		lista, _ := json.Marshal(pag.Filas)
		return pend, n.Anuladas.ConFacturaViva, string(lista)
	}
	if pend, resumen, lista := cuenta(); !strings.Contains(pend, `"clave":"facturas-vivas"`) || resumen != 1 ||
		!strings.Contains(lista, original) || strings.Contains(lista, "nota_credito_b") {
		t.Errorf("viva: %s · resumen %d · %s", pend, resumen, lista)
	}
	// AnularConNota: la original pasa a «anulada» y la nota queda sin CAE;
	// ARCA la rechaza. El débito sigue: sigue viva.
	e.exec(t, `update invoices set estado = 'anulada' where id = $1`, original)
	nota(2, 121, "rechazada", nil)
	if pend, resumen, _ := cuenta(); !strings.Contains(pend, "facturas-vivas") || resumen != 1 {
		t.Errorf("con la nota rechazada sigue viva: %s · %d", pend, resumen)
	}
	// Dos parciales con CAE que suman el total, y la original «autorizada».
	e.exec(t, `update invoices set estado = 'autorizada' where id = $1`, original)
	nota(3, 100, "autorizada", "763")
	if pend, _, _ := cuenta(); !strings.Contains(pend, "facturas-vivas") {
		t.Errorf("con una parcial sigue viva: %s", pend)
	}
	nota(4, 21, "autorizada", "764")
	if pend, resumen, lista := cuenta(); strings.Contains(pend, "facturas-vivas") || resumen != 0 || strings.Contains(lista, original) {
		t.Errorf("acreditada entera ya no es viva: %s · %d · %s", pend, resumen, lista)
	}
}

// La venta del mostrador con conexión no guarda cobrada_at (solo la de la
// cola sin conexión): lo que cobró por transferencia o tarjeta tiene que
// estar en «Plata hoy» igual (comité final, A1). La de ayer no.
func TestPlataHoyConLaVentaDeTodosLosDias(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	hoy := e.pedido(t, "M-1", e.central, "entregado", "mostrador", time.Date(2026, 10, 15, 10, 0, 0, 0, Argentina), nil)
	e.exec(t, `insert into order_payments (order_id, medio, importe) values ($1, 'transferencia', 1111.05), ($1, 'debito', 40), ($1, 'mercado_pago', 9)`, hoy)
	ayer := e.pedido(t, "M-2", e.central, "entregado", "mostrador", time.Date(2026, 10, 14, 10, 0, 0, 0, Argentina), nil)
	e.exec(t, `insert into order_payments (order_id, medio, importe) values ($1, 'transferencia', 500)`, ayer)
	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	if err := json.Unmarshal([]byte(cuerpo), &n); err != nil {
		t.Fatal(cuerpo)
	}
	if p := n.PlataHoy; p.Banco != 1111.05 || p.Tarjetas != 40 || p.MercadoPago != 9 {
		t.Errorf("plata hoy: %+v", p)
	}
}

// La devolución parcial por caja de una venta que después se anula: su
// efectivo ya está en «Devoluciones del mes»; en «Devuelto» de las anuladas
// va solo lo que devolvió la anulación.
func TestAnuladaConDevolucionParcialNoSumaDosVeces(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	usuario := e.id(t, `select id from "user" limit 1`)
	turno := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, '2026-10-15T11:00:00Z') returning id`, e.central, usuario)
	cuando := time.Date(2026, 10, 15, 11, 0, 0, 0, Argentina)
	venta := e.pedido(t, "M-1", e.central, "cancelado", "mostrador", cuando.Add(-2*time.Hour), nil)
	e.exec(t, `update orders set total = 500 where id = $1`, venta)
	e.exec(t, `insert into order_status_history (order_id, estado, nota, created_by_user_id, created_at) values ($1, 'cancelado', 'Anulada', $2, $3)`, venta, usuario, cuando)
	parcial := e.id(t, `insert into cash_movements (session_id, tipo, monto, order_id, created_at) values ($1, 'devolucion', -100, $2, $3) returning id`, turno, venta, cuando.Add(-time.Hour))
	factura := e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, order_id)
		values ('factura_b', 3, 1, 'X', 413.22, 86.78, 0, 0, 0, 500, 'autorizada', '2026-10-15T12:00:00Z', $1) returning id`, venta)
	e.exec(t, `insert into devoluciones (clave, order_id, invoice_id, importe, destino, motivo, cash_movement_id, created_by_user_id) values ('d1', $1, $4, 100, 'caja', 'rota', $2, $3)`, venta, parcial, usuario, factura)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto, order_id, created_at) values ($1, 'devolucion', -400, $2, $3)`, turno, venta, cuando)
	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	if err := json.Unmarshal([]byte(cuerpo), &n); err != nil {
		t.Fatal(cuerpo)
	}
	if n.Anuladas.Devuelto != 400 {
		t.Errorf("devuelto por las anuladas: %v, quería 400", n.Anuladas.Devuelto)
	}
}

// Con más de la mitad de lo vendido sin costo, la ganancia no es una cifra
// (comité final, M5): el Panel y el Cierre muestran «Sin costos cargados».
// Justo en la mitad todavía se muestra.
func TestSinCostosCargados(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, tirante := e.catalogo(t)
	e.pedido(t, "V-1", e.central, "entregado", "mostrador", time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina), nil,
		[4]any{placa, 1.0, 1210.0, 600.0}, [4]any{tirante, 1.0, 1210.0, nil})
	leer := func() (Resultado, Resultado) {
		_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
		var n NumerosDelDueno
		_ = json.Unmarshal([]byte(cuerpo), &n)
		_, cuerpo, _ = pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
		var r ResumenDelMes
		_ = json.Unmarshal([]byte(cuerpo), &r)
		return n.Ganancia.Actual, r.Resultado.Actual
	}
	if g, c := leer(); g.SinCostosCargados || c.SinCostosCargados {
		t.Errorf("la mitad sin costo todavía es una cifra: %+v %+v", g, c)
	}
	e.pedido(t, "V-2", e.central, "entregado", "mostrador", time.Date(2026, 10, 6, 12, 0, 0, 0, Argentina), nil,
		[4]any{tirante, 1.0, 121.0, 0.0})
	if g, c := leer(); !g.SinCostosCargados || !c.SinCostosCargados {
		t.Errorf("más de la mitad sin costo: %+v %+v", g, c)
	}
}

// Lo devuelto en una devolución parcial deja de ser vendido (comité final,
// M3): el Resumen, el Cierre y Reportes dan la misma venta sin IVA y el
// mismo costo, sin la placa que volvió.
func TestLaDevolucionParcialBajaLoVendido(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	usuario := e.id(t, `select id from "user" limit 1`)
	placa, _ := e.catalogo(t)
	venta := e.pedido(t, "V-1", e.central, "entregado", "mostrador", time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina), nil,
		[4]any{placa, 2.0, 2420.0, 600.0})
	renglon := e.id(t, `select id from order_items where order_id = $1`, venta)
	factura := e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
		values ('factura_b', 3, 1, 'X', 2000, 420, 0, 0, 0, 2420, 'autorizada', '2026-10-05T15:00:00Z', '7612', $1) returning id`, venta)
	item := e.id(t, `insert into invoice_items (invoice_id, descripcion, cantidad, precio_unitario, neto, iva, subtotal, order_item_id)
		values ($1, 'Fenólico', 2, 1210, 2000, 420, 2420, $2) returning id`, factura, renglon)
	dev := e.id(t, `insert into devoluciones (clave, order_id, invoice_id, importe, destino, motivo, created_by_user_id, created_at)
		values ('d1', $1, $2, 1210, 'afuera', 'sobró', $3, '2026-10-06T15:00:00Z') returning id`, venta, factura, usuario)
	e.exec(t, `insert into devolucion_items (devolucion_id, invoice_item_id, order_item_id, cantidad, al_stock, importe) values ($1, $2, $3, 1, true, 1210)`, dev, item, renglon)

	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	_ = json.Unmarshal([]byte(cuerpo), &n)
	_, cuerpo, _ = pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	var r ResumenDelMes
	_ = json.Unmarshal([]byte(cuerpo), &r)
	_, cuerpo, _ = pedir(t, adm, e.u+"reportes/ventas?corte=producto&periodo=mes")
	var rep ReporteDeVentas
	_ = json.Unmarshal([]byte(cuerpo), &rep)
	quiere := Resultado{VentasNetas: 1000, Costo: 600, Resultado: 400}
	if g := n.Ganancia.Actual; g != quiere {
		t.Errorf("ganancia del Resumen: %+v, quería %+v", g, quiere)
	}
	if r.Resultado.Actual != quiere || r.Vendido.Total != 1000 || r.Vendido.Facturado.Total != 1000 {
		t.Errorf("cierre: %+v, vendido %+v", r.Resultado.Actual, r.Vendido)
	}
	if rep.Totales.NetoVenta != 1000 || rep.Totales.Costo == nil || *rep.Totales.Costo != 600 || rep.Totales.Cantidad != 1 {
		t.Errorf("reportes: %+v", rep.Totales)
	}
}

// La devolución resta en su mes, no en el de la venta (revisión del carril
// E): la venta del 28/9 devuelta en parte el 5/10 no cambia septiembre, que
// ya se le mandó al contador, y octubre muestra lo devuelto en negativo,
// como la nota de crédito en su libro IVA. Los cortes por pedido restan el
// monto pero no cuentan otra operación.
func TestLaDevolucionRestaEnSuMes(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	usuario := e.id(t, `select id from "user" limit 1`)
	placa, _ := e.catalogo(t)
	venta := e.pedido(t, "V-1", e.central, "entregado", "mostrador", time.Date(2026, 9, 28, 12, 0, 0, 0, Argentina), nil,
		[4]any{placa, 2.0, 2420.0, 600.0})
	renglon := e.id(t, `select id from order_items where order_id = $1`, venta)
	factura := e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
		values ('factura_b', 3, 1, 'X', 2000, 420, 0, 0, 0, 2420, 'autorizada', '2026-09-28T15:00:00Z', '7612', $1) returning id`, venta)
	item := e.id(t, `insert into invoice_items (invoice_id, descripcion, cantidad, precio_unitario, neto, iva, subtotal, order_item_id)
		values ($1, 'Fenólico', 2, 1210, 2000, 420, 2420, $2) returning id`, factura, renglon)
	dev := e.id(t, `insert into devoluciones (clave, order_id, invoice_id, importe, destino, motivo, created_by_user_id, created_at)
		values ('d1', $1, $2, 1210, 'afuera', 'sobró', $3, '2026-10-05T15:00:00Z') returning id`, venta, factura, usuario)
	e.exec(t, `insert into devolucion_items (devolucion_id, invoice_item_id, order_item_id, cantidad, al_stock, importe) values ($1, $2, $3, 1, true, 1210)`, dev, item, renglon)

	var sep, oct ResumenDelMes
	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/resumen?periodo=2026-09")
	_ = json.Unmarshal([]byte(cuerpo), &sep)
	_, cuerpo, _ = pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	_ = json.Unmarshal([]byte(cuerpo), &oct)
	if q := (Resultado{VentasNetas: 2000, Costo: 1200, Resultado: 800}); sep.Resultado.Actual != q || sep.Vendido.Facturado.Total != 2000 || sep.Vendido.Facturado.Cantidad != 1 {
		t.Errorf("septiembre: %+v, vendido %+v", sep.Resultado.Actual, sep.Vendido)
	}
	if q := (Resultado{VentasNetas: -1000, Costo: -600, Resultado: -400}); oct.Resultado.Actual != q || oct.Vendido.Facturado.Total != -1000 || oct.Vendido.Facturado.Cantidad != 0 {
		t.Errorf("octubre: %+v, vendido %+v", oct.Resultado.Actual, oct.Vendido)
	}
	var cli, prod ReporteDeVentas
	_, cuerpo, _ = pedir(t, adm, e.u+"reportes/ventas?corte=cliente&periodo=mes")
	_ = json.Unmarshal([]byte(cuerpo), &cli)
	_, cuerpo, _ = pedir(t, adm, e.u+"reportes/ventas?corte=producto&periodo=mes")
	_ = json.Unmarshal([]byte(cuerpo), &prod)
	if cli.Totales.Total != -1210 || cli.Totales.Cantidad != 0 || cli.Totales.NetoVenta != -1000 || len(cli.Filas) != 1 || cli.Filas[0].Total != -1210 {
		t.Errorf("por cliente: %+v %+v", cli.Totales, cli.Filas)
	}
	if prod.Totales.Total != -1210 || prod.Totales.Cantidad != -1 || prod.Totales.LineasSinCosto != 0 {
		t.Errorf("por producto: %+v", prod.Totales)
	}
	_, cuerpo, _ = pedir(t, adm, e.u+"reportes/ventas?corte=cliente&periodo=mes-pasado")
	_ = json.Unmarshal([]byte(cuerpo), &cli)
	if cli.Totales.Total != 2420 || cli.Totales.Cantidad != 1 || cli.Totales.NetoVenta != 2000 {
		t.Errorf("por cliente, septiembre: %+v", cli.Totales)
	}

	// «Devoluciones del mes» es la plata que salió: la que solo bajó la
	// deuda no suma.
	e.exec(t, `insert into devoluciones (clave, order_id, invoice_id, importe, destino, motivo, created_by_user_id, created_at)
		values ('d2', $1, $2, 100, 'deuda', 'sobró', $3, '2026-10-06T15:00:00Z')`, venta, factura, usuario)
	_, cuerpo, _ = pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	_ = json.Unmarshal([]byte(cuerpo), &n)
	if n.Devoluciones.Total != 1210 || n.Devoluciones.Cantidad != 1 {
		t.Errorf("devoluciones del mes: %+v", n.Devoluciones)
	}
}

// La mercadería que salió con un remito parcial y no se cobró está en «Me
// deben» (comité final, M4): lo remitido menos lo cobrado. Si lo cobrado
// cubre lo remitido, no; y el remito anulado no cuenta.
func TestMeDebenConRemitosParciales(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, tirante := e.catalogo(t)
	cuando := time.Date(2026, 10, 12, 10, 0, 0, 0, Argentina)
	conRemito := func(numero string, estadoRemito string) string {
		id := e.pedido(t, numero, e.central, "listo", "presupuesto", cuando, nil, [4]any{placa, 1.0, 600.0, nil}, [4]any{tirante, 1.0, 400.0, nil})
		e.exec(t, `update orders set estado_pago = 'pendiente', medio_pago = 'efectivo' where id = $1`, id)
		remito := e.id(t, `insert into deliveries (numero, order_id, estado) values ($1, $2, $3) returning id`, "R-"+numero, id, estadoRemito)
		e.exec(t, `insert into delivery_items (delivery_id, order_item_id, cantidad) select $1, id, 1 from order_items where order_id = $2 and variant_id = $3`, remito, id, placa)
		return id
	}
	conRemito("P-1", "entregada")
	cobrado := conRemito("P-2", "entregada")
	e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, acreditado_at) values ($1, 'pedido', 'transferencia', 'transferencia', 700, 'aprobado', now())`, cobrado)
	conRemito("P-3", "anulada")
	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	if err := json.Unmarshal([]byte(cuerpo), &n); err != nil {
		t.Fatal(cuerpo)
	}
	if q := (Monto{Total: 600, Cantidad: 1}); n.MeDeben.PedidosSinCobrar != q {
		t.Errorf("sin cobrar: %+v, quería %+v", n.MeDeben.PedidosSinCobrar, q)
	}
}

// **Una factura que vence hoy figuraba vencida** (mes simulado, H005/H061).
// El vencimiento se guarda como día, a la medianoche UTC; se comparaba
// contra la medianoche argentina (las 3 UTC) en Debo y contra `now()` en
// «Para hoy», así que una factura de contado salía vencida en el momento en
// que se cargaba. Vence hoy: cuenta para esta semana y para las 48 horas.
func TestLaFacturaQueVenceHoyNoEstaVencida(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	// 00:40 del 15/10 en Argentina, la hora en que la vio la dueña.
	temprano := time.Date(2026, 10, 15, 0, 40, 0, 0, Argentina)
	e.s.ahora = func() time.Time { return temprano }
	prov := e.id(t, `insert into suppliers (nombre) values ('Contado') returning id`)
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision, fecha_vencimiento)
		values ($1, 'factura_a', 4, 1877, 800, 0, 0, 0, 0, 800, '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z')`, prov)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto) values ($1, 'factura', 800)`, prov)
	for _, ahora := range []time.Time{temprano, time.Date(2026, 10, 15, 23, 30, 0, 0, Argentina)} {
		d, err := e.s.Debo(context.Background(), ahora)
		if err != nil {
			t.Fatal(err)
		}
		if d.Vencido != 0 || d.FacturasVencidas != 0 || d.EstaSemana != 800 || d.FacturasEstaSemana != 1 {
			t.Errorf("%v: %+v", ahora, d)
		}
	}
	// «Para hoy», con el reloj del servicio: la factura de contado de hoy.
	e.exec(t, `update purchase_invoices set fecha_vencimiento = $1`, DiaDeHoy(temprano))
	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/pendientes")
	if strings.Contains(cuerpo, "compras-vencidas") || !strings.Contains(cuerpo, `"clave":"compras-48h"`) {
		t.Errorf("para hoy: %s", cuerpo)
	}
	e.exec(t, `update purchase_invoices set fecha_vencimiento = '2026-10-15T00:00:00Z'`)
	// Al día siguiente, sí.
	d, err := e.s.Debo(context.Background(), time.Date(2026, 10, 16, 0, 10, 0, 0, Argentina))
	if err != nil {
		t.Fatal(err)
	}
	if d.Vencido != 800 || d.FacturasVencidas != 1 {
		t.Errorf("al otro día: %+v", d)
	}
}

// H137/H349: Cobros cuenta lo cobrado en el mostrador (sin la cuenta
// corriente) y no cuenta el cheque que rebotó.
func TestCobradoConElMostradorYSinElRechazado(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	cuando := time.Date(2026, 10, 10, 10, 0, 0, 0, Argentina)
	venta := e.pedido(t, "M-1", e.central, "entregado", "mostrador", cuando, nil)
	e.exec(t, `insert into order_payments (order_id, medio, importe, created_at) values ($1, 'efectivo', 1000, $2), ($1, 'debito', 500, $2), ($1, 'cuenta_corriente', 700, $2)`, venta, cuando)
	cheque := e.pedido(t, "M-2", e.central, "entregado", "mostrador", cuando, nil)
	pago := e.id(t, `insert into order_payments (order_id, medio, importe, created_at) values ($1, 'cheque', 400, $2) returning id`, cheque, cuando)
	e.exec(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, order_payment_id) values ('recibido', '55500321', 'Nación', $1, 400, 'rechazado', $2)`, cuando, pago)
	desde, hasta := time.Date(2026, 10, 1, 0, 0, 0, 0, Argentina), time.Date(2026, 11, 1, 0, 0, 0, 0, Argentina)
	c, err := e.s.Cobranzas(ctx, Periodo{Desde: &desde, Hasta: &hasta}, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	if c.Cobrado != 1500 || c.Ventas != 1 {
		t.Errorf("cobrado %v en %d ventas", c.Cobrado, c.Ventas)
	}
	medios := map[string]float64{}
	for _, m := range c.PorMedio {
		medios[m.Medio] = m.Total
	}
	if medios["efectivo"] != 1000 || medios["tarjeta_debito"] != 500 || medios["cheque"] != 0 || medios["cuenta_corriente"] != 0 {
		t.Errorf("por medio: %v", medios)
	}
}

// La venta cuenta al entregarse o al facturarse, lo que pase primero, no al
// confirmarse el pedido (mes simulado, H162): el pedido de octubre que se
// prepara y nadie cobró ni facturó no suma en octubre; facturado el 3 de
// noviembre, suma en noviembre.
func TestLaVentaCuentaAlEntregarseOFacturarse(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, _ := e.catalogo(t)
	octubre := time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina)
	e.pedido(t, "V-1", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 1210.0, 600.0})
	preparando := e.pedido(t, "V-2", e.central, "preparando", "tienda", octubre, nil, [4]any{placa, 1.0, 2420.0, 1200.0})
	vendido := func(periodo string) float64 {
		t.Helper()
		_, cuerpo, _ := pedir(t, adm, e.u+"cierre/resumen?periodo="+periodo)
		var r ResumenDelMes
		if err := json.Unmarshal([]byte(cuerpo), &r); err != nil {
			t.Fatal(cuerpo)
		}
		return r.Vendido.Total
	}
	if v := vendido("2026-10"); v != 1000 {
		t.Fatalf("octubre con el pedido sin entregar ni facturar: %v", v)
	}
	e.facturaConCae(t, nil, 95, 2420, "2026-11-03T15:00:00Z", &preparando)
	if o, n := vendido("2026-10"), vendido("2026-11"); o != 1000 || n != 2000 {
		t.Fatalf("facturado en noviembre: octubre %v, noviembre %v", o, n)
	}
}

// Mes 23: el desglose del cierre sumaba un centavo menos que el «Vendido
// sin IVA» de arriba. 1210,03 con costo y 121,03 sin costo: sin IVA,
// 1000,0248 y 100,0248. Arriba, 1100,05 − 100,02 = 1000,03; redondeando
// solo lo costeado daba 1000,02.
func TestElDesgloseDelCierreCierraAlCentavo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, tirante := e.catalogo(t)
	e.pedido(t, "V-1", e.central, "entregado", "mostrador", time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina), nil,
		[4]any{placa, 1.0, 1210.03, 600.0}, [4]any{tirante, 1.0, 121.03, nil})
	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	var r ResumenDelMes
	_ = json.Unmarshal([]byte(cuerpo), &r)
	arriba := jsmath.Redondear2(r.Resultado.Actual.VentasNetas - r.Resultado.Actual.VentasSinCosto)
	partes := jsmath.Redondear2(r.Vendido.Facturado.Total + r.Vendido.SinCae.Total + r.Vendido.Interno.Total + r.Vendido.SinFactura.Total)
	if arriba != 1000.03 || r.Vendido.Total != arriba || partes != arriba {
		t.Errorf("arriba %v, total %v, partes %v", arriba, r.Vendido.Total, partes)
	}
}
