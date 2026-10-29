// Package pedidos son los pedidos y los presupuestos del panel: los listados,
// las fichas, avanzar, cancelar y cobrar un pedido, decidir un presupuesto,
// pasarlo a pedido y cargarlo a mano, y el PDF del presupuesto. Era
// lib/dal/admin/ventas.ts, app/admin/ventas-actions.ts y
// app/api/presupuestos/[id]/pdf (tanda 5).
//
// Las reglas de la venta están en internal/ventas, la mercadería reservada
// en internal/reservas y los números en internal/numeracion (los mismos
// candados que el TS, que sigue numerando desde el mostrador y el carrito).
//
// Lo que cambia la fila de un pedido la bloquea primero (SELECT … FOR
// UPDATE): el TS leía el estado afuera de la transacción, y dos clics a la
// vez —o avanzar y cancelar a la vez— reservaban o liberaban dos veces.
package pedidos

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Servicio son los pedidos y presupuestos.
type Servicio struct {
	pool  *pgxpool.Pool
	q     *sqlc.Queries
	log   *slog.Logger
	ahora func() time.Time
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log, ahora: time.Now}
}

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// fallo es el { error } de una acción, para mostrar tal cual.
func fallo(m string) error { return plataforma.NuevoProblema(http.StatusUnprocessableEntity, m) }

// noEsta es un 404 con su mensaje.
func noEsta(m string) error { return plataforma.NuevoProblema(http.StatusNotFound, m) }
