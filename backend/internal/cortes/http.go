package cortes

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"mjbj/internal/api/cortesapi"
	"mjbj/internal/auth"
	"mjbj/internal/catalogo"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// API son las rutas de api/cortes.yaml.
type API struct {
	s       *Servicio
	lim     *limites.Limitador
	interna plataforma.ConfigInterna
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, lim *limites.Limitador, interna plataforma.ConfigInterna) *API {
	return &API{s: s, lim: lim, interna: interna}
}

var _ cortesapi.StrictServerInterface = (*API)(nil)

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

func ok(v any) respuesta         { return respuesta{http.StatusOK, v} }
func okTexto(m string) respuesta { return ok(map[string]string{"ok": m}) }

var sinContenido = respuesta{codigo: http.StatusNoContent}

func (o respuesta) VisitAlternarUrgenteResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitAvanzarCorteResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitVolverCorteResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitAnularCorteResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitPasarCorteAPedidoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitBorrarPerfilResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitCalcularPlanoResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCambiarSierraResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCargarPasadasResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCortesDelPedidoResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitCotizarCorteResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitCrearCorteResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitFichaDeCorteResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitGuardarAcomodoResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitGuardarParametrosResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitGuardarSierraResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitGuardarConsultaDeCorteResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitConsultaDeCorteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitGuardarPerfilResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitGuardarTarifaResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitHojaDelCorteResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitListarCortesResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitListarPerfilesResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitListarTarifasResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitParametrosDeCalculoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitPlacasCortablesResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitTapacantosDelCatalogoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitResolverCarritoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitTarifasActivasResponse(w http.ResponseWriter) error  { return o.escribir(w) }

// gestion: quien entra a /admin/cortes (incluido el aserradero).
func gestion(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/cortes")...)
}

func soloAdmin(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, sqlc.StaffRoleAdmin)
}

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// --- la cola y la ficha ---

func (a *API) ListarCortes(ctx context.Context, r cortesapi.ListarCortesRequestObject) (cortesapi.ListarCortesResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Listar(ctx, texto(r.Params.Busqueda), texto(r.Params.Estado), texto(r.Params.Sucursal))
	return ok(v), err
}

// mostrador: quien atiende la cola desde el panel (todos los de
// /admin/cortes menos el aserradero). Urgencias, entregas, anular y cobrar
// son decisiones del mostrador, no del taller (mes simulado, H115).
//
// Las pasadas que se cobran, el acomodo y el disco también: cambian lo que
// se cobra, y el aserradero las cambiaba con el corte en la cola (mes
// simulado, ítem 7). El taller confirma las suyas al terminar (Avanzar).
func mostrador(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.DecidenEnLaCola...)
}

func (a *API) CrearCorte(ctx context.Context, r cortesapi.CrearCorteRequestObject) (cortesapi.CrearCorteResponseObject, error) {
	// Quien entra al alta: el mostrador, no el aserradero (lib/roles.ts).
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/admin/cortes/nuevo")...)
	if err != nil {
		return nil, err
	}
	b := r.Body
	f := FormCorte{
		CustomerID: texto(b.CustomerId), OrderID: texto(b.OrderId), ContactoNombre: b.ContactoNombre,
		// El teléfono y el día de retiro no se pasaban: la pantalla los
		// mandaba y el corte nacía sin a quién avisarle (mes simulado, H046).
		ContactoTelefono: texto(b.ContactoTelefono), RetiraEl: texto(b.RetiraEl),
		BranchID: texto(b.BranchId), VariantID: texto(b.VariantId), MaterialDescripcion: b.MaterialDescripcion,
		PlacaLargoMm: texto(b.PlacaLargoMm), PlacaAnchoMm: texto(b.PlacaAnchoMm), Mitad: texto(b.Mitad),
		Placas: texto(b.Placas), CantoDescripcion: texto(b.CantoDescripcion), Urgente: b.Urgente != nil && *b.Urgente,
		Notas: texto(b.Notas), AcomodoManual: texto(b.AcomodoManual), AnchoSierraMm: texto(b.AnchoSierraMm),
		Consulta: texto(b.Consulta), ConsultaGrupo: texto(b.ConsultaGrupo),
		Reemplaza: texto(b.Reemplaza), SinCargo: b.SinCargo != nil && *b.SinCargo, OtraPlaca: b.OtraPlaca != nil && *b.OtraPlaca,
	}
	if f.Reemplaza != "" || f.SinCargo {
		// Corregir uno que ya está en la cola y regalar una reposición son
		// del mostrador.
		if _, err := mostrador(ctx); err != nil {
			return nil, err
		}
	}
	for _, p := range b.Piezas {
		crudo, err := json.Marshal(p)
		if err != nil {
			return nil, err
		}
		f.Piezas = append(f.Piezas, crudo)
	}
	numero, id, err := a.s.Alta(ctx, ses, f)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"numero": numero, "id": id}), nil
}

