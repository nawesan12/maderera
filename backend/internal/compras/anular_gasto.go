package compras

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/caja"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// AnularGasto anula un gasto mal cargado (mes simulado: un gasto en
// efectivo anotado por error quedaba descontado del cajón para siempre).
//
// Como el pago a proveedor, no se borra: queda con quién, cuándo y por qué,
// y deja de contar en los totales, el resultado y el cierre. Lo que tocó
// vuelve como lo hace la anulación de un pago:
//   - el efectivo vuelve, como ingreso, al turno abierto de la sucursal de
//     la que salió (un turno cerrado no se reabre: su arqueo ya se contó);
//   - la factura que se cargó con el gasto se anula con él: nació pagada por
//     el gasto y no tiene deuda ni pagos que deshacer.
//
// Con el mes cerrado lo frena la base (mes_cerrado_gastos).
func (s *Servicio) AnularGasto(ctx context.Context, ses *auth.Sesion, id, motivo string) (string, error) {
	motivo = trimJS(motivo)
	if motivo == "" {
		return "", fallo("Poné el motivo: una anulación sin explicación no se puede revisar después.")
	}
	if !plataforma.UUIDValido(id) {
		return "", fallo("Ese gasto no existe.")
	}
	var descripcion string
	var importe jsmath.Num
	var devuelto float64
	var sinCaja string
	var factura *string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var anuladoAt *time.Time
		err := tx.QueryRow(ctx, `
			SELECT descripcion, importe, purchase_invoice_id, anulado_at FROM expenses WHERE id = $1 FOR UPDATE`, id).
			Scan(&descripcion, &importe, &factura, &anuladoAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return fallo("Ese gasto no existe.")
		}
		if err != nil {
			return err
		}
		if anuladoAt != nil {
			return fallo("Ese gasto ya estaba anulado.")
		}

		// El efectivo vuelve a la caja de la sucursal de donde salió.
		var sucursal, nombreSucursal *string
		var salio *jsmath.Num
		if err := tx.QueryRow(ctx, `
			SELECT sum(m.monto), min(c.branch_id::text), min(b.name)
			FROM cash_movements m JOIN cash_sessions c ON c.id = m.session_id JOIN branches b ON b.id = c.branch_id
			WHERE m.expense_id = $1`, id).Scan(&salio, &sucursal, &nombreSucursal); err != nil {
			return err
		}
		if devuelto = -numOCero(salio); devuelto > 0.009 && sucursal != nil {
			turno, hay, err := caja.TurnoAbiertoDe(ctx, tx, *sucursal)
			if err != nil {
				return err
			}
			if !hay {
				sinCaja = *nombreSucursal
			} else if _, err := tx.Exec(ctx, `
				INSERT INTO cash_movements (session_id, tipo, monto, motivo, expense_id, creado_por)
				VALUES ($1, 'ingreso', $2::numeric, $3, $4, $5)`,
				turno, jsmath.Fijo2(devuelto), "Anulación del gasto: "+descripcion, id, ses.UserID); err != nil {
				return err
			}
		}

		if factura != nil {
			if _, err := tx.Exec(ctx, `UPDATE purchase_invoices SET aplica_a_id = NULL, updated_at = now() WHERE aplica_a_id = $1`, *factura); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				UPDATE purchase_invoices SET anulada_at = now(), motivo_anulacion = $2, anulada_por_user_id = $3, updated_at = now()
				WHERE id = $1 AND anulada_at IS NULL`, *factura, "Anulación del gasto: "+motivo, ses.UserID); err != nil {
				return err
			}
		}

		_, err = tx.Exec(ctx, `
			UPDATE expenses SET anulado_at = now(), motivo_anulacion = $2, anulado_por_user_id = $3 WHERE id = $1`, id, motivo, ses.UserID)
		return err
	})
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaAnular, "gasto", id,
		"Anuló el gasto de "+Monto(importe.F())+": "+descripcion+" ("+motivo+")", nil)
	ok := "Gasto anulado."
	switch {
	case sinCaja != "":
		ok += " La caja de " + sinCaja + " no tiene turno abierto: los " + Monto(devuelto) + " en efectivo no entraron a ningún turno. Cargalos como ingreso al abrir."
	case devuelto > 0.009:
		ok += " Los " + Monto(devuelto) + " en efectivo volvieron a la caja."
	}
	return ok, nil
}
