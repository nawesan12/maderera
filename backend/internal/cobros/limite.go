package cobros

import (
	"context"
	"math"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/formato"
)

// LimiteEnLaTransaccion vuelve a mirar el límite de cuenta corriente adentro
// de la transacción que va a cargar la compra, con el candado del cliente
// tomado. La revisión de afuera (Credito, CreditoDeLaSesion) dice si se puede
// y por qué no; esta cierra la carrera: dos compras a la vez del mismo
// cliente pasaban las dos la revisión de afuera y entre las dos se pasaban
// del límite. Con el candado van de a una, y la segunda ve el saldo con la
// primera adentro.
//
// Devuelve "" si entra, o el motivo. Sin límite (cero) solo entra lo que
// cubra el saldo a favor, como en Credito.
func LimiteEnLaTransaccion(ctx context.Context, tx pgx.Tx, cliente string, monto float64) (string, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('cuenta:' || $1))`, cliente); err != nil {
		return "", err
	}
	var limite, saldo float64
	if err := tx.QueryRow(ctx, `SELECT c.limite_credito::float8,
		  (SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = c.id)
		FROM customers c WHERE c.id = $1`, cliente).Scan(&limite, &saldo); err != nil {
		return "", err
	}
	if limite <= 0 {
		aFavor := math.Max(-saldo, 0)
		if monto <= aFavor+0.005 {
			return "", nil
		}
		return "Tiene " + formato.Moneda(aFavor) + " a favor y no alcanza: el resto, con otro medio.", nil
	}
	if saldo+monto > limite+0.005 {
		return "Supera el límite de crédito. Disponible: $" + formato.Numero(math.Max(limite-saldo, 0)) + ".", nil
	}
	return "", nil
}
