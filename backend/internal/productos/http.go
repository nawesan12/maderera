package productos

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"io"
	"mime/multipart"
	"net/http"
	"time"

	"mjbj/internal/api/productosapi"
	"mjbj/internal/auth"
	"mjbj/internal/listado"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// API son las rutas de api/productos.yaml.
type API struct{ s *Servicio }

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio) *API { return &API{s: s} }

var _ productosapi.StrictServerInterface = (*API)(nil)

// respuesta escribe la estructura del servicio tal cual (los tests la
// validan contra el contrato).
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

func ok(v any) respuesta     { return respuesta{http.StatusOK, v} }
func creado(v any) respuesta { return respuesta{http.StatusCreated, v} }
func listo() respuesta       { return respuesta{codigo: http.StatusNoContent} }

func (o respuesta) VisitListarProductosResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCrearProductoResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitFichaDeProductoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitEditarProductoResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitActivarProductoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitSugeridosDelProductoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitAgregarSugeridoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitQuitarSugeridoResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitCandidatosParaSugerirResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitSubirImagenResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitBorrarImagenResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitHacerPrincipalResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCategoriasAdminResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitRubrosAdminResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitCrearRubroResponse(w http.ResponseWriter) error         { return o.escribir(w) }
func (o respuesta) VisitCrearCategoriaResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitRenombrarCategoriaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitRubrosPorCategoriaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitActivarRubroResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitEngancharRubroResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCandidatosDeBajaResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitGuardarMesesSinVenderResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitImputacionesUsadasResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAtributosUsadosResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitMarcasDeProductosResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitDatosDeEtiquetasResponse(w http.ResponseWriter) error   { return o.escribir(w) }

// gestion es quien entra a /admin/productos (admin y vendedor).
func gestion(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/productos")...)
}

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// errorDelFormulario pasa el primer problema de la ficha a problem+json.
func errorDelFormulario(err error) error {
	var e *ErrorDeCampo
	if errors.As(err, &e) {
		return e.Problema()
	}
	return err
}

// formDe pasa el cuerpo generado a FormProducto: los nombres de campo son los
// mismos, y así no se copian treinta punteros a mano.
func formDe(cuerpo any) (FormProducto, error) {
	var f FormProducto
	b, err := json.Marshal(cuerpo)
	if err == nil {
		err = json.Unmarshal(b, &f)
	}
	return f, err
}

func (a *API) ListarProductos(ctx context.Context, r productosapi.ListarProductosRequestObject) (productosapi.ListarProductosResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	f := listado.Filtros{Busqueda: texto(r.Params.Busqueda), Categoria: texto(r.Params.Categoria),
		Marca: texto(r.Params.Marca), Proveedor: texto(r.Params.Proveedor),
		Limite: entero(r.Params.Limite), Desde: entero(r.Params.Desplazamiento)}
	if r.Params.Estado != nil {
		f.Estado = string(*r.Params.Estado)
	}
	v, err := a.s.Listar(ctx, f)
	return ok(v), err
}

func entero(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

// MarcasDeProductos las lee cualquiera que entre a Stock, como las categorías:
// el filtro está en las tres pantallas.
func (a *API) MarcasDeProductos(ctx context.Context, _ productosapi.MarcasDeProductosRequestObject) (productosapi.MarcasDeProductosResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/stock")...); err != nil {
		return nil, err
	}
	v, err := a.s.Marcas(ctx)
	return ok(v), err
}

// DatosDeEtiquetas es de quien entra a Stock (el depósito pega las
// etiquetas), que incluye a quien entra a Productos.
func (a *API) DatosDeEtiquetas(ctx context.Context, r productosapi.DatosDeEtiquetasRequestObject) (productosapi.DatosDeEtiquetasResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/stock")...); err != nil {
		return nil, err
	}
	v, err := a.s.Etiquetas(ctx, texto(r.Params.Medidas), texto(r.Params.Productos), r.Params.Precio != nil && *r.Params.Precio)
	return ok(v), err
}

