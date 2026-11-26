package facturacion

import (
	"context"
	"errors"
	"math"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
)

// La devolución de un pedido facturado, desde el pedido (mes simulado,
// H279). La de la factura (DevolucionParcial) es del admin y elige por dónde
// vuelve la plata; la del pedido es de quien mueve plata (roles.ManejanPlata)
// y sigue la regla de la devolución sin factura:
//
//   - Es la misma operación: la nota de crédito sobre la factura viva del
//     pedido (misma letra y punto de venta, atada a ella; sin CAE si la
//     factura todavía no lo tiene), el stock atado a la devolución y al
//     pedido, en una transacción y con una clave por intento.
//   - La plata no sale de acá. Si la venta se cargó a la cuenta corriente,
//     la nota va a la cuenta (baja la deuda o deja saldo a favor); si no,
//     baja lo que falta cobrar del pedido y no más. Lo ya cobrado vuelve por
//     la caja o el banco, desde la factura (acreditarPago y emitirRecibo
//     siguen siendo la única puerta).
//   - Todo vuelve al stock: de cada renglón sale primero lo que sigue en
//     acopio y el resto lo trae el cliente, a la sucursal del pedido.

// RenglonDelPedidoADevolver es cuánto de un renglón de la factura del pedido.
type RenglonDelPedidoADevolver struct {
	ItemID   string  `json:"itemId"`
	Cantidad float64 `json:"cantidad"`
}

// DevolucionDesdeElPedido es lo que necesita el diálogo del pedido.
type DevolucionDesdeElPedido struct {
	FacturaID string `json:"facturaId"`
	Factura   string `json:"factura"`
	// Destino: «cuenta» (la nota va a la cuenta corriente) o «deuda» (baja
	// lo que falta cobrar).
	Destino string `json:"destino"`
	// Tope es lo que se puede devolver desde el pedido: lo que se cargó a la
	// cuenta o lo que falta cobrar. 0: ya está cobrado, la plata vuelve desde
	// la factura.
	Tope      float64             `json:"tope"`
	Renglones []RenglonDevolvible `json:"renglones"`
}

