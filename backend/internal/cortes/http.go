package cortes

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
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
func (o respuesta) VisitBorrarPerfilResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitCalcularDeckResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitCalcularPisoResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitCalcularPlacasResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitCalcularPlanoResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCalcularTechoResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCambiarSierraResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCargarPasadasResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCortesDelPedidoResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitCotizarCorteResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitCrearCorteResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitFichaDeCorteResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitGuardarAcomodoResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitGuardarParametrosResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitGuardarPerfilResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitGuardarTarifaResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitHojaDelCorteResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitListarCortesResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitListarPerfilesResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitListarTarifasResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitParametrosDeCalculoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitPlacasCortablesResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitResolverCarritoResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitSugerirDelCatalogoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitTarifasActivasResponse(w http.ResponseWriter) error     { return o.escribir(w) }

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
	v, err := a.s.Listar(ctx, texto(r.Params.Busqueda), texto(r.Params.Estado))
	return ok(v), err
}

func (a *API) CrearCorte(ctx context.Context, r cortesapi.CrearCorteRequestObject) (cortesapi.CrearCorteResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	f := FormCorte{
		CustomerID: texto(b.CustomerId), OrderID: texto(b.OrderId), ContactoNombre: b.ContactoNombre,
		BranchID: texto(b.BranchId), VariantID: texto(b.VariantId), MaterialDescripcion: b.MaterialDescripcion,
		PlacaLargoMm: texto(b.PlacaLargoMm), PlacaAnchoMm: texto(b.PlacaAnchoMm), Mitad: texto(b.Mitad),
		Placas: texto(b.Placas), CantoDescripcion: texto(b.CantoDescripcion), Urgente: b.Urgente != nil && *b.Urgente,
		Notas: texto(b.Notas), AcomodoManual: texto(b.AcomodoManual), AnchoSierraMm: texto(b.AnchoSierraMm),
	}
	for _, p := range b.Piezas {
		crudo, err := json.Marshal(p)
		if err != nil {
			return nil, err
		}
		f.Piezas = append(f.Piezas, crudo)
	}
	numero, err := a.s.Crear(ctx, ses, f)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"numero": numero}), nil
}

