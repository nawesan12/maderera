package compras

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
)

// La devolución de mercadería al proveedor, con su nota de crédito
// (M3S2-016). Antes la nota bajaba la deuda y el IVA, pero lo devuelto
// seguía en el stock con su costo y había que pedir un ajuste aparte, sin
// atar a la nota. Ahora la nota elige renglones de las recepciones
// confirmadas del proveedor: salen del stock de la sucursal donde entraron
// y el costo promedio se corrige sacando lo devuelto a su costo. Anular la
// nota vuelve a entrar las cantidades (el costo, como al anular una
// recepción, no se revierte).

// RenglonDevolvible es un renglón recibido del que todavía se puede devolver.
type RenglonDevolvible struct {
	ID            string    `json:"id"`
	Remito        *string   `json:"remito"`
	Fecha         time.Time `json:"fecha"`
	Descripcion   string    `json:"descripcion"`
	Unidad        *string   `json:"unidad"`
	Recibido      float64   `json:"recibido"`
	Devuelto      float64   `json:"devuelto"`
	CostoUnitario float64   `json:"costoUnitario"`
}

// Devolucion es lo que una nota de crédito devuelve de un renglón.
type Devolucion struct {
	ItemID   string
	Cantidad float64
}

// devueltoSQL es lo ya devuelto de un renglón de recepción, por notas vivas.
const devueltoSQL = `coalesce((SELECT sum(d.cantidad) FROM purchase_return_items d JOIN purchase_invoices n ON n.id = d.purchase_invoice_id
	WHERE d.goods_receipt_item_id = i.id AND n.anulada_at IS NULL), 0)`

