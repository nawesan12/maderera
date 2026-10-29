package numeracion

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// SerieRemitos es la clave del candado de los remitos: el literal de
// siguienteNumeroRemito en lib/entregas/index.ts (commit 3f7910e). Está por
// debajo de las demás series porque el TS la eligió antes que ellas; cae en
// el rango de hashtext pero ninguna venta la usa.
const SerieRemitos int64 = 918273645

// BloquearRemitos toma el candado de la serie de remitos. Las entregas lo
// toman **antes** de leer el saldo de acopio, para que dos retiros a la vez del
// mismo pedido no lean el mismo saldo (el TS lo tomaba recién al numerar).
func BloquearRemitos(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, SerieRemitos)
	return err
}

// Remito es REM-0001, REM-0002…
func Remito(ctx context.Context, tx pgx.Tx) (string, error) {
	n, err := maximo(ctx, tx, SerieRemitos,
		`SELECT coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint), 0)::int FROM deliveries`)
	return fmt.Sprintf("REM-%04d", n+1), err
}
