package reportes

import (
	"context"
	"strings"
	"testing"
	"time"

	"mjbj/internal/facturacion"
)

// La devolución «por afuera» de un pedido cobrado en línea sin Mercado Pago
// (una transferencia aprobada, sin recibo): ese cobro nunca recibe aviso, así
// que la devolución le anota el tramo y el CSV tiene el reintegro. Lo de
// Mercado Pago sigue esperando su aviso: anotarlo acá lo devolvía dos veces.
func TestLaDevolucionPorAfueraDeUnaTransferenciaAsientaElReintegro(t *testing.T) {
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

	facturado := func(numero, proveedor string) (pedido, factura, renglon string) {
		t.Helper()
		pedido = e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, medio_pago, total)
			values ($1, 'Juan', $2, 'tienda', 'entregado', 'transferencia', 1210) returning id`, numero, e.central)
		r, err := fac.EmitirParaLaVenta(ctx, facturacion.PedidoDeComprobante{OrderID: pedido, ReceptorNombre: "Juan", UsuarioID: usuario,
			Lineas: []facturacion.LineaDeVenta{{Descripcion: "Placa", Unidad: "placa", Cantidad: 2, PrecioUnitario: 605}}})
		if err != nil || r.InvoiceID == nil {
			t.Fatalf("factura: %v %+v", err, r)
		}
		factura = *r.InvoiceID
		e.exec(t, `update invoices set cae = '71234567890123', estado = 'autorizada' where id = $1`, factura)
		renglon = e.id(t, `select id::text from invoice_items where invoice_id = $1`, factura)
		e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, acreditado_at)
			values ($1, 'pedido', $2, 'transferencia', 1210, 'aprobado', now())`, pedido, proveedor)
		return
	}
	devolver := func(numero, factura, renglon string) string {
		t.Helper()
		d, err := fac.DevolucionParcial(ctx, usuario, facturacion.PedidoDeDevolucion{InvoiceID: factura, Clave: "linea-" + numero,
			Destino: facturacion.DevolverPorAfuera, Motivo: "Le sobró una", BranchID: e.central,
			Renglones: []facturacion.RenglonADevolver{{ItemID: renglon, Cantidad: 1}}})
		if err != nil {
			t.Fatal(err)
		}
		e.exec(t, `update invoices set cae = '71234567890124', estado = 'autorizada' where id = $1`, d.NotaID)
		return d.ID
	}
	tramo := func(devolucion string) float64 {
		t.Helper()
		var x float64
		if err := e.pool.QueryRow(ctx, `select coalesce(sum(importe), 0)::float8 from payment_refunds where devolucion_id = $1`, devolucion).Scan(&x); err != nil {
			t.Fatal(err)
		}
		return x
	}

	_, factura, renglon := facturado("TR-1", "transferencia")
	if x := tramo(devolver("TR-1", factura, renglon)); x != 605 {
		t.Errorf("tramo de la transferencia: %v", x)
	}
	_, factura, renglon = facturado("MP-1", "mercado_pago")
	if x := tramo(devolver("MP-1", factura, renglon)); x != 0 {
		t.Errorf("tramo de Mercado Pago sin su aviso: %v", x)
	}

	asientos, err := e.s.AsientosDelPeriodo(ctx, time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), time.Now().AddDate(0, 1, 0))
	if err != nil {
		t.Fatal(err)
	}
	asientos = DelCircuito(asientos, "blanco")
	reintegro := 0.0
	for _, a := range asientos {
		if strings.HasPrefix(a.Concepto, "Reintegro parcial") && strings.Contains(a.Concepto, "TR-1") {
			reintegro += a.Renglones[0].Debe
			if a.Renglones[1].Cuenta != Cuentas.Banco {
				t.Errorf("el reintegro sale de %s", a.Renglones[1].Cuenta)
			}
		}
	}
	if reintegro != 605 {
		t.Errorf("reintegro de la transferencia: %v", reintegro)
	}
	// TR-1 cierra en cero; MP-1 queda con 605 en contra hasta que avise Mercado Pago.
	if s := redondear(SaldoDeCuenta(asientos, Cuentas.Deudores)); s != -605 {
		t.Errorf("Deudores: %v, quería −605 (lo de Mercado Pago que falta avisar)", s)
	}
}
