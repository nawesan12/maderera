// Package reservas es el puente entre vender y el depósito
// (lib/inventario/reservas.ts), más lo que una venta lee del producto dentro
// de su transacción: el factor de stock de cada línea (lib/ventas/factores.ts)
// y el costo que se congela (lib/compras/congelar.ts).
//
// | Momento                 | Físico (qty) | Reservado |
// |-------------------------|--------------|-----------|
// | Se confirma el pedido   | no cambia    | sube      |
// | Sale la mercadería      | baja         | baja      |
// | Se cancela el pedido    | no cambia    | baja      |
//
// Disponible = qty − reservado. Todo cambio toma el candado del stock de la
// variante en la sucursal (hashtext(variante || sucursal), el de
// lib/inventario/locks.ts) y corre en la transacción de quien llama.
//
// Lo usan el mostrador, los pedidos y las entregas (tanda 5), y lo va a usar
// el checkout (tanda 6).
package reservas

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"mjbj/internal/jsmath"
	"mjbj/internal/ventas"
)

// Tx es lo que necesitan: una transacción de pgx.
type Tx = pgx.Tx

// Bloquear toma el candado del stock de una variante en una sucursal.
func Bloquear(ctx context.Context, tx Tx, variante, sucursal string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1::text || $2::text))`, variante, sucursal)
	return err
}

func num(v float64) string { return jsmath.Texto(v) }

// sucursalDelPedido: la del pedido, o la primera activa (un envío no tiene).
func sucursalDelPedido(ctx context.Context, tx Tx, sucursal *string) (string, bool, error) {
	if sucursal != nil {
		return *sucursal, true, nil
	}
	var id string
	err := tx.QueryRow(ctx, `SELECT id FROM branches WHERE active = true ORDER BY sort_order LIMIT 1`).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return id, err == nil, err
}

// moverReservado suma delta al reservado (nunca por debajo de cero).
func moverReservado(ctx context.Context, tx Tx, variante, sucursal string, delta float64) error {
	if err := Bloquear(ctx, tx, variante, sucursal); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		UPDATE inventory SET reservado = greatest(reservado + $3::numeric, 0), updated_at = now()
		WHERE variant_id = $1 AND branch_id = $2`, variante, sucursal, num(ventas.CantidadDeStock(delta)))
	return err
}

// ReservarPedido reserva la mercadería de un pedido. Idempotente: si ya
// tiene reservas activas, no hace nada.
func ReservarPedido(ctx context.Context, tx Tx, pedido string) error {
	var hay bool
	if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM stock_reservations WHERE order_id = $1 AND estado = 'activa')`, pedido).Scan(&hay); err != nil {
		return err
	}
	if hay {
		return nil
	}
	var suc *string
	err := tx.QueryRow(ctx, `SELECT branch_id FROM orders WHERE id = $1`, pedido).Scan(&suc)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	sucursal, ok, err := sucursalDelPedido(ctx, tx, suc)
	if err != nil || !ok {
		return err
	}
	filas, err := tx.Query(ctx, `SELECT id, variant_id, cantidad, stock_por_unidad FROM order_items WHERE order_id = $1`, pedido)
	if err != nil {
		return err
	}
	type linea struct {
		id       string
		variante *string
		cantidad jsmath.Num
		factor   jsmath.Num
	}
	var lineas []linea
	for filas.Next() {
		var l linea
		if err := filas.Scan(&l.id, &l.variante, &l.cantidad, &l.factor); err != nil {
			filas.Close()
			return err
		}
		lineas = append(lineas, l)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return err
	}
	for _, l := range lineas {
		if l.variante == nil {
			continue
		}
		cantidad := ventas.UnidadesDeStock(l.cantidad.F(), l.factor.F())
		if !(cantidad > 0) {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO stock_reservations (order_id, order_item_id, variant_id, branch_id, cantidad)
			VALUES ($1, $2, $3, $4, $5::numeric)`, pedido, l.id, *l.variante, sucursal, num(cantidad)); err != nil {
			return err
		}
		if err := moverReservado(ctx, tx, *l.variante, sucursal, cantidad); err != nil {
			return err
		}
	}
	return nil
}

