package catalogo

import (
	"context"
	"encoding/json"
	"errors"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"mjbj/internal/limites"
	"net/http"
	"strings"

	"mjbj/internal/api/catalogoapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
)

// API son las rutas del catálogo (api/catalogo.yaml).
type API struct {
	s       *Servicio
	lim     *limites.Limitador
	interna plataforma.ConfigInterna
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, lim *limites.Limitador, interna plataforma.ConfigInterna) *API {
	return &API{s: s, lim: lim, interna: interna}
}

var _ catalogoapi.StrictServerInterface = (*API)(nil)

// ok es la respuesta 200 de todas las rutas: escribe la estructura del
// servicio tal cual. Implementa la interfaz de respuesta de cada operación;
// que la forma coincida con el contrato lo verifican los tests (validan cada
// respuesta contra api/catalogo.yaml).
type ok struct{ v any }

func (o ok) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func (o ok) VisitMiListaResponse(w http.ResponseWriter) error            { return o.escribir(w) }
func (o ok) VisitListaVigenteResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o ok) VisitCategoriasResponse(w http.ResponseWriter) error         { return o.escribir(w) }
func (o ok) VisitMarcasResponse(w http.ResponseWriter) error             { return o.escribir(w) }
func (o ok) VisitRubrosResponse(w http.ResponseWriter) error             { return o.escribir(w) }
func (o ok) VisitProductosResponse(w http.ResponseWriter) error          { return o.escribir(w) }
func (o ok) VisitPaginaDeProductosResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o ok) VisitProductoResponse(w http.ResponseWriter) error           { return o.escribir(w) }
func (o ok) VisitSugeridosResponse(w http.ResponseWriter) error          { return o.escribir(w) }
func (o ok) VisitPreciosPorVarianteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o ok) VisitComplementosResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o ok) VisitNumerosResponse(w http.ResponseWriter) error            { return o.escribir(w) }
func (o ok) VisitPortadaResponse(w http.ResponseWriter) error            { return o.escribir(w) }

// lista es la de quien pide, o la general si se pidió el precio público.
// **Con publico=true no se mira la cookie**: es lo que Next guarda en su
// caché compartida, y un precio de lista propia ahí se le serviría a
// cualquiera.
// lista es la que se aplica: la general con publico=true; la pedida con
// lista=<id>, que solo acepta un pedido de Next con el secreto interno (si no,
// cualquiera vería los precios de otra lista); si no, la de la sesión.
func (a *API) lista(ctx context.Context, publico *bool, pedida *openapi_types.UUID) (Lista, error) {
	if pedida != nil {
		if !a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
			return Lista{}, plataforma.NuevoProblema(http.StatusForbidden, "La lista solo la puede pedir el sitio.")
		}
		return a.s.Dada(ctx, pedida.String())
	}
	if publico != nil && *publico {
		return a.s.General(ctx)
	}
	return a.s.Vigente(ctx, auth.DeContexto(ctx))
}

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

type parametrosDeFiltro struct {
	Categoria, Subcategoria, Busqueda, Marca, Ids *string
	Stock, Orden                                  string
	SoloOfertas                                   *bool
}

func filtros(p parametrosDeFiltro) Filtros {
	f := Filtros{
		Categoria: texto(p.Categoria), Subcategoria: texto(p.Subcategoria), Busqueda: texto(p.Busqueda),
		Marca: texto(p.Marca), Stock: p.Stock, Orden: p.Orden, SoloOfertas: p.SoloOfertas != nil && *p.SoloOfertas,
	}
	if p.Ids != nil {
		f.IDs = []string{}
		for _, id := range strings.Split(*p.Ids, ",") {
			if id = strings.TrimSpace(id); id != "" {
				f.IDs = append(f.IDs, id)
			}
		}
	}
	return f
}

func (a *API) ListaVigente(ctx context.Context, _ catalogoapi.ListaVigenteRequestObject) (catalogoapi.ListaVigenteResponseObject, error) {
	ses := auth.DeContexto(ctx)
	l, err := a.s.Vigente(ctx, ses)
	if err != nil {
		return nil, err
	}
	vista, err := a.s.Vista(ctx, ses, l)
	if err != nil {
		return nil, err
	}
	return ok{map[string]any{"lista": l, "vista": vista}}, nil
}

func (a *API) Categorias(ctx context.Context, _ catalogoapi.CategoriasRequestObject) (catalogoapi.CategoriasResponseObject, error) {
	c, err := a.s.Categorias(ctx)
	return ok{c}, err
}

func (a *API) Marcas(ctx context.Context, r catalogoapi.MarcasRequestObject) (catalogoapi.MarcasResponseObject, error) {
	m, err := a.s.Marcas(ctx, texto(r.Params.Categoria))
	return ok{m}, err
}

func (a *API) Rubros(ctx context.Context, r catalogoapi.RubrosRequestObject) (catalogoapi.RubrosResponseObject, error) {
	m, err := a.s.Rubros(ctx, r.Params.Categoria)
	return ok{m}, err
}

