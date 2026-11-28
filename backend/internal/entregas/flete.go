package entregas

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/reglas"
)

// CondicionFleteSinCotizar es, sobre la fila `o`, un envío a una zona «a
// cotizar» (por el nombre que pone la tienda o por la lista de zonas) sin
// flete cargado ni «Sin cargo» elegido. Es la del chip «Flete sin cotizar»
// del reparto y de la ficha.
const CondicionFleteSinCotizar = `(o.tipo_entrega = 'envio' AND o.costo_envio = 0 AND NOT o.flete_sin_cargo
	AND (o.zona_envio ~* 'a cotizar'
	  OR EXISTS (SELECT 1 FROM shipping_zones z WHERE z.a_cotizar AND lower(z.nombre) = lower(trim(o.zona_envio)))))`

// NotaFleteSinCotizar va en el historial del pedido que sale igual.
const NotaFleteSinCotizar = "Flete sin cotizar"

// FleteSinCotizar revisa el flete de un envío que sale (M4-077: PED-1018 se
// despachó y se entregó con el chip en rojo y el flete no se cobró nunca).
// Con la regla flete_sin_cotizar en «frena», no sale; en «avisa» (lo de
// siempre) sale y devuelve true, para dejarlo en el historial.
func FleteSinCotizar(ctx context.Context, tx pgx.Tx, pedido string) (bool, error) {
	var sin bool
	if err := tx.QueryRow(ctx, `SELECT `+CondicionFleteSinCotizar+` FROM orders o WHERE o.id = $1`, pedido).Scan(&sin); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if sin && reglas.Es(ctx, tx, reglas.FleteSinCotizar, "frena") {
		return true, ErrorDeEntrega("El flete está sin cotizar: corregí el pedido con el flete o «Sin cargo».")
	}
	return sin, nil
}