func (a *API) FichaDeCorte(ctx context.Context, r cortesapi.FichaDeCorteRequestObject) (cortesapi.FichaDeCorteResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	f, err := a.s.Ficha(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, noEncontrado
	}
	if esDelTaller(ses) {
		f.SinPlataParaElTaller()
	}
	return ok(f), nil
}

func (a *API) HojaDelCorte(ctx context.Context, r cortesapi.HojaDelCorteRequestObject) (cortesapi.HojaDelCorteResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	c, err := a.s.Obtener(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, noEncontrado
	}
	motor, err := PlanoDelCorteConTope(c)
	if err != nil {
		return nil, err
	}
	// La hoja, del plano del motor; el plano que se muestra, contado como
	// ella (ConLaHoja sale de esos mismos árboles).
	hoja, err := ArmarHojaDeCorte(motor)
	plano := ConLaHojaSi(c.MotorPlano, motor)
	var ng ErrNoGuillotina
	if errors.As(err, &ng) {
		return nil, plataforma.NuevoProblema(http.StatusConflict, ng.Error())
	}
	if err != nil {
		return nil, err
	}
	// Lo que sobra es de quien dice la ficha: del pedido que vende todas las
	// placas de sus cortes, el retal es del cliente aunque la placa no pase
	// la mitad (mes simulado, H184). La hoja del operario decía «los retales
	// quedan en la maderera» y la ficha «del cliente».
	delCliente, err := a.s.RetalesDelClienteDe(ctx, c, plano)
	if err != nil {
		return nil, err
	}
	if delCliente {
		plano = TodasDelCliente(plano)
		for _, p := range hoja.Patrones {
			p.SeVendeEntera = true
		}
	}
	sup := make([]float64, len(plano.Placas))
	for i, p := range plano.Placas {
		sup[i] = SuperficieDeSierra(p.Cortes, plano.AnchoSierra)
	}
	return ok(map[string]any{"corte": c, "plano": plano, "hoja": hoja, "metrosCanto": MetrosDeTapacanto(piezasConCanto(c)), "superficies": sup}), nil
}

func (a *API) AvanzarCorte(ctx context.Context, r cortesapi.AvanzarCorteRequestObject) (cortesapi.AvanzarCorteResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	desde := ""
	if r.Params.Desde != nil {
		desde = *r.Params.Desde
	}
	sinCobrar := r.Params.SinCobrar != nil && *r.Params.SinCobrar
	var pasadas []float64
	if r.Params.Pasadas != nil {
		pasadas = append(pasadas, float64(*r.Params.Pasadas))
	}
	m, err := a.s.Avanzar(ctx, ses, r.Id.String(), desde, sinCobrar, pasadas...)
	if err != nil {
		return nil, err
	}
	return okTexto(m), nil
}

func (a *API) VolverCorte(ctx context.Context, r cortesapi.VolverCorteRequestObject) (cortesapi.VolverCorteResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.Volver(ctx, ses, r.Id.String(), texto(r.Params.Desde))
	if err != nil {
		return nil, err
	}
	return okTexto(m), nil
}

func (a *API) AnularCorte(ctx context.Context, r cortesapi.AnularCorteRequestObject) (cortesapi.AnularCorteResponseObject, error) {
	ses, err := mostrador(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.Anular(ctx, ses, r.Id.String(), r.Body.Motivo)
	if err != nil {
		return nil, err
	}
	return okTexto(m), nil
}

// PasarCorteAPedido: quien vende (admin y vendedor), como pasar un
// presupuesto a pedido.
func (a *API) PasarCorteAPedido(ctx context.Context, r cortesapi.PasarCorteAPedidoRequestObject) (cortesapi.PasarCorteAPedidoResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.ManejanPlata...)
	if err != nil {
		return nil, err
	}
	numero, id, err := a.s.PasarAPedido(ctx, ses, r.Id.String())
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"numero": numero, "id": id}), nil
}

