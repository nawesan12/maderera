// Package compras es el circuito de compras del panel: proveedores y su
// cuenta corriente, órdenes de compra, recepciones de mercadería (que mueven
// el stock y el costo promedio), facturas de compra, pagos con retenciones y
// sus certificados, el libro IVA compras, los gastos y la lista de precios de
// cada proveedor. Era app/admin/{compras,proveedores,recepciones},
// lib/compras, lib/retenciones, lib/precios/lista-proveedor.ts y los DAL de
// lib/dal/admin/{proveedores,ordenes-compra,pagos-proveedor,recepciones,
// retenciones-sufridas,compras-fiscal,gastos}.ts.
//
// **Los signos van al revés que en clientes**: en la cuenta de un proveedor,
// positivo es lo que nosotros le debemos.
//
// Las fechas «del mes» son las de UTC, como las calculaba Next en
// producción (el contenedor no fija la zona).
package compras

import (
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Servicio es el circuito de compras.
type Servicio struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
	log  *slog.Logger
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log}
}

// fallo es un problema para mostrar tal cual (el { error } de las acciones).
func fallo(m string) error { return plataforma.NuevoProblema(http.StatusUnprocessableEntity, m) }

// noExiste es un 404 con su mensaje.
func noExiste(m string) error { return plataforma.NuevoProblema(http.StatusNotFound, m) }