func (a *API) CrearProducto(ctx context.Context, r productosapi.CrearProductoRequestObject) (productosapi.CrearProductoResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	f, err := formDe(r.Body)
	if err != nil {
		return nil, err
	}
	f.ID = ""
	id, err := a.s.Guardar(ctx, ses, f)
	if err != nil {
		return nil, errorDelFormulario(err)
	}
	return creado(map[string]string{"id": id}), nil
}

func (a *API) FichaDeProducto(ctx context.Context, r productosapi.FichaDeProductoRequestObject) (productosapi.FichaDeProductoResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Ficha(ctx, r.Id.String())
	if errors.Is(err, ErrNoExiste) {
		return nil, plataforma.NuevoProblema(http.StatusNotFound, "Ese producto no existe.")
	}
	return ok(v), err
}

func (a *API) EditarProducto(ctx context.Context, r productosapi.EditarProductoRequestObject) (productosapi.EditarProductoResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	f, err := formDe(r.Body)
	if err != nil {
		return nil, err
	}
	f.ID = r.Id.String()
	id, err := a.s.Guardar(ctx, ses, f)
	if err != nil {
		return nil, errorDelFormulario(err)
	}
	return ok(map[string]string{"id": id}), nil
}

func (a *API) ActivarProducto(ctx context.Context, r productosapi.ActivarProductoRequestObject) (productosapi.ActivarProductoResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.Activar(ctx, ses, r.Id.String(), r.Body.Activo)
}

func (a *API) SugeridosDelProducto(ctx context.Context, r productosapi.SugeridosDelProductoRequestObject) (productosapi.SugeridosDelProductoResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Sugeridos(ctx, r.Id.String())
	return ok(v), err
}

func (a *API) AgregarSugerido(ctx context.Context, r productosapi.AgregarSugeridoRequestObject) (productosapi.AgregarSugeridoResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.AgregarSugerido(ctx, ses, r.Id.String(), r.Body.RelatedProductId, r.Body.Tipo)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": m}), nil
}

func (a *API) QuitarSugerido(ctx context.Context, r productosapi.QuitarSugeridoRequestObject) (productosapi.QuitarSugeridoResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.QuitarSugerido(ctx, ses, r.Id.String(), r.Relacion.String())
}

func (a *API) CandidatosParaSugerir(ctx context.Context, r productosapi.CandidatosParaSugerirRequestObject) (productosapi.CandidatosParaSugerirResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.q.CandidatosParaSugerir(ctx, r.Id.String())
	return ok(v), err
}

// La imagen llega en multipart, en el campo «archivo». Tope: 8 MB y algo.
const topeImagen = 9 << 20

func leerArchivo(r *multipart.Reader) ([]byte, string, error) {
	for {
		p, err := r.NextPart()
		if errors.Is(err, io.EOF) {
			return nil, "", nil
		}
		if err != nil {
			return nil, "", plataforma.NuevoProblema(http.StatusBadRequest, "El formulario llegó cortado.")
		}
		if p.FormName() != "archivo" {
			_, _ = io.Copy(io.Discard, p)
			continue
		}
		datos, err := io.ReadAll(io.LimitReader(p, topeImagen+1))
		if err != nil {
			return nil, "", err
		}
		if len(datos) > topeImagen {
			return nil, "", plataforma.Invalido(map[string]string{"archivo": "La imagen pesa más de 8 MB."})
		}
		return datos, p.Header.Get("Content-Type"), nil
	}
}

func (a *API) SubirImagen(ctx context.Context, r productosapi.SubirImagenRequestObject) (productosapi.SubirImagenResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	datos, tipo, err := leerArchivo(r.Body)
	if err != nil {
		return nil, err
	}
	id, url, err := a.s.SubirImagen(ctx, r.Id.String(), datos, tipo)
	if err != nil {
		return nil, err
	}
	return creado(map[string]string{"id": id, "url": url}), nil
}

func (a *API) BorrarImagen(ctx context.Context, r productosapi.BorrarImagenRequestObject) (productosapi.BorrarImagenResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	p, err := a.s.BorrarImagen(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"productId": p}), nil
}

func (a *API) HacerPrincipal(ctx context.Context, r productosapi.HacerPrincipalRequestObject) (productosapi.HacerPrincipalResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	p, err := a.s.HacerPrincipal(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"productId": p}), nil
}