func (a *API) FichaDeCorte(ctx context.Context, r cortesapi.FichaDeCorteRequestObject) (cortesapi.FichaDeCorteResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	f, err := a.s.Ficha(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, noEncontrado
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
	plano := PlanoDelCorte(c)
	hoja, err := ArmarHojaDeCorte(plano)
	var ng ErrNoGuillotina
	if errors.As(err, &ng) {
		return nil, plataforma.NuevoProblema(http.StatusConflict, ng.Error())
	}
	if err != nil {
		return nil, err
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
	m, err := a.s.Avanzar(ctx, ses, r.Id.String())
	if err != nil {
		return nil, err
	}
	return okTexto(m), nil
}

func (a *API) AlternarUrgente(ctx context.Context, r cortesapi.AlternarUrgenteRequestObject) (cortesapi.AlternarUrgenteResponseObject, error) {
	if _, err := gestion(ctx); err != nil {
		return nil, err
	}
	m, err := a.s.AlternarUrgente(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	return okTexto(m), nil
}

func (a *API) CargarPasadas(ctx context.Context, r cortesapi.CargarPasadasRequestObject) (cortesapi.CargarPasadasResponseObject, error) {
	ses, err := gestion(ctx)
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
	ses, err := gestion(ctx)
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
	ses, err := gestion(ctx)
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

// --- las calculadoras ---

func (a *API) ParametrosDeCalculo(ctx context.Context, _ cortesapi.ParametrosDeCalculoRequestObject) (cortesapi.ParametrosDeCalculoResponseObject, error) {
	v, err := a.s.Parametros(ctx)
	return ok(v), err
}

func (a *API) CalcularTecho(ctx context.Context, r cortesapi.CalcularTechoRequestObject) (cortesapi.CalcularTechoResponseObject, error) {
	p, err := a.s.Parametros(ctx)
	if err != nil {
		return nil, err
	}
	return ok(CalcularTecho(r.Body.Largo, r.Body.Ancho, string(r.Body.Tipo), p)), nil
}

func (a *API) CalcularPlacas(ctx context.Context, r cortesapi.CalcularPlacasRequestObject) (cortesapi.CalcularPlacasResponseObject, error) {
	p, err := a.s.Parametros(ctx)
	if err != nil {
		return nil, err
	}
	piezas := make([]PiezaDePlaca, len(r.Body.Piezas))
	for i, x := range r.Body.Piezas {
		piezas[i] = PiezaDePlaca{x.Ancho, x.Largo, x.Cantidad}
	}
	return ok(CalcularPlacas(piezas, r.Body.PlacaAncho, r.Body.PlacaLargo, p.AnchoSierraMm, p.MargenSeguridad)), nil
}

func (a *API) CalcularPiso(ctx context.Context, r cortesapi.CalcularPisoRequestObject) (cortesapi.CalcularPisoResponseObject, error) {
	p, err := a.s.Parametros(ctx)
	if err != nil {
		return nil, err
	}
	return ok(CalcularPiso(r.Body.Largo, r.Body.Ancho, 0, p.SeparacionPisoM)), nil
}

func (a *API) CalcularDeck(ctx context.Context, r cortesapi.CalcularDeckRequestObject) (cortesapi.CalcularDeckResponseObject, error) {
	p, err := a.s.Parametros(ctx)
	if err != nil {
		return nil, err
	}
	tabla := p.Deck.Grandis
	if r.Body.Material == "pvc" {
		tabla = p.Deck.Pvc
	}
	return ok(CalcularDeck(r.Body.Largo, r.Body.Ancho, string(r.Body.Material), tabla, p.MargenSeguridad, p.SeparacionPisoM)), nil
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

func (a *API) SugerirDelCatalogo(ctx context.Context, r cortesapi.SugerirDelCatalogoRequestObject) (cortesapi.SugerirDelCatalogoResponseObject, error) {
	l, err := a.lista(ctx, nil, nil)
	if err != nil {
		return nil, err
	}
	terminos := r.Body.Terminos
	// Tope duro: la calculadora manda como mucho cinco renglones.
	if len(terminos) > 8 {
		terminos = terminos[:8]
	}
	v, err := a.s.Sugerir(ctx, l, terminos)
	return ok(v), err
}

// --- el armador de cortes ---

func (a *API) PlacasCortables(ctx context.Context, r cortesapi.PlacasCortablesRequestObject) (cortesapi.PlacasCortablesResponseObject, error) {
	l, err := a.lista(ctx, r.Params.Publico, r.Params.Lista)
	if err != nil {
		return nil, err
	}
	v, err := a.s.Placas(ctx, l)
	return ok(v), err
}

// TopeDeUnidades es cuántas piezas acomoda el plano de un pedido: más allá
// es un despiece que no se tipea en una pantalla.
const TopeDeUnidades = 5_000

func (a *API) CalcularPlano(ctx context.Context, r cortesapi.CalcularPlanoRequestObject) (cortesapi.CalcularPlanoResponseObject, error) {
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
	if total > TopeDeUnidades {
		return nil, error422("Son demasiadas piezas para dibujar el plano acá.")
	}
	d := DatosDelPlano{Piezas: piezas, PlacaLargo: b.PlacaLargo, PlacaAncho: b.PlacaAncho, AnchoSierra: b.AnchoSierra, Busqueda: b.Busqueda}
	if b.Fijadas != nil {
		d.Fijadas = aFijadas(*b.Fijadas)
	}
	plano := CalcularPlano(d)
	out := map[string]any{"plano": plano}
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

func (a *API) ResolverCarrito(ctx context.Context, r cortesapi.ResolverCarritoRequestObject) (cortesapi.ResolverCarritoResponseObject, error) {
	if !a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
		return nil, plataforma.NuevoProblema(http.StatusForbidden, "Esto solo lo puede pedir el sitio.")
	}
	l, err := a.lista(ctx, nil, nil)
	if err != nil {
		return nil, err
	}
	resueltos, msg, err := a.s.ResolverCarrito(ctx, l, r.Body.CartId)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"resueltos": resueltos}
	if msg != "" {
		out["error"] = msg
	}
	return ok(out), nil
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
// lectura: el agente lleva su registro.
func (a *API) pendientes(w http.ResponseWriter, r *http.Request) {
	if TokenDelAgente() == "" {
		textoPlano(w, http.StatusNotFound, "No encontrado")
		return
	}
	if !agenteAutorizado(r) {
		textoPlano(w, http.StatusUnauthorized, "No autorizado")
		return
	}
	cortes, err := a.s.Listar(r.Context(), "", "en-cola")
	if err != nil {
		a.s.log.Error("cortes pendientes", "error", err)
		textoPlano(w, http.StatusInternalServerError, "Error")
		return
	}
	type pendiente struct {
		ID          string `json:"id"`
		Numero      string `json:"numero"`
		Cliente     string `json:"cliente"`
		Material    string `json:"material"`
		Piezas      int32  `json:"piezas"`
		Urgente     bool   `json:"urgente"`
		Actualizado string `json:"actualizado"`
	}
	out := []pendiente{}
	for _, c := range cortes {
		if c.Piezas > 0 {
			out = append(out, pendiente{c.ID, c.Numero, c.Cliente, c.Material, c.Piezas, c.Urgente,
				c.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z")})
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"cortes": out})
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
	corte := CorteParaExportar{Numero: c.Numero, Cliente: c.Cliente, Material: c.Material}
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
	plano := PlanoDelCorte(c)
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
