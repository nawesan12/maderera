package reportes

import (
	"context"
	"strings"
	"testing"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/cobros"
	"mjbj/internal/facturacion"
	"mjbj/internal/sqlc"
)

// Lo que la revisión del carril E encontró en la devolución de un pedido
// cobrado con recibo:
//
//   - La factura cobrada desde Facturación: el recibo no lleva el pedido, y
//     la devolución lo daba por no cobrado (ofrecía bajar la deuda por el
//     total). Ahora la caja paga y el reintegro queda asentado.
//   - El recibo que pagó una parte facturada y otra del B: lo devuelto de la
//     factura vuelve entero a Deudores del blanco, contra la nota de
//     crédito, y no en la proporción del recibo.
//   - «Por afuera» con un cobro en línea y una transferencia con recibo: lo
//     primero que vuelve es lo de Mercado Pago, y su aviso no lo cuenta dos
//     veces.
//   - Lo que está en revisión no es deuda, y la devolución que salda la
//     deuda deja el pedido pagado.
func TestDevolucionRevisionDelCarrilE(t *testing.T) {
	e := armar(t)
	e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	usuario := e.id(t, `select id from "user" limit 1`)
	admin := sqlc.StaffRoleAdmin
	ses := &auth.Sesion{UserID: usuario, Rol: sqlc.UserRoleStaff, RolStaff: &admin}
	fac := facturacion.Nuevo(e.pool, silencio).ConEntorno(func(string) string { return "" })
	if _, err := fac.ObtenerEmisor(ctx); err != nil {
		t.Fatal(err)
	}
	e.exec(t, `update configuracion_fiscal set cuit = '30589445259', condicion_iva = 'responsable_inscripto'`)
	e.exec(t, `insert into puntos_venta (numero, nombre, numero_inicial) values (3, 'Mostrador', 0)`)
	e.exec(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, now() - interval '1 hour')`, e.central, usuario)
	cob := cobros.Nuevo(e.pool, silencio)

	// Un pedido de presupuesto sin cliente de `total`, con una factura con
	// CAE por `placas` placas de 605.
	facturado := func(numero string, total float64, placas float64) (pedido, factura, renglon string) {
		t.Helper()
		pedido = e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, medio_pago, total)
			values ($1, 'Juan', $2, 'presupuesto', 'entregado', 'efectivo', $3) returning id`, numero, e.central, total)
		r, err := fac.EmitirParaLaVenta(ctx, facturacion.PedidoDeComprobante{OrderID: pedido, ReceptorNombre: "Juan", UsuarioID: usuario,
			Lineas: []facturacion.LineaDeVenta{{Descripcion: "Placa", Unidad: "placa", Cantidad: placas, PrecioUnitario: 605}}})
		if err != nil || r.InvoiceID == nil {
			t.Fatalf("factura: %v %+v", err, r)
		}
		factura = *r.InvoiceID
		e.exec(t, `update invoices set cae = '71234567890123', estado = 'autorizada' where id = $1`, factura)
		renglon = e.id(t, `select id::text from invoice_items where invoice_id = $1`, factura)
		return
	}
	n := 0
	devolver := func(factura, renglon, destino string) error {
		n++
		d, err := fac.DevolucionParcial(ctx, usuario, facturacion.PedidoDeDevolucion{InvoiceID: factura, Clave: "rev-" + string(rune('a'+n)),
			Destino: destino, Motivo: "Le sobró una", BranchID: e.central,
			Renglones: []facturacion.RenglonADevolver{{ItemID: renglon, Cantidad: 1}}})
		if err == nil && d.NotaID != "" {
			e.exec(t, `update invoices set cae = '71234567890124', estado = 'autorizada' where id = $1`, d.NotaID)
		}
		return err
	}
	topes := func(factura string) *facturacion.DatosDeDevolucion {
		t.Helper()
		d, err := fac.ParaDevolver(ctx, factura)
		if err != nil || d == nil {
			t.Fatalf("para devolver: %v", err)
		}
		return d
	}
	reintegrado := func(pedido string) float64 {
		t.Helper()
		var x float64
		if err := e.pool.QueryRow(ctx, `select coalesce(sum(t.importe), 0)::float8 from receipt_refunds t
			join devoluciones d on d.id = t.devolucion_id where d.order_id = $1`, pedido).Scan(&x); err != nil {
			t.Fatal(err)
		}
		return x
	}

	// 1. Cobrada desde Facturación, en efectivo.
	pedido, factura, renglon := facturado("PED-1", 1210, 2)
	if _, err := fac.Cobrar(ctx, ses, factura, "recibo", "", `[{"medio":"efectivo","importe":"1210"}]`); err != nil {
		t.Fatal(err)
	}
	if d := topes(factura); d.Caja != 1210 || d.Deuda != 0 {
		t.Errorf("topes de la factura cobrada desde Facturación: caja %v deuda %v", d.Caja, d.Deuda)
	}
	if err := devolver(factura, renglon, facturacion.DevolverPorCaja); err != nil {
		t.Fatal(err)
	}
	if r := reintegrado(pedido); r != 605 {
		t.Errorf("reintegro del recibo de Facturación: %v", r)
	}

	// 2. Un recibo de 2420 que paga la factura de 1210 y 1210 sin factura
	// (va al B). Se devuelve una placa facturada por caja.
	_, factura, renglon = facturado("PED-2", 2420, 2)
	pedido2 := e.id(t, `select order_id::text from invoices where id = $1`, factura)
	if _, err := cob.CobrarPedido(ctx, ses, pedido2, `[{"medio":"efectivo","importe":"2420"}]`, "cobro-2", ""); err != nil {
		t.Fatal(err)
	}
	if err := devolver(factura, renglon, facturacion.DevolverPorCaja); err != nil {
		t.Fatal(err)
	}

	// 3. 605 por Mercado Pago en línea y 605 por transferencia con recibo.
	pedido3, factura3, renglon3 := facturado("PED-3", 1210, 2)
	e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, acreditado_at)
		values ($1, 'pedido', 'mercado_pago', 'visa', 605, 'aprobado', now())`, pedido3)
	if _, err := cob.CobrarPedido(ctx, ses, pedido3, `[{"medio":"transferencia","importe":"605"}]`, "cobro-3", ""); err != nil {
		t.Fatal(err)
	}
	if d := topes(factura3); d.Afuera != 1210 {
		t.Errorf("por afuera: %v", d.Afuera)
	}
	if err := devolver(factura3, renglon3, facturacion.DevolverPorAfuera); err != nil {
		t.Fatal(err)
	}
	if r := reintegrado(pedido3); r != 0 {
		t.Errorf("lo primero que vuelve es lo de Mercado Pago, no el recibo: %v", r)
	}
	// Mercado Pago avisa el reintegro de esa devolución: no baja el tope otra vez.
	e.exec(t, `insert into payment_refunds (payment_id, importe, acumulado) select id, 605, 605 from payments where order_id = $1`, pedido3)
	if d := topes(factura3); d.Afuera != 605 {
		t.Errorf("por afuera después del aviso de Mercado Pago: %v", d.Afuera)
	}
	if err := devolver(factura3, renglon3, facturacion.DevolverPorAfuera); err != nil {
		t.Fatal(err)
	}
	if r := reintegrado(pedido3); r != 605 {
		t.Errorf("la segunda vuelve desde el recibo: %v", r)
	}

	// 4. Una transferencia en revisión no es deuda; y la devolución que
	// salda lo que falta deja el pedido pagado.
	pedido4, factura4, renglon4 := facturado("PED-4", 1210, 2)
	e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado) values ($1, 'pedido', 'transferencia', 'transferencia', 605, 'en_revision')`, pedido4)
	if d := topes(factura4); d.Deuda != 605 {
		t.Errorf("la deuda descuenta lo que está en revisión: %v", d.Deuda)
	}
	e.exec(t, `update payments set estado = 'aprobado', acreditado_at = now() where order_id = $1`, pedido4)
	if err := devolver(factura4, renglon4, facturacion.DevolverLaDeuda); err != nil {
		t.Fatal(err)
	}
	if estado := e.id(t, `select estado_pago::text from orders where id = $1`, pedido4); estado != "pagado" {
		t.Errorf("la devolución que salda la deuda deja el pedido %s", estado)
	}

	asientos, err := e.s.AsientosDelPeriodo(ctx, time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2030, 12, 31, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range asientos {
		if !a.Balancea {
			t.Errorf("no cierra: %+v", a)
		}
	}
	// Deudores del blanco cierra en cero en PED-1 a PED-3; PED-4 debe 0:
	// 605 entraron en línea y 605 se devolvieron bajando la deuda.
	blanco := DelCircuito(asientos, "blanco")
	if d := cuenta(blanco, Cuentas.Deudores); d != 0 {
		var renglones []string
		for _, a := range blanco {
			renglones = append(renglones, a.Concepto)
		}
		t.Errorf("Deudores del blanco: %v\n%s", d, strings.Join(renglones, "\n"))
	}
}
