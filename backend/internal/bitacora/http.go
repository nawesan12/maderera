package bitacora

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/bitacoraapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// API son las rutas de api/bitacora.yaml.
type API struct {
	pool  *pgxpool.Pool
	ahora func() time.Time
}

// NuevaAPI arma los handlers.
func NuevaAPI(pool *pgxpool.Pool) *API { return &API{pool: pool, ahora: time.Now} }

var _ bitacoraapi.StrictServerInterface = (*API)(nil)

type respuesta struct{ v any }

func (o respuesta) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func (o respuesta) VisitListarBitacoraResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitOpcionesDeBitacoraResponse(w http.ResponseWriter) error { return o.escribir(w) }

func de[T any](p *T) T {
	var cero T
	if p == nil {
		return cero
	}
	return *p
}

func (a *API) ListarBitacora(ctx context.Context, r bitacoraapi.ListarBitacoraRequestObject) (bitacoraapi.ListarBitacoraResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/bitacora")...); err != nil {
		return nil, err
	}
	p := r.Params
	filas, total, err := Listar(ctx, a.pool, Filtro{Entidad: de(p.Entidad), Accion: de(p.Accion), UsuarioID: de(p.Usuario), Buscar: de(p.Buscar),
		Dias: de(p.Dias), Limite: de(p.Limite), Desplazamiento: de(p.Desplazamiento)}, a.ahora())
	if err != nil {
		return nil, err
	}
	return respuesta{map[string]any{"filas": filas, "total": total}}, nil
}

func (a *API) OpcionesDeBitacora(ctx context.Context, _ bitacoraapi.OpcionesDeBitacoraRequestObject) (bitacoraapi.OpcionesDeBitacoraResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/bitacora")...); err != nil {
		return nil, err
	}
	entidades, personas, err := Opciones(ctx, a.pool)
	if err != nil {
		return nil, err
	}
	return respuesta{map[string]any{"entidades": entidades, "personas": personas}}, nil
}