// SumarCorteAlPedido suma lo que el corte cobra fuera de su pedido (H184),
// con la confirmación de la ficha. Lo hace quien maneja plata, como pasar un
// corte suelto a pedido.
func (a *API) SumarCorteAlPedido(ctx context.Context, r cortesapi.SumarCorteAlPedidoRequestObject) (cortesapi.SumarCorteAlPedidoResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.ManejanPlata...)
	if err != nil {
		return nil, err
	}
	numero, aparte, err := a.s.SumarAlPedido(ctx, ses, r.Id.String())
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"numero": numero, "aparte": aparte}), nil
}

func (o respuesta) VisitSumarCorteAlPedidoResponse(w http.ResponseWriter) error { return o.escribir(w) }

// RemitoDeLaReposicion es el remito sin cargo de una reposición (H321). Lo
// hace el mostrador, que es quien la entrega.
func (a *API) RemitoDeLaReposicion(ctx context.Context, r cortesapi.RemitoDeLaReposicionRequestObject) (cortesapi.RemitoDeLaReposicionResponseObject, error) {
	ses, err := mostrador(ctx)
	if err != nil {
		return nil, err
	}
	e, err := a.s.RemitoDeLaReposicion(ctx, ses, r.Id.String())
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"id": e.ID, "numero": e.Numero, "firmaToken": e.FirmaToken}), nil
}

func (o respuesta) VisitRemitoDeLaReposicionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

