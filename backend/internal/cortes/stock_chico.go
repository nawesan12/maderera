package cortes

import (
	"context"
	"math"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/jsmath"
	"mjbj/internal/reglas"
	"mjbj/internal/sqlc"
)

// StockDeLaPlacaChica deja el stock de la placa de la casa de un corte con
// placas que no pasan la media placa como dice la regla corte_chico_stock
// (00391, mes simulado M3S4-016): con «descuenta», terminado o retirado, las
// placas parciales que ninguna venta descuenta salen del stock de su
// sucursal; vuelto a la máquina, vuelven. Con «no_mueve» (la de arranque) no
// hace nada: el recorte queda en la maderera y la placa sigue contada.
//
// Lleva la cuenta de lo ya movido por el corte (documento «corte»): se
// puede llamar las veces que haga falta y solo mueve la diferencia.
func (s *Servicio) StockDeLaPlacaChica(ctx context.Context, ses *auth.Sesion, id string) error {
	if !reglas.Es(ctx, s.pool, reglas.CorteChicoStock, "descuenta") {
		return nil
	}
	c, err := s.Obtener(ctx, id)
	if err != nil || c == nil || c.VariantID == nil || len(c.Piezas) == 0 {
		return err
	}
	objetivo := 0.0
	if c.Estado == "terminado" || c.Estado == "retirado" {
		if objetivo, err = s.placasParcialesSinVender(ctx, c); err != nil {
			return err
		}
	}
	var sucursal *string
	if err := s.pool.QueryRow(ctx, `SELECT coalesce(branch_id, (SELECT id FROM branches WHERE active ORDER BY sort_order LIMIT 1))::text
		FROM cutting_orders WHERE id = $1`, id).Scan(&sucursal); err != nil || sucursal == nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: *c.VariantID, Sucursal: *sucursal}); err != nil {
			return err
		}
		var movido float64
		if err := tx.QueryRow(ctx, `SELECT coalesce(sum(qty), 0)::float8 FROM inventory_movements
			WHERE documento_tipo = 'corte' AND documento_id = $1`, id).Scan(&movido); err != nil {
			return err
		}
		delta := jsmath.Round(float64((-objetivo-movido)*1000)) / 1000
		if delta == 0 {
			return nil
		}
		if err := q.SumarCantidad(ctx, sqlc.SumarCantidadParams{VariantID: *c.VariantID, BranchID: *sucursal, Qty: jsmath.Num(delta)}); err != nil {
			return err
		}
		tipo, nota := sqlc.MovementTypeEgreso, "Corte "+c.Numero+": placa de la casa, se cobró el corte"
		if delta > 0 {
			tipo, nota = sqlc.MovementTypeIngreso, "Corte "+c.Numero+": volvió a la máquina"
		}
		var usuario *string
		if ses != nil {
			usuario = &ses.UserID
		}
		_, err := tx.Exec(ctx, `INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id, documento_tipo, documento_id)
			VALUES ($1, $2, $3, $4::numeric, $5, $6, 'corte', $7)`, *c.VariantID, *sucursal, tipo, jsmath.Texto(delta), nota, usuario, id)
		return err
	})
}

// placasParcialesSinVender son las placas del plano (en enteras: una media
// es 0,5) que no pasan la mitad y que ninguna venta descuenta: las del
// corte suelto o vendido por pasadas, y en un pedido solo lo que usa de más
// de lo que vende (M2S4-009, M3S1-007).
func (s *Servicio) placasParcialesSinVender(ctx context.Context, c *Corte) (float64, error) {
	plano, err := s.PlanoParaCobrar(ctx, c)
	if err != nil {
		return 0, err
	}
	parciales := 0.0
	for _, p := range plano.Placas {
		if !p.SeVendeEntera {
			parciales++
		}
	}
	if c.Medida.Mitad != nil && *c.Medida.Mitad != "" {
		parciales *= 0.5
	}
	pedido, _, err := s.pedidoDelCorte(ctx, c)
	if err != nil {
		return 0, err
	}
	if pedido != nil && pedido.PlacasDelPedido > 0 {
		otros, err := s.placasDeOtrosCortes(ctx, c)
		if err != nil {
			return 0, err
		}
		deMas := placasUsadas(c, plano) + otros - pedido.PlacasDelPedido
		parciales = math.Min(parciales, math.Max(0, deMas))
	}
	return parciales, nil
}
