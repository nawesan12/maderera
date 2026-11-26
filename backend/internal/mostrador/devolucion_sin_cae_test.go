package mostrador

import (
	"context"
	"testing"

	"mjbj/internal/facturacion"
	"mjbj/internal/ventas"
)

// La devolución de una venta cuya factura espera el CAE (simulación del mes,
// H294/H347): el stock vuelve, la caja devuelve, y la nota de crédito sale
// numerada y sin CAE, atada a la factura. No se autoriza antes que ella.
func TestDevolucionDeUnaFacturaSinCae(t *testing.T) {
	e := armar(t)
	c := e.vendidaSinFactura(t, "sin-cae@prueba.test", VentaPedida{MedioPago: ventas.Efectivo, Lineas: placas(e, 10, 100)})
	res, err := c.facturar(t)
	if err != nil || res.InvoiceID == nil {
		t.Fatalf("factura: %v %+v", err, res)
	}
	c.factura = *res.InvoiceID
	c.renglon = e.txt(t, `select id::text from invoice_items where invoice_id = $1 order by orden limit 1`, c.factura)
	antes := c.caja(t)
	// La pantalla calcula antes de confirmar: sin CAE cortaba ahí con «Sin
	// CAE no hay nada que anular» (mes simulado, H270).
	if total, err := c.fac.CalcularDevolucion(context.Background(), c.factura,
		[]facturacion.RenglonADevolver{{ItemID: c.renglon, Cantidad: 2, AlStock: true}}); err != nil || total != 200 {
		t.Fatalf("el cálculo sin CAE: %v %v", total, err)
	}
	d, err := c.devolver(2, facturacion.DevolverPorCaja)
	if err != nil {
		t.Fatal(err)
	}
	if d.NotaID == "" {
		t.Fatalf("sin nota: %+v", d)
	}
	if q, _ := e.fisicoYReservado(t); q != 92 {
		t.Fatalf("el stock no volvió: %v", q)
	}
	if despues := c.caja(t); despues != antes-200 {
		t.Fatalf("la caja: %v → %v", antes, despues)
	}
	if origen := e.txt(t, `select coalesce(comprobante_origen_id::text, '') from invoices where id = $1`, d.NotaID); origen != c.factura {
		t.Fatalf("la nota no está atada a la factura: %q", origen)
	}
	if _, err := c.fac.Autorizar(context.Background(), d.NotaID); facturacion.Mensaje(err) != "Primero se autoriza la factura que corrige esta nota." {
		t.Fatalf("autorizar la nota antes que la factura: %v", err)
	}
}
