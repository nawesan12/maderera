package pagos

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"time"

	"mjbj/internal/api/pagosapi"
	"mjbj/internal/auth"
	"mjbj/internal/cola"
	"mjbj/internal/plataforma"
	"mjbj/internal/reportes"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// API son las rutas de api/pagos.yaml y el webhook de siempre.
type API struct {
	s       *Servicio
	x       Extras
	interna plataforma.ConfigInterna
	ahora   func() time.Time
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, x Extras, interna plataforma.ConfigInterna) *API {
	return &API{s: s, x: x, interna: interna, ahora: time.Now}
}

var _ pagosapi.StrictServerInterface = (*API)(nil)

type respuesta struct {
	codigo int
	v      any
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta { return respuesta{http.StatusOK, v} }

func (o respuesta) VisitPanelDePagosResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitGuardarDatosBancariosResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitConciliarTransferenciaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitReconsultarCobroResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitPagarInscripcionResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitInformarChequesDeDeudaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitSubirComprobanteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitSubirComprobanteDeDeudaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCobroSimuladoResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitSimularPagoResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitEstadoDeCobrosResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitPagarPedidoResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitCobroDelPedidoResponse(w http.ResponseWriter) error { return o.escribir(w) }

func noEsta(m string) error { return plataforma.NuevoProblema(http.StatusNotFound, m) }

func valor(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// La conciliación es de quien entra a /admin/pagos (el TS pedía solo ser
// personal: el depósito o el aserradero podían acreditar una transferencia
// llamando a la acción).
func panel(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/pagos")...)
}

/* -------------------------------- público -------------------------------- */

func (a *API) EstadoDeCobros(context.Context, pagosapi.EstadoDeCobrosRequestObject) (pagosapi.EstadoDeCobrosResponseObject, error) {
	return ok(map[string]bool{"enVivo": a.s.EnVivo()}), nil
}

func (a *API) PagarPedido(ctx context.Context, r pagosapi.PagarPedidoRequestObject) (pagosapi.PagarPedidoResponseObject, error) {
	c, err := a.s.PagarPedido(ctx, r.Body.Numero, valor(r.Body.Token), auth.DeContexto(ctx))
	if err != nil {
		return nil, err
	}
	return ok(c), nil
}

func (a *API) CobroDelPedido(ctx context.Context, r pagosapi.CobroDelPedidoRequestObject) (pagosapi.CobroDelPedidoResponseObject, error) {
	c, puede, err := a.s.CobroDePedido(ctx, r.Numero, valor(r.Params.T), auth.DeContexto(ctx))
	if err != nil {
		return nil, err
	}
	if !puede {
		return nil, noEsta("No encontramos ese pedido.")
	}
	return ok(map[string]any{"cobro": c, "enVivo": a.s.EnVivo()}), nil
}

// formulario lee un multipart con el comprobante (16 MB más los textos).
func formulario(r *multipart.Reader) (map[string]string, *Archivo, error) {
	const tope = 17 << 20
	campos := map[string]string{}
	var a *Archivo
	leido := int64(0)
	for {
		p, err := r.NextPart()
		if errors.Is(err, io.EOF) {
			return campos, a, nil
		}
		if err != nil {
			return nil, nil, plataforma.NuevoProblema(http.StatusBadRequest, "El formulario llegó cortado.")
		}
		datos, err := io.ReadAll(io.LimitReader(p, tope-leido+1))
		if err != nil {
			return nil, nil, err
		}
		leido += int64(len(datos))
		if leido > tope {
			return nil, nil, fallo("El archivo pesa más de 16 MB.")
		}
		if p.FormName() == "comprobante" {
			a = &Archivo{Datos: datos, Tipo: p.Header.Get("Content-Type")}
			continue
		}
		campos[p.FormName()] = string(datos)
	}
}

func (a *API) SubirComprobante(ctx context.Context, r pagosapi.SubirComprobanteRequestObject) (pagosapi.SubirComprobanteResponseObject, error) {
	campos, archivo, err := formulario(r.Body)
	if err != nil {
		return nil, err
	}
	v, err := a.s.SubirComprobante(ctx, a.x, campos["numero"], campos["token"], auth.DeContexto(ctx), archivo)
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

func (a *API) SubirComprobanteDeDeuda(ctx context.Context, r pagosapi.SubirComprobanteDeDeudaRequestObject) (pagosapi.SubirComprobanteDeDeudaResponseObject, error) {
	campos, archivo, err := formulario(r.Body)
	if err != nil {
		return nil, err
	}
	v, err := a.s.SubirComprobanteDeDeuda(ctx, a.x, auth.DeContexto(ctx), archivo, campos["monto"], campos["medio"])
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

func (a *API) InformarChequesDeDeuda(ctx context.Context, r pagosapi.InformarChequesDeDeudaRequestObject) (pagosapi.InformarChequesDeDeudaResponseObject, error) {
	v, err := a.s.InformarCheques(ctx, a.x, auth.DeContexto(ctx), valor(r.Body.Partes))
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

func (a *API) CobroSimulado(ctx context.Context, r pagosapi.CobroSimuladoRequestObject) (pagosapi.CobroSimuladoResponseObject, error) {
	c, err := a.s.Simulado(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, noEsta("No hay un cobro de demostración con ese id.")
	}
	return ok(c), nil
}

func (a *API) SimularPago(ctx context.Context, r pagosapi.SimularPagoRequestObject) (pagosapi.SimularPagoResponseObject, error) {
	v, err := a.s.Simular(ctx, r.Id, valor(r.Body.Decision))
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, noEsta("No hay un cobro de demostración con ese id.")
	}
	return ok(v), nil
}

func (a *API) PagarInscripcion(ctx context.Context, r pagosapi.PagarInscripcionRequestObject) (pagosapi.PagarInscripcionResponseObject, error) {
	if !a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
		return nil, plataforma.NuevoProblema(http.StatusForbidden, "Solo el servidor.")
	}
	var usuario *string
	if r.Body != nil && r.Body.UsuarioId != nil && plataforma.UUIDValido(*r.Body.UsuarioId) {
		usuario = r.Body.UsuarioId
	}
	c, err := a.s.IniciarPagoDeInscripcion(ctx, r.Id, usuario)
	if err != nil {
		return nil, err
	}
	return ok(c), nil
}

/* --------------------------------- panel --------------------------------- */

func (a *API) PanelDePagos(ctx context.Context, r pagosapi.PanelDePagosRequestObject) (pagosapi.PanelDePagosResponseObject, error) {
	if _, err := panel(ctx); err != nil {
		return nil, err
	}
	p := reportes.ResolverPeriodo(valor(r.Params.Periodo), a.ahora())
	pagos, err := a.s.Listar(ctx, valor(r.Params.Estado), p.Desde)
	if err != nil {
		return nil, err
	}
	resumen, err := a.s.Resumen(ctx, p)
	if err != nil {
		return nil, err
	}
	avisos, err := a.s.Avisos(ctx, 8)
	if err != nil {
		return nil, err
	}
	datos, _, err := a.s.datosBancarios(ctx)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"pagos": pagos, "resumen": resumen, "avisos": avisos, "datosBancarios": datos}), nil
}

func (a *API) GuardarDatosBancarios(ctx context.Context, r pagosapi.GuardarDatosBancariosRequestObject) (pagosapi.GuardarDatosBancariosResponseObject, error) {
	ses, err := panel(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.GuardarDatosBancarios(ctx, ses, map[string]any(*r.Body))
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

func (a *API) ConciliarTransferencia(ctx context.Context, r pagosapi.ConciliarTransferenciaRequestObject) (pagosapi.ConciliarTransferenciaResponseObject, error) {
	ses, err := panel(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.Conciliar(ctx, ses, r.Id, valor(r.Body.Decision), r.Body.Motivo)
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

func (a *API) ReconsultarCobro(ctx context.Context, r pagosapi.ReconsultarCobroRequestObject) (pagosapi.ReconsultarCobroResponseObject, error) {
	ses, err := panel(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.Reconsultar(ctx, ses, r.Id)
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

/* --------------------------------- webhook -------------------------------- */

// Rutas registra el webhook de Mercado Pago en su dirección de siempre.
func (a *API) Rutas(m *http.ServeMux) {
	m.HandleFunc("POST /api/pagos/webhook", a.webhook)
}

// webhook es app/api/pagos/webhook/route.ts: verifica la firma, guarda el
// aviso en la cola (que lo atiende el worker de Go en el acto) y contesta
// 200 rápido, también ante un cuerpo que no se entiende (un 500 hace que
// Mercado Pago reintente durante horas). Con la base caída, 500: ahí sí
// conviene que reintente.
func (a *API) webhook(w http.ResponseWriter, r *http.Request) {
	listo := func() {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}
	crudo, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		listo()
		return
	}
	var cuerpo any = map[string]any{}
	if len(crudo) > 0 {
		if json.Unmarshal(crudo, &cuerpo) != nil {
			listo()
			return
		}
	} else {
		crudo = []byte("{}")
	}
	verificada := false
	if c := LeerCabeceraFirma(r.Header.Get("x-signature")); c != nil {
		var req *string
		if v := r.Header.Get("x-request-id"); v != "" {
			req = &v
		}
		verificada = FirmaValida(DataIDDelAviso(r.URL.Query(), cuerpo), req, c.Ts, c.V1, a.s.cfg.WebhookSecret, a.ahora())
	}
	u := url.URL{Scheme: "https", Host: r.Host, Path: r.URL.Path, RawQuery: r.URL.RawQuery}
	if _, err := cola.Encolar(r.Context(), sqlc.New(a.s.pool), TipoAviso, CargaAviso{
		Proveedor: "mercado_pago", Cuerpo: crudo, URL: u.String(), FirmaVerificada: &verificada,
	}, time.Time{}); err != nil {
		a.s.log.Error("no se pudo encolar el aviso de pago", "error", err)
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusInternalServerError, "No se pudo guardar el aviso."))
		return
	}
	listo()
}
