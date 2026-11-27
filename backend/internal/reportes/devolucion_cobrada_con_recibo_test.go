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
	"mjbj/internal/ventas/fragmentos"
)

// La devolución parcial de un pedido que no pasó por el mostrador (comité
// final, A3). Los topes salían de order_payments, que el pedido de
// presupuesto no tiene: el total se tomaba como cobrado en efectivo, y salía
// plata de la caja por un pedido sin cobrar, o cobrado por el banco. Y sin
// cobro anotado, el CSV no tenía el reintegro.
//
//   - Sin cobrar: la caja no paga; se devuelve bajando la deuda, y «Me
//     deben» reclama lo que queda.
//   - Cobrado con recibo en efectivo: la caja paga hasta ese efectivo, y el
//     cierre asienta el reintegro con el reparto del recibo: Deudores
//     cierra en cero.
//   - Cobrado con recibo por transferencia: la caja no paga; vuelve por
//     afuera y el reintegro sale del banco.
func TestDevolucionDeUnPedidoCobradoConRecibo(t *testing.T) {
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
	e.exec(t, `update configuracion_fiscal set cuit = '30589445259', condicion_iva = 'responsable_inscripto', ingresos_brutos = '901-123456-7', inicio_actividades = '1981-03-01'`)
	e.exec(t, `insert into puntos_venta (numero, nombre, numero_inicial) values (3, 'Mostrador', 0)`)
	e.exec(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, now() - interval '1 hour')`, e.central, usuario)
	cob := cobros.Nuevo(e.pool, silencio)

	// Un pedido de presupuesto de dos placas de 605, sin cliente, facturado
	// con CAE.
	facturado := func(numero string) (pedido, factura, renglon string) {
		t.Helper()
		pedido = e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, medio_pago, total)
			values ($1, 'Juan', $2, 'presupuesto', 'entregado', 'efectivo', 1210) returning id`, numero, e.central)
		r, err := fac.EmitirParaLaVenta(ctx, facturacion.PedidoDeComprobante{OrderID: pedido, ReceptorNombre: "Juan", UsuarioID: usuario,
			Lineas: []facturacion.LineaDeVenta{{Descripcion: "Placa", Unidad: "placa", Cantidad: 2, PrecioUnitario: 605}}})
		if err != nil || r.InvoiceID == nil {
			t.Fatalf("factura: %v %+v", err, r)
		}
		factura = *r.InvoiceID
		e.exec(t, `update invoices set cae = '71234567890123', estado = 'autorizada' where id = $1`, factura)
		renglon = e.id(t, `select id::text from invoice_items where invoice_id = $1`, factura)
		return
	}
	n := 0
	devolver := func(factura, renglon, destino string) (facturacion.Devolucion, error) {
		n++
		d, err := fac.DevolucionParcial(ctx, usuario, facturacion.PedidoDeDevolucion{InvoiceID: factura, Clave: "dev-" + string(rune('a'+n)),
			Destino: destino, Motivo: "Le sobró una", BranchID: e.central,
			Renglones: []facturacion.RenglonADevolver{{ItemID: renglon, Cantidad: 1}}})
		if err == nil && d.NotaID != "" {
			// El proveedor interno no autoriza: la nota sale con CAE a mano,
			// como la factura.
			e.exec(t, `update invoices set cae = '71234567890124', estado = 'autorizada' where id = $1`, d.NotaID)
		}
		return d, err
	}
	topes := func(factura string) *facturacion.DatosDeDevolucion {
		t.Helper()
		d, err := fac.ParaDevolver(ctx, factura)
		if err != nil || d == nil {
			t.Fatalf("para devolver: %v", err)
		}
		return d
	}
	caja := func() float64 {
		var c float64
		if err := e.pool.QueryRow(ctx, `select coalesce(sum(monto), 0)::float8 from cash_movements`).Scan(&c); err != nil {
			t.Fatal(err)
		}
		return c
	}

	// 1. Sin cobrar.
	pedido, factura, renglon := facturado("PED-1")
	if d := topes(factura); d.Caja != 0 || d.Afuera != 0 || d.Deuda != 1210 {
		t.Errorf("topes sin cobrar: caja %v afuera %v deuda %v", d.Caja, d.Afuera, d.Deuda)
	}
	if _, err := devolver(factura, renglon, facturacion.DevolverPorCaja); err == nil || !strings.Contains(facturacion.Mensaje(err), "no se cobró en efectivo") {
		t.Errorf("la caja paga un pedido sin cobrar: %v", err)
	}
	if _, err := devolver(factura, renglon, facturacion.DevolverLaDeuda); err != nil {
		t.Fatal(err)
	}
	var falta float64
	if err := e.pool.QueryRow(ctx, `select `+fragmentos.SinCobrarDelPedido+`::float8 from orders o where o.id = $1`, pedido).Scan(&falta); err != nil || falta != 605 {
		t.Errorf("lo que falta cobrar después de devolver una: %v (%v)", falta, err)
	}
	if c := caja(); c != 0 {
		t.Errorf("salió plata de la caja: %v", c)
	}

	// 2. Cobrado con recibo en efectivo.
	pedido, factura, renglon = facturado("PED-2")
	if _, err := cob.CobrarPedido(ctx, ses, pedido, `[{"medio":"efectivo","importe":"1210"}]`, "cobro-2", ""); err != nil {
		t.Fatal(err)
	}
	if d := topes(factura); d.Caja != 1210 || d.Deuda != 0 {
		t.Errorf("topes del cobrado en efectivo: caja %v deuda %v", d.Caja, d.Deuda)
	}
	if _, err := devolver(factura, renglon, facturacion.DevolverLaDeuda); err == nil {
		t.Errorf("no debe nada: no se baja la deuda")
	}
	if _, err := devolver(factura, renglon, facturacion.DevolverPorCaja); err != nil {
		t.Fatal(err)
	}
	if c := caja(); c != 605 {
		t.Errorf("la caja: 1210 del recibo − 605 de la devolución = %v", c)
	}
	recibo := e.id(t, `select id from receipts where order_id = $1`, pedido)
	if _, _, err := func() (string, *string, error) {
		tx, err := e.pool.Begin(ctx)
		if err != nil {
			return "", nil, err
		}
		defer tx.Rollback(ctx)
		return cobros.AnularRecibo(ctx, tx, recibo, "error", &usuario)
	}(); err == nil {
		t.Errorf("se anula un recibo del que ya se devolvió plata")
	}

	// 3. Cobrado con recibo por transferencia.
	pedido, factura, renglon = facturado("PED-3")
	if _, err := cob.CobrarPedido(ctx, ses, pedido, `[{"medio":"transferencia","importe":"1210"}]`, "cobro-3", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := devolver(factura, renglon, facturacion.DevolverPorCaja); err == nil {
		t.Errorf("la caja paga lo cobrado por el banco")
	}
	if _, err := devolver(factura, renglon, facturacion.DevolverPorAfuera); err != nil {
		t.Fatal(err)
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
	blanco := DelCircuito(asientos, "blanco")
	// Deudores: las tres facturas (3630) − las tres notas (1815) − los dos
	// recibos (2420) + los dos reintegros (1210) = 605, lo que debe PED-1.
	if d := cuenta(blanco, Cuentas.Deudores); d != 605 {
		t.Errorf("Deudores: %v", d)
	}
	if c := cuenta(blanco, Cuentas.Caja); c != 605 {
		t.Errorf("Caja: %v", c)
	}
	if b := cuenta(blanco, Cuentas.Banco); b != 605 {
		t.Errorf("Banco: %v", b)
	}
	if len(DelCircuito(asientos, CircuitoNegro)) != 0 {
		t.Errorf("nada va al B")
	}
}