func (a *API) Productos(ctx context.Context, r catalogoapi.ProductosRequestObject) (catalogoapi.ProductosResponseObject, error) {
	p := r.Params
	l, err := a.lista(ctx, p.Publico, p.Lista)
	if err != nil {
		return nil, err
	}
	f := filtros(parametrosDeFiltro{p.Categoria, p.Subcategoria, p.Busqueda, p.Marca, p.Ids,
		enumTexto(p.Stock), enumTexto(p.Orden), p.SoloOfertas})
	ps, err := a.s.Productos(ctx, f, l)
	return ok{ps}, err
}

func (a *API) PaginaDeProductos(ctx context.Context, r catalogoapi.PaginaDeProductosRequestObject) (catalogoapi.PaginaDeProductosResponseObject, error) {
	p := r.Params
	l, err := a.lista(ctx, p.Publico, p.Lista)
	if err != nil {
		return nil, err
	}
	f := filtros(parametrosDeFiltro{p.Categoria, p.Subcategoria, p.Busqueda, p.Marca, p.Ids,
		enumTexto(p.Stock), enumTexto(p.Orden), p.SoloOfertas})
	ps, err := a.s.Productos(ctx, f, l)
	if err != nil {
		return nil, err
	}
	pagina := 1
	if p.Pagina != nil {
		pagina = *p.Pagina
	}
	return ok{Recortar(ps, pagina)}, nil
}

func (a *API) Producto(ctx context.Context, r catalogoapi.ProductoRequestObject) (catalogoapi.ProductoResponseObject, error) {
	l, err := a.lista(ctx, r.Params.Publico, r.Params.Lista)
	if err != nil {
		return nil, err
	}
	p, err := a.s.Producto(ctx, r.Slug, l)
	if errors.Is(err, ErrNoExiste) {
		return nil, plataforma.NuevoProblema(http.StatusNotFound, "Ese producto no está en el catálogo.")
	}
	return ok{p}, err
}

func (a *API) Sugeridos(ctx context.Context, r catalogoapi.SugeridosRequestObject) (catalogoapi.SugeridosResponseObject, error) {
	limite := 4
	if r.Params.Limite != nil {
		limite = *r.Params.Limite
	}
	s, err := a.s.Sugeridos(ctx, r.Id.String(), r.Params.Categoria, r.Params.Excluir, limite)
	return ok{s}, err
}

func (a *API) PreciosPorVariante(ctx context.Context, r catalogoapi.PreciosPorVarianteRequestObject) (catalogoapi.PreciosPorVarianteResponseObject, error) {
	l, err := a.lista(ctx, nil, r.Params.Lista)
	if err != nil {
		return nil, err
	}
	m, err := a.s.PreciosPorVariante(ctx, l)
	return ok{m}, err
}

func (a *API) Complementos(ctx context.Context, r catalogoapi.ComplementosRequestObject) (catalogoapi.ComplementosResponseObject, error) {
	l, err := a.s.Vigente(ctx, auth.DeContexto(ctx))
	if err != nil {
		return nil, err
	}
	limite := 4
	if r.Body.Limite != nil {
		limite = *r.Body.Limite
	}
	c, err := a.s.Complementos(ctx, r.Body.Variantes, limite, l)
	return ok{c}, err
}

func (a *API) Numeros(ctx context.Context, _ catalogoapi.NumerosRequestObject) (catalogoapi.NumerosResponseObject, error) {
	n, err := a.s.NumerosDeLaEmpresa(ctx)
	return ok{n}, err
}

func (a *API) Portada(ctx context.Context, _ catalogoapi.PortadaRequestObject) (catalogoapi.PortadaResponseObject, error) {
	p, err := a.s.Portada(ctx)
	return ok{p}, err
}

// enumTexto pasa un enum opcional generado a texto.
func enumTexto[T ~string](v *T) string {
	if v == nil {
		return ""
	}
	return string(*v)
}

// MiLista son las filas del PDF de /mi-lista-de-precios. Exige sesión: sin
// esto la lista profesional quedaría a un link de cualquiera.
func (a *API) MiLista(ctx context.Context, _ catalogoapi.MiListaRequestObject) (catalogoapi.MiListaResponseObject, error) {
	ses, err := auth.ExigirSesion(ctx)
	if err != nil {
		return nil, err
	}
	if v := a.lim.Permitido(ctx, limites.ListaDePrecios, "usuario:"+ses.UserID); !v.Permitido {
		return nil, plataforma.NuevoProblema(http.StatusTooManyRequests, limites.AvisoDeEspera(v))
	}
	l, err := a.s.Vigente(ctx, ses)
	if err != nil {
		return nil, err
	}
	filas, err := a.s.FilasDeMiLista(ctx, l)
	if err != nil {
		return nil, err
	}
	titulo := "Lista de precios"
	if l.EsDiferenciada && l.Nombre != nil {
		titulo = "Lista " + *l.Nombre
	}
	return ok{map[string]any{"titulo": titulo, "filas": plataforma.SinNulos(filas)}}, nil
}
