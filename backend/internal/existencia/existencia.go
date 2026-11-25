// Package existencia contesta «¿existe esto?» para las páginas públicas que
// Next guarda en caché (lib/dal/existencia.ts): un pedido por número, un
// remito por su token de firma, un comprobante, etc. Solo lo pide el
// servidor de Next, con el secreto interno: abierto, dejaría recorrer los
// números de pedido para saber cuáles existen.
package existencia

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/existenciaapi"
	"mjbj/internal/plataforma"
)

type consulta struct {
	uuid bool
	sql  string
}

// Consultas son las de CONSULTAS del TS, una por cosa que se pregunta.
var Consultas = map[string]consulta{
	"pedido-por-numero": {false, `SELECT 1 FROM orders WHERE numero = $1`},
	"pago-demo":         {true, `SELECT 1 FROM payments WHERE id = $1 AND proveedor = 'demo'`},
	"remito-por-token":  {false, `SELECT 1 FROM deliveries WHERE firma_token = $1`},
	"comprobante":       {true, `SELECT 1 FROM invoices WHERE id = $1`},
	"remito":            {true, `SELECT 1 FROM deliveries WHERE id = $1`},
	"cliente":           {true, `SELECT 1 FROM customers WHERE id = $1`},
	"corte":             {true, `SELECT 1 FROM cutting_orders WHERE id = $1`},
	"pedido":            {true, `SELECT 1 FROM orders WHERE id = $1`},
}

// Existe es existe(): false también para una clave que no tiene la forma.
func Existe(ctx context.Context, pool *pgxpool.Pool, que, clave string) (bool, error) {
	c, ok := Consultas[que]
	if !ok || clave == "" || len(clave) > 200 || (c.uuid && !plataforma.UUIDValido(clave)) {
		return false, nil
	}
	var uno int
	err := pool.QueryRow(ctx, c.sql+" LIMIT 1", clave).Scan(&uno)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// API es la ruta de api/existencia.yaml.
type API struct {
	pool    *pgxpool.Pool
	interna plataforma.ConfigInterna
}

// NuevaAPI arma el handler.
func NuevaAPI(pool *pgxpool.Pool, interna plataforma.ConfigInterna) *API {
	return &API{pool: pool, interna: interna}
}

var _ existenciaapi.StrictServerInterface = (*API)(nil)

type respuesta struct{ existe bool }

func (o respuesta) VisitExisteResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	return json.NewEncoder(w).Encode(map[string]bool{"existe": o.existe})
}

func (a *API) Existe(ctx context.Context, r existenciaapi.ExisteRequestObject) (existenciaapi.ExisteResponseObject, error) {
	if !a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
		return nil, plataforma.NuevoProblema(http.StatusForbidden, "Esto solo lo pide el sitio.")
	}
	e, err := Existe(ctx, a.pool, string(r.Params.Que), r.Params.Clave)
	return respuesta{e}, err
}
