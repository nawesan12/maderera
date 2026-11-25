package migracion

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"

	"mjbj/internal/api/migracionapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// API son los handlers de api/migracion.yaml.
type API struct{ s *Servicio }

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio) *API { return &API{s: s} }

var _ migracionapi.StrictServerInterface = (*API)(nil)

type respuesta struct {
	codigo int
	v      any
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta { return respuesta{http.StatusOK, v} }

func (o respuesta) VisitAnalizarArchivoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitHistorialDeMigracionesResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitIniciarCorridaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCerrarCorridaResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitEjecutarLoteResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitEntidadesDeMigracionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitEstadoDeMigracionResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitPrevisualizarMigracionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

// admin: la migración reescribe la cartera, el catálogo y los saldos de una
// vez; la corre quien entra a /admin/migracion.
func admin(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/migracion")...)
}

func definicionDe(clave migracionapi.ClaveEntidad) (Entidad, error) {
	if e, ok := DefinicionDe(string(clave)); ok {
		return e, nil
	}
	return Entidad{}, plataforma.NuevoProblema(http.StatusUnprocessableEntity, "Entidad de migración desconocida: "+string(clave))
}

// motivo es el mensaje de un error de la base para mostrar, sin la consulta.
func motivo(err error) string {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return pg.Message
	}
	return err.Error()
}

func (a *API) EntidadesDeMigracion(ctx context.Context, _ migracionapi.EntidadesDeMigracionRequestObject) (migracionapi.EntidadesDeMigracionResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	return ok(map[string]any{"lote": Lote, "entidades": Entidades}), nil
}

func (a *API) EstadoDeMigracion(ctx context.Context, _ migracionapi.EstadoDeMigracionRequestObject) (migracionapi.EstadoDeMigracionResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	e, err := a.s.EstadoDelSistema(ctx)
	return ok(e), err
}

func (a *API) HistorialDeMigraciones(ctx context.Context, r migracionapi.HistorialDeMigracionesRequestObject) (migracionapi.HistorialDeMigracionesResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	limite := 20
	if r.Params.Limite != nil {
		limite = *r.Params.Limite
	}
	h, err := a.s.Historial(ctx, limite)
	return ok(h), err
}

// leerFormulario saca la entidad y el archivo del multipart.
func leerFormulario(r *multipart.Reader) (entidad, nombre string, datos []byte, err error) {
	for {
		p, e := r.NextPart()
		if errors.Is(e, io.EOF) {
			return entidad, nombre, datos, nil
		}
		if e != nil {
			return "", "", nil, plataforma.NuevoProblema(http.StatusBadRequest, "El formulario llegó cortado.")
		}
		switch p.FormName() {
		case "entidad":
			b, _ := io.ReadAll(io.LimitReader(p, 100))
			entidad = string(b)
		case "archivo":
			nombre = p.FileName()
			// Un byte más que el tope, para saber que se pasó.
			if datos, e = io.ReadAll(io.LimitReader(p, TopeDeBytes+1)); e != nil {
				return "", "", nil, plataforma.NuevoProblema(http.StatusBadRequest, "El formulario llegó cortado.")
			}
		}
		_, _ = io.Copy(io.Discard, p)
	}
}

func (a *API) AnalizarArchivo(ctx context.Context, r migracionapi.AnalizarArchivoRequestObject) (migracionapi.AnalizarArchivoResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	entidad, nombre, datos, err := leerFormulario(r.Body)
	if err != nil {
		return nil, err
	}
	e, err := definicionDe(migracionapi.ClaveEntidad(entidad))
	if err != nil {
		return nil, err
	}
	return ok(Analizar(e, nombre, datos)), nil
}

func (a *API) PrevisualizarMigracion(ctx context.Context, r migracionapi.PrevisualizarMigracionRequestObject) (migracionapi.PrevisualizarMigracionResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	e, err := definicionDe(r.Body.Entidad)
	if err != nil {
		return nil, err
	}
	return ok(Previsualizar(e, Mapeo(r.Body.Mapeo), r.Body.Filas)), nil
}

func (a *API) IniciarCorrida(ctx context.Context, r migracionapi.IniciarCorridaRequestObject) (migracionapi.IniciarCorridaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	id, err := a.s.Iniciar(ctx, ses, PedidoDeCorrida{string(b.Entidad), b.Archivo, b.Codificacion, Mapeo(b.Mapeo), b.FilasTotales})
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"runId": id}), nil
}

func (a *API) EjecutarLote(ctx context.Context, r migracionapi.EjecutarLoteRequestObject) (migracionapi.EjecutarLoteResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	e, err := definicionDe(r.Body.Entidad)
	if err != nil {
		return nil, err
	}
	l, err := a.s.Lote(ctx, ses, r.Id.String(), e, Mapeo(r.Body.Mapeo), r.Body.Filas)
	return ok(l), err
}

func (a *API) CerrarCorrida(ctx context.Context, r migracionapi.CerrarCorridaRequestObject) (migracionapi.CerrarCorridaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	e, err := definicionDe(r.Body.Entidad)
	if err != nil {
		return nil, err
	}
	c, err := a.s.Cerrar(ctx, ses, r.Id.String(), e, Mapeo(r.Body.Mapeo), r.Body.Filas)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"controles": c}), nil
}