// RenglonesDevolvibles son los de las recepciones confirmadas del proveedor
// de los últimos 120 días que todavía tienen algo para devolver.
func (s *Servicio) RenglonesDevolvibles(ctx context.Context, proveedor string) ([]RenglonDevolvible, error) {
	out := []RenglonDevolvible{}
	if !plataforma.UUIDValido(proveedor) {
		return out, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT i.id, r.numero_remito, r.fecha, trim(coalesce(p.name, '') || ' ' || coalesce(v.label, '')), p.unit::text,
		  i.cantidad, `+devueltoSQL+`, coalesce(i.costo_con_gastos, i.costo_unitario)
		FROM goods_receipt_items i JOIN goods_receipts r ON r.id = i.receipt_id
		LEFT JOIN product_variants v ON v.id = i.variant_id LEFT JOIN products p ON p.id = v.product_id
		WHERE r.supplier_id = $1 AND r.estado = 'confirmada' AND r.fecha > now() - interval '120 days'
		  AND i.cantidad > `+devueltoSQL+`
		ORDER BY r.fecha DESC, i.orden LIMIT 200`, proveedor)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (RenglonDevolvible, error) {
		var x RenglonDevolvible
		var recibido, devuelto, costo jsmath.Num
		err := r.Scan(&x.ID, &x.Remito, &x.Fecha, &x.Descripcion, &x.Unidad, &recibido, &devuelto, &costo)
		x.Recibido, x.Devuelto, x.CostoUnitario = float64(recibido), float64(devuelto), float64(costo)
		return x, err
	})
}

// leerDevoluciones lee `devoluciones: [{itemId, cantidad}]`.
func leerDevoluciones(m map[string]any) ([]Devolucion, error) {
	lista, ok := m["devoluciones"].([]any)
	if !ok {
		return nil, nil
	}
	var out []Devolucion
	for _, x := range lista {
		o, _ := x.(map[string]any)
		id, _ := o["itemId"].(string)
		cant, _ := o["cantidad"].(float64)
		if !plataforma.UUIDValido(id) {
			return nil, plataforma.Invalido(map[string]string{"devoluciones": "Ese renglón no existe."})
		}
		if !(cant > 0) {
			continue
		}
		out = append(out, Devolucion{id, cant})
	}
	if len(out) > 60 {
		return nil, plataforma.Invalido(map[string]string{"devoluciones": "Una nota devuelve hasta 60 renglones."})
	}
	return out, nil
}

// devolverAlProveedor saca del stock lo devuelto y corrige el costo.
func devolverAlProveedor(ctx context.Context, tx pgx.Tx, ses *auth.Sesion, factura, proveedor, numero string, devs []Devolucion) error {
	type renglon struct {
		item, variante, sucursal string
		cantidad, costo          float64
	}
	var renglones []renglon
	for _, d := range devs {
		var r renglon
		var dueno, estado string
		var recibido, devuelto, costo jsmath.Num
		err := tx.QueryRow(ctx, `
			SELECT g.supplier_id, g.estado::text, i.variant_id, g.branch_id, i.cantidad, `+devueltoSQL+`, coalesce(i.costo_con_gastos, i.costo_unitario)
			FROM goods_receipt_items i JOIN goods_receipts g ON g.id = i.receipt_id WHERE i.id = $1 FOR UPDATE OF i`, d.ItemID).
			Scan(&dueno, &estado, &r.variante, &r.sucursal, &recibido, &devuelto, &costo)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && dueno != proveedor {
			return fallo("Ese renglón no es de una recepción de este proveedor.")
		}
		if err != nil {
			return err
		}
		if estado != "confirmada" {
			return fallo("Solo se devuelve lo de una recepción confirmada.")
		}
		if d.Cantidad-(recibido.F()-devuelto.F()) > 0.0001 {
			return fallo("Se devuelve más de lo que llegó en ese renglón.")
		}
		r.item, r.cantidad, r.costo = d.ItemID, d.Cantidad, costo.F()
		renglones = append(renglones, r)
	}
	// Los candados del stock en orden, por sucursal, como la recepción.
	porSucursal := map[string][]string{}
	for _, r := range renglones {
		porSucursal[r.sucursal] = append(porSucursal[r.sucursal], r.variante)
	}
	sucursales := make([]string, 0, len(porSucursal))
	for s := range porSucursal {
		sucursales = append(sucursales, s)
	}
	sort.Strings(sucursales)
	for _, s := range sucursales {
		if err := bloquearStock(ctx, tx, s, porSucursal[s]); err != nil {
			return err
		}
	}
	nota := "Devolución al proveedor · NC " + numero
	for _, r := range renglones {
		// El costo: se saca lo devuelto a su costo del promedio que pondera
		// el stock que hay. Si no queda stock, el promedio no cambia.
		var stock, promedio jsmath.Num
		err := tx.QueryRow(ctx, `SELECT greatest(coalesce((SELECT sum(qty) FROM inventory WHERE variant_id = $1), 0), 0),
			coalesce((SELECT costo_promedio FROM variant_costs WHERE variant_id = $1 FOR UPDATE), 0)`, r.variante).Scan(&stock, &promedio)
		if err != nil {
			return err
		}
		if queda := stock.F() - r.cantidad; queda > 0 && promedio.F() > 0 {
			nuevo := redondear4(float64(float64(stock.F()*promedio.F())-float64(r.cantidad*r.costo)) / queda)
			if nuevo > 0 {
				if _, err := tx.Exec(ctx, `UPDATE variant_costs SET costo_promedio = $2::numeric, updated_at = now() WHERE variant_id = $1`,
					r.variante, jsmath.ToFixed(nuevo, 4)); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `
					INSERT INTO cost_history (variant_id, costo_anterior, costo_nuevo, cantidad_anterior, cantidad_nueva, documento_tipo, documento_id, motivo, created_by_user_id)
					VALUES ($1, $2::numeric, $3::numeric, $4::numeric, $5::numeric, 'devolucion_proveedor', $6, $7, $8)`,
					r.variante, jsmath.ToFixed(promedio.F(), 4), jsmath.ToFixed(nuevo, 4), jsmath.ToFixed(stock.F(), 4), jsmath.ToFixed(queda, 4),
					factura, nota, ses.UserID); err != nil {
					return err
				}
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO inventory (variant_id, branch_id, qty) VALUES ($1, $2, -$3::numeric)
			ON CONFLICT (variant_id, branch_id) DO UPDATE SET qty = inventory.qty - $3::numeric, updated_at = now()`,
			r.variante, r.sucursal, jsmath.Texto(r.cantidad)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, documento_tipo, documento_id, created_by_user_id)
			VALUES ($1, $2, 'egreso', $3::numeric, $4, 'devolucion_proveedor', $5, $6)`,
			r.variante, r.sucursal, jsmath.Texto(-r.cantidad), nota, factura, ses.UserID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO purchase_return_items (purchase_invoice_id, goods_receipt_item_id, variant_id, branch_id, cantidad, costo_unitario)
			VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric)`, factura, r.item, r.variante, r.sucursal,
			jsmath.ToFixed(r.cantidad, 4), jsmath.ToFixed(r.costo, 4)); err != nil {
			return err
		}
	}
	return nil
}

// deshacerDevolucion vuelve al stock lo que devolvía una nota que se anula.
func deshacerDevolucion(ctx context.Context, tx pgx.Tx, ses *auth.Sesion, factura, motivo string) error {
	filas, err := tx.Query(ctx, `SELECT variant_id, branch_id, cantidad FROM purchase_return_items WHERE purchase_invoice_id = $1`, factura)
	if err != nil {
		return err
	}
	type renglon struct {
		variante, sucursal string
		cantidad           jsmath.Num
	}
	renglones, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (renglon, error) {
		var x renglon
		err := r.Scan(&x.variante, &x.sucursal, &x.cantidad)
		return x, err
	})
	if err != nil || len(renglones) == 0 {
		return err
	}
	for _, r := range renglones {
		if err := bloquearStock(ctx, tx, r.sucursal, []string{r.variante}); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO inventory (variant_id, branch_id, qty) VALUES ($1, $2, $3::numeric)
			ON CONFLICT (variant_id, branch_id) DO UPDATE SET qty = inventory.qty + $3::numeric, updated_at = now()`,
			r.variante, r.sucursal, jsmath.Texto(r.cantidad.F())); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, documento_tipo, documento_id, created_by_user_id)
			VALUES ($1, $2, 'ajuste', $3::numeric, $4, 'devolucion_proveedor', $5, $6)`,
			r.variante, r.sucursal, jsmath.Texto(r.cantidad.F()), "Anulación de la nota de crédito: "+motivo, factura, ses.UserID); err != nil {
			return err
		}
	}
	return nil
}