// facturaVivaDelPedido es la factura (no nota, no borrador, no anulada) del
// pedido, o "" si no tiene.
func facturaVivaDelPedido(ctx context.Context, c consultor, pedido string) (string, error) {
	var id string
	err := c.QueryRow(ctx, `SELECT id FROM invoices WHERE order_id = $1 AND tipo::text LIKE 'factura%'
		AND estado NOT IN ('anulada', 'borrador') ORDER BY created_at DESC LIMIT 1`, pedido).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// destinoDesdeElPedido elige por dónde vuelve la plata con los topes de la
// factura.
func destinoDesdeElPedido(d *DatosDeDevolucion) (string, float64) {
	if d.ConCliente && d.Cuenta > 0.005 {
		return DevolverPorCuenta, d.Cuenta
	}
	return DevolverLaDeuda, d.Deuda
}

// ParaDevolverDesdeElPedido arma el diálogo. ErrNoEsta si el pedido no tiene
// factura viva.
func (s *Servicio) ParaDevolverDesdeElPedido(ctx context.Context, pedido string) (*DevolucionDesdeElPedido, error) {
	factura, err := facturaVivaDelPedido(ctx, s.pool, pedido)
	if err != nil {
		return nil, err
	}
	if factura == "" {
		return nil, ErrNoEsta
	}
	d, err := s.ParaDevolver(ctx, factura)
	if err != nil {
		return nil, err
	}
	if d == nil || d.VentaAnulada {
		return nil, ErrNoEsta
	}
	o, err := leerOriginal(ctx, s.pool, factura, false)
	if err != nil {
		return nil, err
	}
	out := &DevolucionDesdeElPedido{FacturaID: factura, Factura: etiqueta(o.tipo, o.puntoVenta, o.numero), Renglones: d.Renglones}
	out.Destino, out.Tope = destinoDesdeElPedido(d)
	return out, nil
}

// renglonesDesdeElPedido: todo vuelve al stock (lo que es del depósito) y
// sale primero del acopio.
func renglonesDesdeElPedido(d *DatosDeDevolucion, pedidos []RenglonDelPedidoADevolver) ([]RenglonADevolver, error) {
	por := map[string]RenglonDevolvible{}
	for _, r := range d.Renglones {
		por[r.ItemID] = r
	}
	out := []RenglonADevolver{}
	for _, p := range pedidos {
		if math.IsNaN(p.Cantidad) || math.IsInf(p.Cantidad, 0) || p.Cantidad < 0 {
			return nil, errEmision("Revisá las cantidades.")
		}
		if p.Cantidad == 0 {
			continue
		}
		r, ok := por[p.ItemID]
		if !ok {
			return nil, errEmision("Uno de los renglones no es de la factura de este pedido.")
		}
		if p.Cantidad > r.Queda+1e-9 {
			return nil, errEmision(`De "` + r.Descripcion + `" se puede devolver hasta ` + jsmath.Texto(r.Queda) + `.`)
		}
		x := RenglonADevolver{ItemID: p.ItemID, Cantidad: p.Cantidad, AlStock: r.AlStock}
		if r.AlStock {
			acopio := math.Min(p.Cantidad, r.EnAcopio)
			x.DelAcopio = &acopio
		}
		out = append(out, x)
	}
	if len(out) == 0 {
		return nil, errEmision("Elegí qué devuelve.")
	}
	return out, nil
}

// CalcularDesdeElPedido es el importe de la nota que saldría.
func (s *Servicio) CalcularDesdeElPedido(ctx context.Context, pedido string, renglones []RenglonDelPedidoADevolver) (float64, error) {
	factura, err := facturaVivaDelPedido(ctx, s.pool, pedido)
	if err != nil {
		return 0, err
	}
	if factura == "" {
		return 0, ErrNoEsta
	}
	d, err := s.ParaDevolver(ctx, factura)
	if err != nil {
		return 0, err
	}
	if d == nil {
		return 0, ErrNoEsta
	}
	rs, err := renglonesDesdeElPedido(d, renglones)
	if err != nil {
		return 0, err
	}
	return s.CalcularDevolucion(ctx, factura, rs)
}

// DevolverDesdeElPedido hace la devolución. El tope se controla otra vez
// adentro de la transacción (DevolucionParcial, con «cuenta» o «deuda»):
// lo que se lee acá solo elige el destino.
func (s *Servicio) DevolverDesdeElPedido(ctx context.Context, userID, pedido, clave, motivo string,
	renglones []RenglonDelPedidoADevolver, importe *float64) (Devolucion, error) {
	if d, err := porClave(ctx, s.pool, clave); err != nil || d != nil {
		if d != nil {
			return *d, nil
		}
		return Devolucion{}, err
	}
	factura, err := facturaVivaDelPedido(ctx, s.pool, pedido)
	if err != nil {
		return Devolucion{}, err
	}
	if factura == "" {
		return Devolucion{}, errEmision("El pedido no tiene factura: la devolución baja lo que falta cobrar, sin nota.")
	}
	d, err := s.ParaDevolver(ctx, factura)
	if err != nil {
		return Devolucion{}, err
	}
	if d == nil || d.VentaAnulada {
		return Devolucion{}, errEmision("La venta está anulada: ya se devolvió todo.")
	}
	rs, err := renglonesDesdeElPedido(d, renglones)
	if err != nil {
		return Devolucion{}, err
	}
	destino, tope := destinoDesdeElPedido(d)
	if tope <= 0.005 {
		return Devolucion{}, errEmision("El pedido ya está cobrado: la plata vuelve por la caja o el banco, desde la factura.")
	}
	if importe != nil && *importe > tope+0.005 {
		if destino == DevolverPorCuenta {
			return Devolucion{}, errEmision("A la cuenta vuelve hasta " + formato.Moneda(tope) + ": lo que esta venta le cargó.")
		}
		return Devolucion{}, errEmision("Lo devuelto (" + formato.Moneda(*importe) + ") pasa lo que falta cobrar (" + formato.Moneda(tope) + "). Lo cobrado vuelve desde la factura.")
	}
	out, err := s.DevolucionParcial(ctx, userID, PedidoDeDevolucion{
		InvoiceID: factura, Clave: clave, Destino: destino, Motivo: motivo,
		BranchID: derefTexto(d.Sucursal), Renglones: rs, Importe: importe,
	})
	if err != nil {
		return Devolucion{}, err
	}
	if !out.Repetida {
		// En el historial del pedido, como la devolución sin factura.
		_, _ = s.pool.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id)
			SELECT id, estado, $2, $3 FROM orders WHERE id = $1`, pedido,
			"Devolución con nota de crédito · "+formato.Importe(out.Importe)+" · "+motivo, userID)
	}
	return out, nil
}

func derefTexto(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