func (a *API) AlternarUrgente(ctx context.Context, r cortesapi.AlternarUrgenteRequestObject) (cortesapi.AlternarUrgenteResponseObject, error) {
	if _, err := mostrador(ctx); err != nil {
		return nil, err
	}
	m, err := a.s.AlternarUrgente(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	return okTexto(m), nil
}

func (a *API) CargarPasadas(ctx context.Context, r cortesapi.CargarPasadasRequestObject) (cortesapi.CargarPasadasResponseObject, error) {
	ses, err := mostrador(ctx)
	if err != nil {
		return nil, err
	}
	n := 0.0
	if r.Body.Pasadas != nil {
		n = *r.Body.Pasadas
	}
	if err := a.s.CargarPasadas(ctx, ses, r.Id.String(), n); err != nil {
		return nil, err
	}
	return sinContenido, nil
}

func aFijadas(xs []cortesapi.PiezaFijada) []PiezaFijada {
	out := make([]PiezaFijada, len(xs))
	for i, f := range xs {
		out[i] = PiezaFijada{Indice: f.Indice, Unidad: f.Unidad, Placa: f.Placa, Girada: f.Girada}
	}
	return out
}

func (a *API) GuardarAcomodo(ctx context.Context, r cortesapi.GuardarAcomodoRequestObject) (cortesapi.GuardarAcomodoResponseObject, error) {
	ses, err := mostrador(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.GuardarAcomodo(ctx, ses, r.Id.String(), aFijadas(r.Body.Fijadas))
	if err != nil {
		return nil, err
	}
	return okTexto(m), nil
}

func (a *API) CambiarSierra(ctx context.Context, r cortesapi.CambiarSierraRequestObject) (cortesapi.CambiarSierraResponseObject, error) {
	ses, err := mostrador(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.CambiarSierra(ctx, ses, r.Id.String(), r.Body.Valor)
	if err != nil {
		return nil, err
	}
	return okTexto(m), nil
}

func (a *API) CortesDelPedido(ctx context.Context, r cortesapi.CortesDelPedidoRequestObject) (cortesapi.CortesDelPedidoResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.DelPedido(ctx, r.Id.String())
	return ok(v), err
}

// --- formatos, tarifas y parámetros ---

func (a *API) ListarPerfiles(ctx context.Context, _ cortesapi.ListarPerfilesRequestObject) (cortesapi.ListarPerfilesResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Perfiles(ctx)
	return ok(v), err
}

func (a *API) GuardarPerfil(ctx context.Context, r cortesapi.GuardarPerfilRequestObject) (cortesapi.GuardarPerfilResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	f := FormPerfil{
		ID: texto(b.Id), Nombre: b.Nombre, Programa: texto(b.Programa), Separador: b.Separador,
		ConEncabezado: b.ConEncabezado, Unidad: b.Unidad, Decimal: b.Decimal, ValorSi: texto(b.ValorSi),
		ValorNo: texto(b.ValorNo), FinDeLinea: b.FinDeLinea, PorDefecto: b.PorDefecto,
	}
	for _, c := range b.Columnas {
		f.Columnas = append(f.Columnas, ColumnaConfigurada{c.Clave, c.Encabezado})
	}
	if err := a.s.GuardarPerfil(ctx, ses, f); err != nil {
		return nil, err
	}
	return sinContenido, nil
}

func (a *API) BorrarPerfil(ctx context.Context, r cortesapi.BorrarPerfilRequestObject) (cortesapi.BorrarPerfilResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	if err := a.s.BorrarPerfil(ctx, ses, r.Perfil); err != nil {
		return nil, err
	}
	return sinContenido, nil
}

func (a *API) ListarTarifas(ctx context.Context, _ cortesapi.ListarTarifasRequestObject) (cortesapi.ListarTarifasResponseObject, error) {
	if _, err := soloAdmin(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.TodasLasTarifas(ctx)
	return ok(v), err
}

func (a *API) TarifasActivas(ctx context.Context, _ cortesapi.TarifasActivasRequestObject) (cortesapi.TarifasActivasResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/mostrador")...); err != nil {
		return nil, err
	}
	v, err := a.s.TarifasActivas(ctx)
	return ok(v), err
}

func (a *API) GuardarTarifa(ctx context.Context, r cortesapi.GuardarTarifaRequestObject) (cortesapi.GuardarTarifaResponseObject, error) {
	ses, err := soloAdmin(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	f := FormTarifa{ID: texto(b.Id), Material: b.Material, PriceListID: texto(b.PriceListId),
		PrecioPorPasada: b.PrecioPorPasada, PrecioPorMetroCanto: texto(b.PrecioPorMetroCanto), Activo: b.Activo}
	if err := a.s.GuardarTarifa(ctx, ses, f); err != nil {
		return nil, err
	}
	return sinContenido, nil
}

func (a *API) GuardarSierra(ctx context.Context, r cortesapi.GuardarSierraRequestObject) (cortesapi.GuardarSierraResponseObject, error) {
	ses, err := soloAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if err := a.s.GuardarSierra(ctx, ses, r.Body.AnchoSierraMm); err != nil {
		return nil, err
	}
	return sinContenido, nil
}

func (a *API) GuardarParametros(ctx context.Context, r cortesapi.GuardarParametrosRequestObject) (cortesapi.GuardarParametrosResponseObject, error) {
	ses, err := soloAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if err := a.s.GuardarParametros(ctx, ses, *r.Body); err != nil {
		return nil, err
	}
	return sinContenido, nil
}

func (a *API) ParametrosDeCalculo(ctx context.Context, _ cortesapi.ParametrosDeCalculoRequestObject) (cortesapi.ParametrosDeCalculoResponseObject, error) {
	v, err := a.s.Parametros(ctx)
	return ok(v), err
}

// lista es la de quien pide; la general con publico=true; la pedida con
// lista=<id> solo desde Next con el secreto interno.
func (a *API) lista(ctx context.Context, publico *bool, pedida *openapi_types.UUID) (catalogo.Lista, error) {
	if pedida != nil {
		if !a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
			return catalogo.Lista{}, plataforma.NuevoProblema(http.StatusForbidden, "La lista solo la puede pedir el sitio.")
		}
		return a.s.cat.Dada(ctx, pedida.String())
	}
	if publico != nil && *publico {
		return a.s.cat.General(ctx)
	}
	return a.s.cat.Vigente(ctx, auth.DeContexto(ctx))
}

// --- el armador de cortes ---

func (a *API) PlacasCortables(ctx context.Context, r cortesapi.PlacasCortablesRequestObject) (cortesapi.PlacasCortablesResponseObject, error) {
	l, err := a.lista(ctx, r.Params.Publico, r.Params.Lista)
	if err != nil {
		return nil, err
	}
	v, err := a.s.Placas(ctx, l)
	if err != nil {
		return nil, err
	}
	// Con la tienda apagada el armador dibuja el plano y cuenta placas,
	// pasadas y metros de canto, pero no cobra: los precios salen en cero y
	// la pantalla no muestra el total (ver catalogo/tienda.go).
	if t, err := a.s.cat.Tienda(ctx); err != nil {
		return nil, err
	} else if !t.Activa {
		for i := range v {
			v[i].Precio, v[i].PrecioPorPasada, v[i].PrecioPorMetroCanto = 0, 0, 0
		}
	}
	return ok(v), nil
}

// TapacantosDelCatalogo es la lista del desplegable del armador. Sin precios,
// así que no depende de la lista de quien mira ni de la tienda.
func (a *API) TapacantosDelCatalogo(ctx context.Context, _ cortesapi.TapacantosDelCatalogoRequestObject) (cortesapi.TapacantosDelCatalogoResponseObject, error) {
	v, err := a.s.Tapacantos(ctx)
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

// TopeDeUnidades es cuántas piezas acomoda el plano de un corte: más allá
// es un despiece que no se tipea en una pantalla, y el motor crece
// cuadrático (10 000 piezas son 5 s de CPU). Lo respetan el alta, el
// mostrador y el plano de un corte guardado.
const TopeDeUnidades = 5_000

// CalcularPlano es el plano mientras alguien tipea. La ruta es anónima (la
// usa el /corte del sitio) y es CPU pura: sin sesión del personal, con freno
// por IP y el tope del sitio (MaximoDePiezas); el panel y el mostrador, con
// el tope de un corte.
func (a *API) CalcularPlano(ctx context.Context, r cortesapi.CalcularPlanoRequestObject) (cortesapi.CalcularPlanoResponseObject, error) {
	tope := TopeDeUnidades
	if !auth.DeContexto(ctx).EsStaff() {
		ip := plataforma.IPDelCliente(plataforma.PedidoDe(ctx))
		if v := a.lim.Permitido(ctx, limites.Plano, "ip:"+ip); !v.Permitido {
			return nil, plataforma.NuevoProblema(http.StatusTooManyRequests, limites.AvisoDeEspera(v))
		}
		tope = MaximoDePiezas
	}
	b := r.Body
	piezas := make([]PiezaAcortar, len(b.Piezas))
	total := 0.0
	for i, p := range b.Piezas {
		piezas[i] = PiezaAcortar{LargoMm: p.LargoMm, AnchoMm: p.AnchoMm, Cantidad: p.Cantidad, RespetaVeta: p.RespetaVeta, Etiqueta: p.Etiqueta}
		if p.CantoLargo != nil {
			piezas[i].CantoLargo = *p.CantoLargo
		}
		if p.CantoAncho != nil {
			piezas[i].CantoAncho = *p.CantoAncho
		}
		total += p.Cantidad
	}
	if total > float64(tope) {
		return nil, error422(fmt.Sprintf("Son demasiadas piezas para dibujar el plano acá (el máximo es %d).", tope))
	}
	d := DatosDelPlano{Piezas: piezas, PlacaLargo: b.PlacaLargo, PlacaAncho: b.PlacaAncho, AnchoSierra: b.AnchoSierra, Busqueda: b.Busqueda}
	if b.Fijadas != nil {
		d.Fijadas = aFijadas(*b.Fijadas)
	}
	motor := CalcularPlano(d)
	plano := ConLaHoja(motor)
	// Lo que se cobra puede no ser lo que se dibuja: con piezas acomodadas a
	// mano se cobra el plano libre, salvo que el manual gaste más placas
	// (ACobrar). La pantalla lo dice antes de cobrar.
	cobro := Cobro{Placas: plano.PlacasEnteras, Pasadas: plano.PasadasCobrables, Parciales: len(plano.Placas) - plano.PlacasEnteras}
	if len(d.Fijadas) > 0 {
		cobro = ACobrar(d)
	}
	if MaterialSeCobra(ctx, a.s.pool) {
		cobro = cobro.ConMaterial()
		plano = TodasDelCliente(plano)
	}
	out := map[string]any{"plano": plano, "placasACobrar": cobro.Placas, "pasadasACobrar": cobro.Pasadas, "placasParciales": cobro.Parciales}
	// La hoja de la máquina, para el PDF que baja el mostrador antes de cobrar
	// (18/11/2026). Solo el staff: al público no le sirve y cuesta armarla. Un
	// plano que no se puede cortar en guillotina sale sin hoja, como en la
	// ficha del corte.
	// Con un tope: cada placa es una hoja, y el PDF del mostrador no arma más
	// de 60 (ver app/api/mostrador/plano).
	if b.Hoja != nil && *b.Hoja && auth.DeContexto(ctx).EsStaff() && len(plano.Placas) > 0 && len(plano.Placas) <= 60 {
		if hoja, err := ArmarHojaDeCorte(motor); err == nil {
			sup := make([]float64, len(plano.Placas))
			for i, p := range plano.Placas {
				sup[i] = SuperficieDeSierra(p.Cortes, plano.AnchoSierra)
			}
			out["hoja"] = hoja
			out["superficies"] = sup
		}
	}
	if pr := b.Presupuesto; pr != nil {
		var tarifa *TarifaDeCorte
		if pr.Tarifa != nil {
			tarifa = &TarifaDeCorte{pr.Tarifa.Material, pr.Tarifa.PriceListId, pr.Tarifa.PrecioPorPasada, pr.Tarifa.PrecioPorMetroCanto}
		}
		pres := make([]PiezaPresupuestada, len(piezas))
		for i, p := range piezas {
			pres[i] = PiezaPresupuestada{p.LargoMm, p.AnchoMm, p.Cantidad, p.CantoLargo, p.CantoAncho}
		}
		out["cuenta"] = Presupuestar(plano, tarifa, pr.PrecioPorPlaca, pres, pr.Fraccion)
	}
	return ok(out), nil
}

func (a *API) CotizarCorte(ctx context.Context, r cortesapi.CotizarCorteRequestObject) (cortesapi.CotizarCorteResponseObject, error) {
	// El freno, antes de acomodar: es el trabajo más caro que se puede pedir
	// desde afuera sin cuenta.
	ip := plataforma.IPDelCliente(plataforma.PedidoDe(ctx))
	if v := a.lim.Permitido(ctx, limites.Corte, "ip:"+ip); !v.Permitido {
		return nil, plataforma.NuevoProblema(http.StatusTooManyRequests, limites.AvisoDeEspera(v))
	}
	if err := a.s.cat.ExigirTienda(ctx); err != nil {
		return nil, err
	}
	l, err := a.lista(ctx, nil, nil)
	if err != nil {
		return nil, err
	}
	v, err := a.s.CotizarParaElCarrito(ctx, l, *r.Body)
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

func (a *API) GuardarConsultaDeCorte(ctx context.Context, r cortesapi.GuardarConsultaDeCorteRequestObject) (cortesapi.GuardarConsultaDeCorteResponseObject, error) {
	ip := plataforma.IPDelCliente(plataforma.PedidoDe(ctx))
	if v := a.lim.Permitido(ctx, limites.Corte, "ip:"+ip); !v.Permitido {
		return nil, plataforma.NuevoProblema(http.StatusTooManyRequests, limites.AvisoDeEspera(v))
	}
	token, err := a.s.GuardarConsulta(ctx, *r.Body, ip)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"token": token}), nil
}

func (a *API) ConsultaDeCorte(ctx context.Context, r cortesapi.ConsultaDeCorteRequestObject) (cortesapi.ConsultaDeCorteResponseObject, error) {
	c, err := a.s.Consulta(ctx, r.Token)
	if errors.Is(err, ErrConsultaNoExiste) {
		return nil, plataforma.NuevoProblema(http.StatusNotFound, "Ese corte no está.")
	}
	if err != nil {
		return nil, err
	}
	return ok(c), nil
}

// --- las rutas del agente del taller (las de siempre, fuera del contrato) ---

// TokenDelAgente es CORTES_AGENTE_TOKEN: sin él (o con menos de 16
// caracteres) la integración está apagada y las rutas dan 404.
func TokenDelAgente() string {
	t := strings.TrimSpace(os.Getenv("CORTES_AGENTE_TOKEN"))
	if len(t) < 16 {
		return ""
	}
	return t
}

func agenteAutorizado(r *http.Request) bool {
	esperado := TokenDelAgente()
	if esperado == "" {
		return false
	}
	cabecera := r.Header.Get("Authorization")
	recibido := ""
	if strings.HasPrefix(cabecera, "Bearer ") {
		recibido = strings.TrimSpace(cabecera[7:])
	}
	if len(recibido) != len(esperado) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(recibido), []byte(esperado)) == 1
}

func textoPlano(w http.ResponseWriter, codigo int, m string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(codigo)
	_, _ = w.Write([]byte(m))
}

// esStaff: el panel con su sesión (requireStaff).
func esStaff(w http.ResponseWriter, r *http.Request) bool {
	if _, err := auth.ExigirStaff(r.Context()); err != nil {
		var p *plataforma.Problema
		if errors.As(err, &p) {
			plataforma.EscribirProblema(w, p)
		} else {
			textoPlano(w, http.StatusUnauthorized, "No autorizado")
		}
		return false
	}
	return true
}

// Registrar suma al mux las rutas del agente del taller, con las mismas
// direcciones que tenía Next: el agente no se toca.
func (a *API) Registrar(m *http.ServeMux) {
	m.HandleFunc("GET /api/cortes/pendientes", a.pendientes)
	m.HandleFunc("GET /api/cortes/{id}/lista", a.lista_)
	m.HandleFunc("GET /api/cortes/{id}/ptx", a.ptx)
}

// pendientes son los cortes en cola que el agente tiene que bajar. Solo
// lectura: el agente lleva su registro. «actualizado» es updated_at: el
// agente vuelve a bajar el archivo cuando cambia, y con created_at un corte
// corregido después de bajado nunca se volvía a escribir.
//
// ?sucursal= (el id o el nombre, MJBJ_SUCURSAL del agente) deja solo los de
// ese taller: el agente de la PC del aserradero bajaba también los de Casa
// Central a la carpeta de su seccionadora (mes simulado, M3S1-015).
// «enLaMaquina» son los que el operario ya empezó: su archivo se queda en la
// carpeta; el de cualquier otro que salió de la cola (terminado, anulado o
// reemplazado) el agente lo saca (M2S1-014).
func (a *API) pendientes(w http.ResponseWriter, r *http.Request) {
	if TokenDelAgente() == "" {
		textoPlano(w, http.StatusNotFound, "No encontrado")
		return
	}
	if !agenteAutorizado(r) {
		textoPlano(w, http.StatusUnauthorized, "No autorizado")
		return
	}
	sucursal, err := a.s.sucursalDelAgente(r.Context(), r.URL.Query().Get("sucursal"))
	if err != nil {
		if errors.Is(err, errSucursalDesconocida) {
			textoPlano(w, http.StatusBadRequest, "No hay una sucursal con ese nombre: revisar MJBJ_SUCURSAL.")
			return
		}
		a.s.log.Error("cortes pendientes", "error", err)
		textoPlano(w, http.StatusInternalServerError, "Error")
		return
	}
	cortes, err := a.s.Listar(r.Context(), "", "en-cola", sucursal)
	var enMaquina []CorteListado
	if err == nil {
		enMaquina, err = a.s.Listar(r.Context(), "", "en-proceso", sucursal)
	}
	if err != nil {
		a.s.log.Error("cortes pendientes", "error", err)
		textoPlano(w, http.StatusInternalServerError, "Error")
		return
	}
	type pendiente struct {
		ID          string  `json:"id"`
		Numero      string  `json:"numero"`
		Cliente     string  `json:"cliente"`
		Material    string  `json:"material"`
		Piezas      int32   `json:"piezas"`
		Urgente     bool    `json:"urgente"`
		Sucursal    *string `json:"sucursal"`
		Actualizado string  `json:"actualizado"`
	}
	type enLaMaquina struct {
		ID     string `json:"id"`
		Numero string `json:"numero"`
	}
	out := []pendiente{}
	for _, c := range cortes {
		if c.Piezas > 0 {
			out = append(out, pendiente{c.ID, c.Numero, c.Cliente, c.Material, c.Piezas, c.Urgente, c.Sucursal,
				c.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z")})
		}
	}
	maquina := []enLaMaquina{}
	for _, c := range enMaquina {
		maquina = append(maquina, enLaMaquina{c.ID, c.Numero})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"cortes": out, "enLaMaquina": maquina})
}

var errSucursalDesconocida = errors.New("sucursal desconocida")

// sucursalDelAgente es el id de la sucursal que pidió el agente: un uuid o
// el nombre («Aserradero», sin importar mayúsculas ni acentos). Vacío: todas.
func (s *Servicio) sucursalDelAgente(ctx context.Context, pedida string) (string, error) {
	pedida = strings.TrimSpace(pedida)
	if pedida == "" {
		return "", nil
	}
	filas, err := s.pool.Query(ctx, `SELECT id::text, name FROM branches WHERE active`)
	if err != nil {
		return "", err
	}
	defer filas.Close()
	for filas.Next() {
		var id, nombre string
		if err := filas.Scan(&id, &nombre); err != nil {
			return "", err
		}
		if id == pedida || comparable(nombre) == comparable(pedida) {
			return id, nil
		}
	}
	if err := filas.Err(); err != nil {
		return "", err
	}
	return "", errSucursalDesconocida
}

// lista_ es la lista de piezas en el formato del optimizador: el agente con
// su token o alguien del panel con su sesión.
func (a *API) lista_(w http.ResponseWriter, r *http.Request) {
	if !agenteAutorizado(r) && !esStaff(w, r) {
		return
	}
	c, err := a.s.Obtener(r.Context(), r.PathValue("id"))
	if err == nil && c == nil {
		textoPlano(w, http.StatusNotFound, "No encontrado")
		return
	}
	var perfil PerfilDeExportacion
	if err == nil {
		perfil, err = a.s.PerfilParaExportar(r.Context(), r.URL.Query().Get("perfil"))
	}
	if err != nil {
		a.s.log.Error("lista del corte", "error", err)
		textoPlano(w, http.StatusInternalServerError, "Error")
		return
	}
	if len(c.Piezas) == 0 {
		textoPlano(w, http.StatusConflict, "El corte no tiene piezas cargadas.")
		return
	}
	corte := CorteParaExportar{Numero: c.Numero, Cliente: c.Cliente, Material: MaterialParaLaMaquina(c)}
	for _, p := range c.Piezas {
		corte.Piezas = append(corte.Piezas, PiezaParaExportar{p.LargoMm, p.AnchoMm, p.Cantidad, p.RespetaVeta, p.CantoLargo, p.CantoAncho, p.Etiqueta})
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+NombreDeArchivo(c.Numero, perfil.Separador)+`"`)
	w.Header().Set("Cache-Control", "private, no-store")
	// BOM: sin esto Excel en Windows rompe los acentos.
	_, _ = w.Write([]byte(bom + ArmarArchivoDeCorte(corte, perfil)))
}

const bom = "\xef\xbb\xbf"

// ptx es el programa de corte en PTX, experimental, del mismo plano que la
// hoja de corte.
func (a *API) ptx(w http.ResponseWriter, r *http.Request) {
	if !esStaff(w, r) {
		return
	}
	c, err := a.s.Obtener(r.Context(), r.PathValue("id"))
	if err != nil {
		a.s.log.Error("ptx del corte", "error", err)
		textoPlano(w, http.StatusInternalServerError, "Error")
		return
	}
	if c == nil {
		textoPlano(w, http.StatusNotFound, "No encontrado")
		return
	}
	if len(c.Piezas) == 0 {
		textoPlano(w, http.StatusConflict, "El corte no tiene piezas cargadas.")
		return
	}
	plano, err := PlanoDelCorteConTope(c)
	if err != nil {
		textoPlano(w, http.StatusConflict, msgDemasiadasPiezas)
		return
	}
	if len(plano.Placas) == 0 {
		textoPlano(w, http.StatusConflict, "Ninguna pieza entra en la placa: no hay programa que armar. Revisá el despiece.")
		return
	}
	hoja, err := ArmarHojaDeCorte(plano)
	if err != nil {
		a.s.log.Error("ptx del corte", "error", err)
		textoPlano(w, http.StatusInternalServerError, "Error")
		return
	}
	piezas := make([]PiezaPtx, len(c.Piezas))
	for i, p := range c.Piezas {
		piezas[i] = PiezaPtx{p.LargoMm, p.AnchoMm, p.Cantidad, p.RespetaVeta, p.Etiqueta}
	}
	archivo := ArmarPtx(TrabajoParaPtx{c.Numero, c.Cliente, c.Material, c.CreatedAt, piezas}, hoja)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+NombreDeArchivoPtx(c.Numero)+`"`)
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = w.Write([]byte(archivo))
}

func (o respuesta) VisitVistaPreviaDePerfilResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

// VistaPreviaDePerfil es cómo saldría el archivo con un formato que todavía
// se está armando en pantalla.
func (a *API) VistaPreviaDePerfil(ctx context.Context, r cortesapi.VistaPreviaDePerfilRequestObject) (cortesapi.VistaPreviaDePerfilResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	b := r.Body
	p := PerfilDeExportacion{
		Nombre: b.Perfil.Nombre, Separador: b.Perfil.Separador, ConEncabezado: b.Perfil.ConEncabezado,
		Unidad: string(b.Perfil.Unidad), Decimal: string(b.Perfil.Decimal), SiNo: [2]string{b.Perfil.SiNo[0], b.Perfil.SiNo[1]},
		FinDeLinea: b.Perfil.FinDeLinea,
	}
	if p.Separador == "" {
		p.Separador = ";"
	}
	for _, c := range b.Perfil.Columnas {
		p.Columnas = append(p.Columnas, ColumnaConfigurada{c.Clave, c.Encabezado})
	}
	c := CorteParaExportar{Numero: b.Corte.Numero, Cliente: b.Corte.Cliente, Material: b.Corte.Material}
	for _, x := range b.Corte.Piezas {
		c.Piezas = append(c.Piezas, PiezaParaExportar{x.LargoMm, x.AnchoMm, x.Cantidad, x.RespetaVeta, x.CantoLargo, x.CantoAncho, x.Etiqueta})
	}
	return ok(map[string]string{"archivo": ArmarArchivoDeCorte(c, p), "nombre": NombreDeArchivo(c.Numero, p.Separador)}), nil
}
