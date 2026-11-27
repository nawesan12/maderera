package mostrador

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/api/mostradorapi"
	"mjbj/internal/autorizacion"
	"mjbj/internal/jsmath"
	"mjbj/internal/pedidos"
	"mjbj/internal/plataforma"
	"mjbj/internal/ventas"
)

// La devolución de una parte de una venta del mostrador sin factura (mes
// simulado, M3S2-060): «Devolver una parte» aparecía solo en las ventas con
// factura, y la de comprobante había que anularla entera. La hace
// pedidos.DevolverSinFacturaPor (el stock, la devolución y la plata por la
// caja o por el medio de pago), con el PIN para el vendedor, como la de
// factura.

func (o respuesta) VisitDevolucionSinFacturaDatosResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitDevolucionSinFacturaDeMostradorResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

// ventaSinFactura es el número y la sucursal de una venta del mostrador sin
// factura viva, o un 404.
func (a *API) ventaSinFactura(ctx context.Context, pedido string) (string, string, error) {
	var numero, sucursal string
	var facturada bool
	err := a.s.pool.QueryRow(ctx, `SELECT o.numero, coalesce(o.branch_id::text, ''),
		EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.tipo::text NOT LIKE 'nota%' AND i.estado NOT IN ('anulada', 'borrador'))
		FROM orders o WHERE o.id::text = $1 AND o.origen = 'mostrador' AND o.estado <> 'cancelado'`, pedido).Scan(&numero, &sucursal, &facturada)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && facturada) {
		return "", "", plataforma.NuevoProblema(http.StatusNotFound, "Esa venta no tiene nada para devolver acá.")
	}
	return numero, sucursal, err
}

func (a *API) DevolucionSinFacturaDatos(ctx context.Context, r mostradorapi.DevolucionSinFacturaDatosRequestObject) (mostradorapi.DevolucionSinFacturaDatosResponseObject, error) {
	if _, err := puesto(ctx); err != nil {
		return nil, err
	}
	numero, _, err := a.ventaSinFactura(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	filas, err := a.s.pool.Query(ctx, `
		SELECT oi.id::text, oi.descripcion, oi.unidad, oi.cantidad::float8,
		       coalesce((SELECT sum(di.cantidad) FROM devolucion_items di WHERE di.order_item_id = oi.id), 0)::float8,
		       oi.precio_unitario::float8
		FROM order_items oi WHERE oi.order_id::text = $1 ORDER BY oi.orden, oi.id`, r.Id)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	renglones := []map[string]any{}
	for filas.Next() {
		var id, descripcion, unidad string
		var cantidad, devuelto, precio float64
		if err := filas.Scan(&id, &descripcion, &unidad, &cantidad, &devuelto, &precio); err != nil {
			return nil, err
		}
		renglones = append(renglones, map[string]any{"orderItemId": id, "descripcion": descripcion, "unidad": unidad,
			"cantidad": cantidad, "devuelto": devuelto, "precioUnitario": precio})
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	var efectivo, afuera float64
	if err := a.s.pool.QueryRow(ctx, `
		SELECT coalesce((SELECT sum(op.importe) FROM order_payments op WHERE op.order_id = o.id AND op.medio = 'efectivo'), 0)::float8
		       - coalesce((SELECT sum(d.importe) FROM devoluciones d WHERE d.order_id = o.id AND d.destino = 'caja'), 0)::float8,
		       coalesce((SELECT sum(op.importe) FROM order_payments op WHERE op.order_id = o.id AND op.medio NOT IN ('efectivo', 'cuenta_corriente')), 0)::float8
		       - coalesce((SELECT sum(d.importe) FROM devoluciones d WHERE d.order_id = o.id AND d.destino = 'afuera'), 0)::float8
		FROM orders o WHERE o.id::text = $1`, r.Id).Scan(&efectivo, &afuera); err != nil {
		return nil, err
	}
	return ok(map[string]any{"numero": numero, "renglones": renglones, "efectivo": jsmath.Redondear2(efectivo), "afuera": jsmath.Redondear2(afuera)}), nil
}

func (a *API) DevolucionSinFacturaDeMostrador(ctx context.Context, r mostradorapi.DevolucionSinFacturaDeMostradorRequestObject) (mostradorapi.DevolucionSinFacturaDeMostradorResponseObject, error) {
	ses, err := puesto(ctx)
	if err != nil {
		return nil, err
	}
	_, sucursal, err := a.ventaSinFactura(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	b := r.Body
	// El importe, para el PIN: lo que vale cada renglón en la venta.
	importe := 0.0
	var renglones []pedidos.RenglonDevuelto
	for _, x := range b.Renglones {
		renglones = append(renglones, pedidos.RenglonDevuelto{OrderItemID: x.OrderItemId, Cantidad: x.Cantidad})
		var subtotal, cantidad float64
		if err := a.s.pool.QueryRow(ctx, `SELECT subtotal::float8, cantidad::float8 FROM order_items WHERE id::text = $1 AND order_id::text = $2`,
			x.OrderItemId, r.Id).Scan(&subtotal, &cantidad); err == nil && cantidad > 0 && x.Cantidad > 0 {
			importe = ventas.ACentavos(importe + ventas.ACentavos(float64(subtotal*x.Cantidad)/cantidad))
		}
	}
	pin, ficha := "", ""
	if b.Pin != nil {
		pin = *b.Pin
	}
	if b.Ficha != nil {
		ficha = *b.Ficha
	}
	_, err = a.s.aut.Exigir(ctx, ses, autorizacion.Pedido{Motivo: autorizacion.Devolver, Monto: importe, Clave: "devolucion:" + b.Clave,
		Sucursal: sucursal, PIN: pin, Ficha: ficha})
	var falta *autorizacion.Falta
	if errors.As(err, &falta) {
		fa := faltaDeAutorizacion(falta)
		return ok(map[string]any{"error": fa.Error, "autorizacion": fa.Autorizacion}), nil
	}
	if err != nil {
		return nil, err
	}
	porDonde := string(b.Destino)
	if porDonde == "cuenta" {
		// La de siempre: a la cuenta corriente, o baja lo que falta cobrar.
		porDonde = ""
	}
	d, err := pedidos.Nuevo(a.s.pool, a.s.log).DevolverSinFacturaPor(ctx, ses, r.Id, renglones, b.Motivo, b.Clave, porDonde)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"ok": d.Ok}), nil
}