// LiberarReservas libera lo reservado de un pedido, sin tocar el físico.
func LiberarReservas(ctx context.Context, tx Tx, pedido string) error {
	filas, err := tx.Query(ctx, `
		SELECT id, variant_id, branch_id, cantidad FROM stock_reservations
		WHERE order_id = $1 AND estado = 'activa'`, pedido)
	if err != nil {
		return err
	}
	type reserva struct {
		id, variante, sucursal string
		cantidad               jsmath.Num
	}
	var activas []reserva
	for filas.Next() {
		var r reserva
		if err := filas.Scan(&r.id, &r.variante, &r.sucursal, &r.cantidad); err != nil {
			filas.Close()
			return err
		}
		activas = append(activas, r)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return err
	}
	ids := make([]string, 0, len(activas))
	for _, r := range activas {
		if err := moverReservado(ctx, tx, r.variante, r.sucursal, -r.cantidad.F()); err != nil {
			return err
		}
		ids = append(ids, r.id)
	}
	if len(ids) > 0 {
		_, err := tx.Exec(ctx, `UPDATE stock_reservations SET estado = 'liberada', resuelto_at = now() WHERE id = ANY($1::uuid[])`, ids)
		return err
	}
	return nil
}

// SalidaDeMercaderia es un renglón que sale con un remito.
type SalidaDeMercaderia struct {
	OrderItemID string
	Cantidad    float64
}

// Salida es lo que sale con un remito.
type Salida struct {
	OrderID      string
	BranchID     string
	NumeroRemito string
	Lineas       []SalidaDeMercaderia
	UsuarioID    *string
}

