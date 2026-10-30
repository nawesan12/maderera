package precios

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"time"

	"mjbj/internal/api/preciosapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// LectorDePlanilla lee una planilla (CSV o XLSX) y la interpreta como filas
// de precios; error es lo que se le muestra a la persona.
type LectorDePlanilla func(datos []byte) (filas []FilaLeida, error string)

// API son las rutas de api/precios.yaml.
type API struct {
	s    *Servicio
	leer LectorDePlanilla
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, leer LectorDePlanilla) *API { return &API{s: s, leer: leer} }

var _ preciosapi.StrictServerInterface = (*API)(nil)

type respuesta struct {
	codigo int
	v      any
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	if o.codigo == http.StatusNoContent {
		w.WriteHeader(o.codigo)
		return nil
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta { return respuesta{http.StatusOK, v} }
func listo() respuesta   { return respuesta{codigo: http.StatusNoContent} }
func mensaje(m string) respuesta {
	return ok(map[string]string{"ok": m})
}

func (o respuesta) VisitGrillaDePreciosResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitHistorialDePreciosResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitListasDePreciosResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitFijarPorcentajeDeListaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitRubrosParaAjusteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitEditarPrecioResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitAjustarPreciosResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitPrevisualizarImportacionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitConfirmarImportacionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitDescuentosDePagoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitGuardarDescuentoDePagoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

// gestion es quien entra a /admin/precios.
func gestion(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/precios")...)
}

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (a *API) GrillaDePrecios(ctx context.Context, r preciosapi.GrillaDePreciosRequestObject) (preciosapi.GrillaDePreciosResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Listar(ctx, texto(r.Params.Busqueda), texto(r.Params.Categoria), time.Now())
	return ok(v), err
}

func (a *API) HistorialDePrecios(ctx context.Context, r preciosapi.HistorialDePreciosRequestObject) (preciosapi.HistorialDePreciosResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	limite := 40
	if r.Params.Limite != nil {
		limite = *r.Params.Limite
	}
	v, err := a.s.Historial(ctx, limite)
	return ok(v), err
}

func (a *API) ListasDePrecios(ctx context.Context, _ preciosapi.ListasDePreciosRequestObject) (preciosapi.ListasDePreciosResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...); err != nil {
		return nil, err
	}
	v, err := a.s.Listas(ctx)
	return ok(v), err
}

func (a *API) FijarPorcentajeDeLista(ctx context.Context, r preciosapi.FijarPorcentajeDeListaRequestObject) (preciosapi.FijarPorcentajeDeListaResponseObject, error) {
	ses, err := auth.Exigir(ctx, "admin")
	if err != nil {
		return nil, err
	}
	m, err := a.s.FijarPorcentaje(ctx, ses, r.Id.String(), r.Body.Porcentaje)
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

func (a *API) RubrosParaAjuste(ctx context.Context, _ preciosapi.RubrosParaAjusteRequestObject) (preciosapi.RubrosParaAjusteResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.q.RubrosParaAjuste(ctx)
	return ok(v), err
}

func (a *API) EditarPrecio(ctx context.Context, r preciosapi.EditarPrecioRequestObject) (preciosapi.EditarPrecioResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.Editar(ctx, ses, r.Body.VariantId, r.Body.PriceListId, r.Body.Precio)
}

func (a *API) AjustarPrecios(ctx context.Context, r preciosapi.AjustarPreciosRequestObject) (preciosapi.AjustarPreciosResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	m, err := a.s.Ajustar(ctx, ses, PedidoDeAjuste{b.Porcentaje, texto(b.Categoria), texto(b.Rubro), texto(b.ListaSlug),
		texto(b.Base), texto(b.Redondeo), texto(b.Motivo)})
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

// topeDePlanilla: lo que aceptaba el TS.
const topeDePlanilla = 5 << 20

func leerArchivo(r *multipart.Reader) ([]byte, error) {
	for {
		p, err := r.NextPart()
		if errors.Is(err, io.EOF) {
			return nil, nil
		}
		if err != nil {
			return nil, plataforma.NuevoProblema(http.StatusBadRequest, "El formulario llegó cortado.")
		}
		if p.FormName() != "archivo" {
			_, _ = io.Copy(io.Discard, p)
			continue
		}
		datos, err := io.ReadAll(io.LimitReader(p, topeDePlanilla+1))
		return datos, err
	}
}

func vistaConError(e string) respuesta {
	return ok(VistaPrevia{Filas: []FilaPrevia{}, Error: &e})
}

func (a *API) PrevisualizarImportacion(ctx context.Context, r preciosapi.PrevisualizarImportacionRequestObject) (preciosapi.PrevisualizarImportacionResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	datos, err := leerArchivo(r.Body)
	if err != nil {
		return nil, err
	}
	switch {
	case len(datos) == 0:
		return vistaConError("Elegí un archivo."), nil
	case len(datos) > topeDePlanilla:
		return vistaConError("El archivo supera los 5 MB."), nil
	}
	filas, e := a.leer(datos)
	if e != "" {
		return vistaConError(e), nil
	}
	if len(filas) == 0 {
		return vistaConError("La planilla está vacía."), nil
	}
	v, err := a.s.Comparar(ctx, filas)
	return ok(v), err
}

func (a *API) ConfirmarImportacion(ctx context.Context, r preciosapi.ConfirmarImportacionRequestObject) (preciosapi.ConfirmarImportacionResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	cambios := make([]CambioImportado, len(r.Body.Cambios))
	for i, c := range r.Body.Cambios {
		cambios[i] = CambioImportado{SKU: c.Sku, GeneralNuevo: c.GeneralNuevo, ProfesionalNuevo: c.ProfesionalNuevo}
	}
	m, err := a.s.Confirmar(ctx, ses, cambios)
	if err != nil {
		return nil, err
	}
	return mensaje(m), nil
}

func (a *API) GuardarDescuentoDePago(ctx context.Context, r preciosapi.GuardarDescuentoDePagoRequestObject) (preciosapi.GuardarDescuentoDePagoResponseObject, error) {
	ses, err := auth.Exigir(ctx, "admin")
	if err != nil {
		return nil, err
	}
	b := r.Body
	return listo(), a.s.GuardarDescuento(ctx, ses, FormDescuento{texto(b.Id), b.Medio, b.DesdeMonto, b.Porcentaje, b.Etiqueta, b.Activo})
}

func (a *API) DescuentosDePago(ctx context.Context, _ preciosapi.DescuentosDePagoRequestObject) (preciosapi.DescuentosDePagoResponseObject, error) {
	if _, err := auth.Exigir(ctx, "admin"); err != nil {
		return nil, err
	}
	filas, err := a.s.q.DescuentosDePago(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, len(filas))
	for i, f := range filas {
		out[i] = map[string]any{"id": f.ID, "medio": f.Medio, "desdeMonto": *texto2(&f.DesdeMonto), "porcentaje": *texto2(&f.Porcentaje),
			"etiqueta": f.Etiqueta, "activo": f.Activo, "createdAt": f.CreatedAt}
	}
	return ok(out), nil
}
