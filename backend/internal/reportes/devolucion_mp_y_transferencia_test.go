package reportes

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"mjbj/internal/facturacion"
)

// Un pedido sin recibo cobrado con Mercado Pago ($600) y una transferencia
// ($400): lo devuelto «por afuera» va primero a Mercado Pago, que lo anota
// con su aviso y sin tramo; solo lo que pasa de ahí lleva tramo en la
// transferencia. Antes iba primero a la transferencia y el aviso de Mercado
// Pago sumaba otro reintegro: el CSV lo contaba dos veces.
func TestLaDevolucionPorAfueraVaPrimeroAMercadoPago(t *testing.T) {
	e := armar(t)
	e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	usuario := e.id(t, `select id from "user" limit 1`)
	fac := facturacion.Nuevo(e.pool, silencio).ConEntorno(func(string) string { return "" })
	if _, err := fac.ObtenerEmisor(ctx); err != nil {
		t.Fatal(err)
	}
	e.exec(t, `update configuracion_fiscal set cuit = '30589445259', condicion_iva = 'responsable_inscripto'`)
	e.exec(t, `insert into puntos_venta (numero, nombre, numero_inicial) values (3, 'Mostrador', 0)`)

	cae := 71234567890100
	conCae := func(id string) {
		t.Helper()
		cae++
		e.exec(t, `update invoices set cae = $2, estado = 'autorizada' where id = $1`, id, strconv.Itoa(cae))
	}
	type venta struct{ pedido, factura, renglon, mp string }
	vender := func(numero string) venta {
		t.Helper()
		var v venta
		v.pedido = e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, medio_pago, total)
			values ($1, 'Juan', $2, 'tienda', 'entregado', 'mercado_pago', 1000) returning id`, numero, e.central)
		r, err := fac.EmitirParaLaVenta(ctx, facturacion.PedidoDeComprobante{OrderID: v.pedido, ReceptorNombre: "Juan", UsuarioID: usuario,
			Lineas: []facturacion.LineaDeVenta{{Descripcion: "Listón", Unidad: "unidad", Cantidad: 10, PrecioUnitario: 100}}})
		if err != nil || r.InvoiceID == nil {
			t.Fatalf("factura: %v %+v", err, r)
		}
		v.factura = *r.InvoiceID
		conCae(v.factura)
		v.renglon = e.id(t, `select id::text from invoice_items where invoice_id = $1`, v.factura)
		v.mp = e.id(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, acreditado_at, proveedor_payment_id)
			values ($1, 'pedido', 'mercado_pago', 'visa', 600, 'aprobado', now(), $2) returning id`, v.pedido, "mp-"+numero)
		e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, acreditado_at)
			values ($1, 'pedido', 'transferencia', 'transferencia', 400, 'aprobado', now())`, v.pedido)
		return v
	}
	devolver := func(numero string, v venta, cantidad float64) string {
		t.Helper()
		d, err := fac.DevolucionParcial(ctx, usuario, facturacion.PedidoDeDevolucion{InvoiceID: v.factura, Clave: "dev-" + numero,
			Destino: facturacion.DevolverPorAfuera, Motivo: "Le sobraron", BranchID: e.central,
			Renglones: []facturacion.RenglonADevolver{{ItemID: v.renglon, Cantidad: cantidad}}})
		if err != nil {
			t.Fatal(err)
		}
		conCae(d.NotaID)
		return d.ID
	}
	// El aviso de Mercado Pago, como lo anota pagos.reintegrarTramo (pagos
	// importa reportes: acá se escribe la misma fila, con el mismo freno del
	// aviso repetido).
	avisar := func(v venta, acumulado float64) {
		t.Helper()
		e.exec(t, `insert into payment_refunds (payment_id, importe, acumulado, referencia)
			values ($1, $2::numeric - coalesce((select sum(importe) from payment_refunds where payment_id = $1), 0), $2::numeric, 'mp')
			on conflict (payment_id, acumulado) do nothing`, v.mp, acumulado)
	}
	tramos := func(devolucion string) (enTransferencia float64) {
		t.Helper()
		if err := e.pool.QueryRow(ctx, `select coalesce(sum(t.importe), 0)::float8 from payment_refunds t join payments p on p.id = t.payment_id
			where t.devolucion_id = $1 and p.proveedor = 'transferencia'`, devolucion).Scan(&enTransferencia); err != nil {
			t.Fatal(err)
		}
		return
	}

	chica := vender("MPT-1")
	if x := tramos(devolver("MPT-1", chica, 3)); x != 0 {
		t.Errorf("devolver $300: tramo en la transferencia %v, quería 0", x)
	}
	avisar(chica, 300)

	grande := vender("MPT-2")
	if x := tramos(devolver("MPT-2", grande, 8)); x != 200 {
		t.Errorf("devolver $800: tramo en la transferencia %v, quería 200", x)
	}
	avisar(grande, 600)
	// El aviso repetido no suma.
	avisar(grande, 600)

	asientos, err := e.s.AsientosDelPeriodo(ctx, time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), time.Now().AddDate(0, 1, 0))
	if err != nil {
		t.Fatal(err)
	}
	asientos = DelCircuito(asientos, "blanco")
	reintegros := func(pedido string) (cuantos int, total float64) {
		for _, a := range asientos {
			if strings.HasPrefix(a.Concepto, "Reintegro") && strings.Contains(a.Concepto, pedido) {
				cuantos++
				total += a.Renglones[0].Debe
				if a.Renglones[0].Cuenta != Cuentas.Deudores || a.Renglones[1].Cuenta != Cuentas.Banco {
					t.Errorf("%s: el reintegro va de %s a %s", pedido, a.Renglones[0].Cuenta, a.Renglones[1].Cuenta)
				}
			}
		}
		return
	}
	if n, x := reintegros("MPT-1"); n != 1 || x != 300 {
		t.Errorf("MPT-1: %d reintegros por %v, quería uno de 300", n, x)
	}
	if n, x := reintegros("MPT-2"); n != 2 || x != 800 {
		t.Errorf("MPT-2: %d reintegros por %v, quería 600 del aviso y 200 de la transferencia", n, x)
	}
	// Las dos ventas cierran: lo cobrado, menos la nota de crédito, menos lo
	// reintegrado.
	if s := redondear(SaldoDeCuenta(asientos, Cuentas.Deudores)); s != 0 {
		t.Errorf("Deudores: %v, quería 0", s)
	}
	// Banco: entró 2000, volvió 1100.
	if s := redondear(SaldoDeCuenta(asientos, Cuentas.Banco)); s != 900 {
		t.Errorf("Banco: %v, quería 900", s)
	}
}
