package compras

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
	"mjbj/internal/sqlc"
)

// AnularPago deshace un pago a proveedor cargado por error: el pago queda
// (con su motivo) pero deja de contar.
//
//   - La deuda con el proveedor vuelve con un movimiento de cuenta por el
//     total (lo que bajó el pago, retenciones incluidas).
//   - Las imputaciones a facturas se borran: las facturas vuelven a tener
//     saldo.
//   - Los certificados de retención quedan anulados (anulada_at) y las bases
//     del pago se borran, así el acumulado del mes, el CSV y el cierre no los
//     cuentan. El número del certificado no se reusa.
//   - Los cheques: uno de terceros que se endosó vuelve a la cartera; uno
//     propio se anula. Si alguno ya lo cobró el proveedor o lo rechazó el
//     banco, el pago no se anula: la plata ya se movió y hay que arreglarlo
//     a mano con el proveedor.
//
// La parte en efectivo no sale de ninguna caja (el pago no toca la caja del
// turno), así que no hay nada que devolver ahí.
func (s *Servicio) AnularPago(ctx context.Context, ses *auth.Sesion, id, motivo string) (string, error) {
	motivo = trimJS(motivo)
	if motivo == "" {
		return "", fallo("Poné el motivo: una anulación sin explicación no se puede revisar después.")
	}
	var proveedor, nombre string
	var total jsmath.Num
	var fecha time.Time
	var referencia *string
	var certificados []string
	var aCartera, anulados int
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// El mismo candado que el pago: el acumulado del mes que lee otro
		// pago simultáneo no puede ver la anulación a medias.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, SeriePagosAProveedores); err != nil {
			return err
		}
		var anuladoAt *time.Time
		err := tx.QueryRow(ctx, `
			SELECT p.supplier_id, s.nombre, p.total, p.fecha, p.referencia, p.anulado_at
			FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = $1 FOR UPDATE OF p`, id).
			Scan(&proveedor, &nombre, &total, &fecha, &referencia, &anuladoAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return fallo("Ese pago no existe.")
		}
		if err != nil {
			return err
		}
		if anuladoAt != nil {
			return fallo("Ese pago ya estaba anulado.")
		}

		// Los cheques primero: si uno ya no se puede deshacer, no se toca nada.
		filas, err := tx.Query(ctx, `
			SELECT c.id, c.sentido::text, c.estado::text, c.numero
			FROM supplier_payment_parts p JOIN cheques c ON c.id = p.cheque_id
			WHERE p.payment_id = $1 ORDER BY c.numero FOR UPDATE OF c`, id)
		if err != nil {
			return err
		}
		type cheque struct{ id, sentido, estado, numero string }
		var cheques []cheque
		for filas.Next() {
			var c cheque
			if err := filas.Scan(&c.id, &c.sentido, &c.estado, &c.numero); err != nil {
				filas.Close()
				return err
			}
			cheques = append(cheques, c)
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return err
		}
		for _, c := range cheques {
			switch c.estado {
			case "entregado":
			case "acreditado":
				return fallo("El cheque " + c.numero + " ya lo cobró el proveedor: el pago no se puede anular. Si hay que devolver plata, arreglalo con el proveedor y cargá un movimiento en su cuenta.")
			case "rechazado":
				return fallo("El cheque " + c.numero + " lo rechazó el banco: el pago no se puede anular. Cargá en la cuenta del proveedor la deuda que vuelve por el rechazo.")
			default:
				return fallo("El cheque " + c.numero + " está " + c.estado + ": el pago no se puede anular.")
			}
		}
		for _, c := range cheques {
			// Uno de terceros que endosamos vuelve a la cartera; uno propio
			// se anula (no salió nunca de verdad).
			estado := "anulado"
			if c.sentido == "recibido" {
				estado = "cartera"
				aCartera++
			} else {
				anulados++
			}
			if _, err := tx.Exec(ctx, `UPDATE cheques SET estado = $2::estado_cheque, updated_at = now() WHERE id = $1`, c.id, estado); err != nil {
				return err
			}
		}

		if _, err := tx.Exec(ctx, `DELETE FROM supplier_payment_allocations WHERE payment_id = $1`, id); err != nil {
			return err
		}
		filas, err = tx.Query(ctx, `
			UPDATE retenciones_practicadas SET anulada_at = now() WHERE payment_id = $1 AND anulada_at IS NULL RETURNING numero`, id)
		if err != nil {
			return err
		}
		certificados, err = pgx.CollectRows(filas, pgx.RowTo[string])
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM bases_de_retencion WHERE payment_id = $1`, id); err != nil {
			return err
		}

		// La deuda vuelve por lo mismo que la bajó el pago (el total, que
		// incluye lo retenido).
		detalle := "Anulación del pago del " + fecha.In(fiscal.Argentina).Format("02/01/2006") + ": " + motivo
		if _, err := tx.Exec(ctx, `
			INSERT INTO supplier_movements (supplier_id, tipo, monto, referencia, detalle, created_by_user_id)
			VALUES ($1, 'ajuste', $2::numeric, $3, $4, $5)`, proveedor, jsmath.Fijo2(float64(total)), referencia, detalle, ses.UserID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE supplier_payments SET anulado_at = now(), motivo_anulacion = $2, anulado_por_user_id = $3 WHERE id = $1`, id, motivo, ses.UserID)
		return err
	})
	if err != nil {
		return "", err
	}
	desc := "Anuló el pago de " + Monto(float64(total)) + " a " + nombre + " (" + motivo + ")"
	if len(certificados) > 0 {
		desc += "; certificados anulados: " + strings.Join(certificados, ", ")
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaAnular, "pago_proveedor", id, desc, struct {
		Motivo       string   `json:"motivo"`
		Certificados []string `json:"certificados"`
	}{motivo, certificados})
	ok := "Pago anulado: la deuda con " + nombre + " volvió a su cuenta."
	if n := len(certificados); n > 0 {
		ok += cuantos(n, " Se anuló el certificado de retención.", " Se anularon %d certificados de retención.")
	}
	if aCartera > 0 {
		ok += cuantos(aCartera, " El cheque endosado volvió a la cartera.", " %d cheques endosados volvieron a la cartera.")
	}
	if anulados > 0 {
		ok += cuantos(anulados, " El cheque propio quedó anulado.", " %d cheques propios quedaron anulados.")
	}
	return ok, nil
}

func cuantos(n int, uno, varios string) string {
	if n == 1 {
		return uno
	}
	return fmt.Sprintf(varios, n)
}
