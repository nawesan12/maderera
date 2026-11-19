package reportes

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"mjbj/internal/compras"
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