// SalidaPorEntrega saca mercadería del depósito: baja el físico (puede quedar
// negativo), deja el movimiento «venta» y consume la reserva del renglón.
func SalidaPorEntrega(ctx context.Context, tx Tx, s Salida) error {
	for _, l := range s.Lineas {
		var variante *string
		var factor jsmath.Num
		err := tx.QueryRow(ctx, `SELECT variant_id, stock_por_unidad FROM order_items WHERE id = $1`, l.OrderItemID).Scan(&variante, &factor)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if variante == nil {
			continue
		}
		cantidad := ventas.UnidadesDeStock(l.Cantidad, factor.F())
		if !(cantidad > 0) {
			continue
		}
		v := *variante
		if err := Bloquear(ctx, tx, v, s.BranchID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE inventory SET qty = qty - $3::numeric, updated_at = now() WHERE variant_id = $1 AND branch_id = $2`,
			v, s.BranchID, num(cantidad)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id)
			VALUES ($1, $2, 'venta', $3::numeric, $4, $5)`, v, s.BranchID, num(-cantidad), "Remito "+s.NumeroRemito, s.UsuarioID); err != nil {
			return err
		}
		var rid, rsuc string
		var rcant jsmath.Num
		err = tx.QueryRow(ctx, `
			SELECT id, branch_id, cantidad FROM stock_reservations
			WHERE order_item_id = $1 AND estado = 'activa' LIMIT 1`, l.OrderItemID).Scan(&rid, &rsuc, &rcant)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		consumido := cantidad
		if rcant.F() < consumido {
			consumido = rcant.F()
		}
		if err := moverReservado(ctx, tx, v, rsuc, -consumido); err != nil {
			return err
		}
		if consumido >= rcant.F() {
			_, err = tx.Exec(ctx, `UPDATE stock_reservations SET estado = 'consumida', resuelto_at = now() WHERE id = $1`, rid)
		} else {
			_, err = tx.Exec(ctx, `UPDATE stock_reservations SET cantidad = $2::numeric WHERE id = $1`, rid, num(ventas.CantidadDeStock(rcant.F()-consumido)))
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// LineaDevuelta es lo que vuelve al galpón.
type LineaDevuelta struct {
	VariantID string
	Cantidad  float64
}

// DevolverAlStock sube el físico con un movimiento «devolucion» (la
// anulación de un remito). No vuelve a reservar.
func DevolverAlStock(ctx context.Context, tx Tx, sucursal, numeroRemito string, usuario *string, lineas []LineaDevuelta) error {
	for _, l := range lineas {
		if !(l.Cantidad > 0) {
			continue
		}
		if err := Bloquear(ctx, tx, l.VariantID, sucursal); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE inventory SET qty = qty + $3::numeric, updated_at = now() WHERE variant_id = $1 AND branch_id = $2`,
			l.VariantID, sucursal, num(l.Cantidad)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id)
			VALUES ($1, $2, 'devolucion', $3::numeric, $4, $5)`, l.VariantID, sucursal, num(l.Cantidad), "Anulación del remito "+numeroRemito, usuario); err != nil {
			return err
		}
	}
	return nil
}

// RecalcularReservado rehace inventory.reservado desde las reservas activas.
// Devuelve cuántas filas estaban distintas.
func RecalcularReservado(ctx context.Context, db interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}) (int64, error) {
	tag, err := db.Exec(ctx, `
		with reales as (
		  select variant_id, branch_id, sum(cantidad) as total
		  from stock_reservations where estado = 'activa'
		  group by variant_id, branch_id
		)
		update inventory i set reservado = coalesce(r.total, 0), updated_at = now()
		from (select id, variant_id, branch_id from inventory) src
		left join reales r on r.variant_id = src.variant_id and r.branch_id = src.branch_id
		where i.id = src.id and i.reservado is distinct from coalesce(r.total, 0)`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// --- lib/ventas/factores.ts ---

// LineaConPresentacion es lo mínimo de una línea para su factor.
type LineaConPresentacion struct {
	VariantID    *string
	Presentacion *string
}

// FactorDeLinea es la presentación validada y cuánto stock mueve cada unidad.
type FactorDeLinea struct {
	Presentacion   *string
	StockPorUnidad float64
}

// FactoresDeStock lee del producto (no del navegador) cuánto descuenta cada
// línea: una media sobre una placa que no la admite se descarta.
func FactoresDeStock(ctx context.Context, tx Tx, lineas []LineaConPresentacion) ([]FactorDeLinea, error) {
	ids := map[string]bool{}
	var lista []string
	for _, l := range lineas {
		if l.VariantID != nil && !ids[*l.VariantID] {
			ids[*l.VariantID] = true
			lista = append(lista, *l.VariantID)
		}
	}
	porVariante := map[string]ventas.ProductoQueSeVende{}
	if len(lista) > 0 {
		filas, err := tx.Query(ctx, `
			SELECT v.id, v.largo_mm, v.ancho_mm, p.unit, p.forma_de_venta, p.precio_media_pct
			FROM product_variants v JOIN products p ON p.id = v.product_id
			WHERE v.id = ANY($1::uuid[])`, lista)
		if err != nil {
			return nil, err
		}
		for filas.Next() {
			var id string
			var p ventas.ProductoQueSeVende
			var pct jsmath.Num
			if err := filas.Scan(&id, &p.LargoMm, &p.AnchoMm, &p.Unit, &p.FormaDeVenta, &pct); err != nil {
				filas.Close()
				return nil, err
			}
			p.PrecioMediaPct = float64(pct)
			porVariante[id] = p
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return nil, err
		}
	}
	out := make([]FactorDeLinea, len(lineas))
	for i, l := range lineas {
		var p ventas.ProductoQueSeVende
		ok := false
		if l.VariantID != nil {
			p, ok = porVariante[*l.VariantID]
		}
		if !ok {
			out[i] = FactorDeLinea{StockPorUnidad: 1}
			continue
		}
		var pres *string
		if ventas.EsPresentacion(l.Presentacion) && ventas.AdmiteMedia(p) {
			x := *l.Presentacion
			pres = &x
		}
		f, err := ventas.FactorDeStock(p, pres)
		if err != nil {
			return nil, err
		}
		out[i] = FactorDeLinea{Presentacion: pres, StockPorUnidad: f}
	}
	return out, nil
}

// --- lib/compras/congelar.ts ---

// CostoCongelado es el costo promedio (nil: no se sabe) y la alícuota.
type CostoCongelado struct {
	CostoUnitario *string // el numeric tal cual, como lo leía drizzle
	AlicuotaIva   string
}

// CostosParaCongelar trae el costo y la alícuota de cada variante, en una
// sola consulta.
func CostosParaCongelar(ctx context.Context, tx Tx, variantes []string) (map[string]CostoCongelado, error) {
	mapa := map[string]CostoCongelado{}
	vistos := map[string]bool{}
	var unicos []string
	for _, v := range variantes {
		if !vistos[v] {
			vistos[v] = true
			unicos = append(unicos, v)
		}
	}
	if len(unicos) == 0 {
		return mapa, nil
	}
	filas, err := tx.Query(ctx, `
		SELECT v.id, p.alicuota_iva::text, c.costo_promedio::text
		FROM product_variants v JOIN products p ON p.id = v.product_id
		LEFT JOIN variant_costs c ON c.variant_id = v.id
		WHERE v.id = ANY($1::uuid[])`, unicos)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var id string
		var c CostoCongelado
		if err := filas.Scan(&id, &c.AlicuotaIva, &c.CostoUnitario); err != nil {
			return nil, err
		}
		mapa[id] = c
	}
	return mapa, filas.Err()
}

// CostoPorUnidadDeVenta es el costo por unidad de stock × el factor, a 4
// decimales (toFixed(4)); nil si no se sabe.
func CostoPorUnidadDeVenta(costo *string, stockPorUnidad float64) *string {
	if costo == nil {
		return nil
	}
	s := jsmath.ToFixed(float64(jsmath.Numero(*costo)*stockPorUnidad), 4)
	return &s
}
