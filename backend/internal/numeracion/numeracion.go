// Package numeracion copia lib/dal/numeracion-ventas.ts: las series de
// pedidos, presupuestos, cortes, órdenes de compra y recibos. Cada una toma
// su candado (las mismas claves que el TS, para que los dos lados no se
// pisen mientras conviven) y numera con el máximo + 1, dentro de la
// transacción de quien llama.
package numeracion

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Las claves de pg_advisory_xact_lock, las mismas de CLAVES_DE_LOCK.
const (
	SeriePedidos         int64 = 1_000_000_000_001
	SeriePresupuestos    int64 = 1_000_000_000_002
	SerieCortes          int64 = 1_000_000_000_003
	SerieOrdenesDeCompra int64 = 1_000_000_000_004
	SerieRecibos         int64 = 1_000_000_000_005
)

func maximo(ctx context.Context, tx pgx.Tx, clave int64, consulta string, args ...any) (int64, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, clave); err != nil {
		return 0, err
	}
	var n int64
	err := tx.QueryRow(ctx, consulta, args...).Scan(&n)
	return n, err
}

// Pedido es PED-1000, PED-1001…
func Pedido(ctx context.Context, tx pgx.Tx) (string, error) {
	n, err := maximo(ctx, tx, SeriePedidos,
		`SELECT coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint), 999)::int FROM orders`)
	return fmt.Sprintf("PED-%d", n+1), err
}

// Presupuesto es P-2026-0001: la cuenta vuelve a empezar cada año.
func Presupuesto(ctx context.Context, tx pgx.Tx, ahora time.Time) (string, error) {
	anio := ahora.Year()
	n, err := maximo(ctx, tx, SeriePresupuestos,
		`SELECT coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint % 10000), 0)::int FROM quotes WHERE numero LIKE $1`,
		fmt.Sprintf("P-%d-%%", anio))
	return fmt.Sprintf("P-%d-%04d", anio, n+1), err
}

// OrdenDeCompra es OC-1, OC-2…
func OrdenDeCompra(ctx context.Context, tx pgx.Tx) (string, error) {
	n, err := maximo(ctx, tx, SerieOrdenesDeCompra,
		`SELECT coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint), 0)::int FROM purchase_orders`)
	return fmt.Sprintf("OC-%d", n+1), err
}

// Corte es CRT-1, CRT-2…
func Corte(ctx context.Context, tx pgx.Tx) (string, error) {
	n, err := maximo(ctx, tx, SerieCortes,
		`SELECT coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint), 0)::int FROM cutting_orders`)
	return fmt.Sprintf("CRT-%d", n+1), err
}

// Recibo es REC-0001, REC-0002…
func Recibo(ctx context.Context, tx pgx.Tx) (string, error) {
	n, err := maximo(ctx, tx, SerieRecibos,
		`SELECT coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint), 0)::int FROM receipts`)
	return fmt.Sprintf("REC-%04d", n+1), err
}