func (a *API) CategoriasAdmin(ctx context.Context, _ productosapi.CategoriasAdminRequestObject) (productosapi.CategoriasAdminResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/stock")...); err != nil {
		return nil, err
	}
	v, err := a.s.q.CategoriasAdmin(ctx)
	return ok(v), err
}

func (a *API) RubrosAdmin(ctx context.Context, _ productosapi.RubrosAdminRequestObject) (productosapi.RubrosAdminResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.q.RubrosAdmin(ctx)
	return ok(v), err
}

func (a *API) CrearRubro(ctx context.Context, r productosapi.CrearRubroRequestObject) (productosapi.CrearRubroResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.CrearRubro(ctx, ses, r.Body.CategoryId, r.Body.Name)
}

func (a *API) CrearCategoria(ctx context.Context, r productosapi.CrearCategoriaRequestObject) (productosapi.CrearCategoriaResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.CrearCategoria(ctx, ses, r.Body.Name)
}

func (a *API) RenombrarCategoria(ctx context.Context, r productosapi.RenombrarCategoriaRequestObject) (productosapi.RenombrarCategoriaResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.RenombrarCategoria(ctx, ses, r.Id.String(), r.Body.Name)
}

func (a *API) RubrosPorCategoria(ctx context.Context, _ productosapi.RubrosPorCategoriaRequestObject) (productosapi.RubrosPorCategoriaResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.RubrosPorCategoria(ctx)
	return ok(v), err
}

func (a *API) ActivarRubro(ctx context.Context, r productosapi.ActivarRubroRequestObject) (productosapi.ActivarRubroResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.ActivarRubro(ctx, ses, r.Id.String(), r.Body.Activo)
}

func (a *API) EngancharRubro(ctx context.Context, r productosapi.EngancharRubroRequestObject) (productosapi.EngancharRubroResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	m, err := a.s.Enganchar(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": m}), nil
}

func (a *API) CandidatosDeBaja(ctx context.Context, _ productosapi.CandidatosDeBajaRequestObject) (productosapi.CandidatosDeBajaResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	meses, err := a.s.MesesSinVender(ctx)
	if err != nil {
		return nil, err
	}
	c, err := a.s.Candidatos(ctx, meses, time.Now())
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"meses": meses, "candidatos": c}), nil
}

func (a *API) GuardarMesesSinVender(ctx context.Context, r productosapi.GuardarMesesSinVenderRequestObject) (productosapi.GuardarMesesSinVenderResponseObject, error) {
	ses, err := auth.Exigir(ctx, "admin")
	if err != nil {
		return nil, err
	}
	m, err := a.s.GuardarMesesSinVender(ctx, ses, r.Body.Meses)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"ok": m}), nil
}

func (a *API) ImputacionesUsadas(ctx context.Context, _ productosapi.ImputacionesUsadasRequestObject) (productosapi.ImputacionesUsadasResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.q.ImputacionesUsadas(ctx)
	return ok(v), err
}

// AtributosUsados son los valores distintos de cada atributo de las medidas,
// el más usado primero: «Blanco» y «blanco» se juntan en el que más aparece.
func (a *API) AtributosUsados(ctx context.Context, _ productosapi.AtributosUsadosRequestObject) (productosapi.AtributosUsadosResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	out := map[string][]string{}
	for _, col := range []string{"material", "color", "terminacion", "calidad"} {
		filas, err := a.s.pool.Query(ctx, `
			SELECT (array_agg(valor ORDER BY n DESC))[1] FROM (
			  SELECT btrim(`+col+`) AS valor, count(*) AS n FROM product_variants
			  WHERE active AND btrim(coalesce(`+col+`, '')) <> '' GROUP BY 1
			) t GROUP BY lower(f_unaccent(valor)) ORDER BY sum(n) DESC LIMIT 200`)
		if err != nil {
			return nil, err
		}
		valores, err := pgx.CollectRows(filas, pgx.RowTo[string])
		if err != nil {
			return nil, err
		}
		out[col] = append([]string{}, valores...)
	}
	return ok(out), nil
}
