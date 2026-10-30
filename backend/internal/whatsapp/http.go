package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"mjbj/internal/api/whatsappapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// API son las rutas de api/whatsapp.yaml.
type API struct {
	s       *Servicio
	interna plataforma.ConfigInterna
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, interna plataforma.ConfigInterna) *API {
	return &API{s: s, interna: interna}
}

var _ whatsappapi.StrictServerInterface = (*API)(nil)

type respuesta struct {
	codigo int
	v      any
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta { return respuesta{http.StatusOK, v} }

func (o respuesta) VisitAvisosManualesResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitRegistrarAvisoManualResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitAvisoDelUltimoReciboResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCambiarAvisoResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitGuardarTextoAvisoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAbrirBandejaResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitBuscarClientesParaVincularResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitConfiguracionWhatsappResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitAbrirConversacionResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitObtenerConversacionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitAsignarConversacionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCambiarBajaResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitEnviarDocumentoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCambiarEstadoConversacionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitEnviarPlantillaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitResponderResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitSimularEntranteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitVincularClienteResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitDiagnosticarWhatsappResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitEnviarDocumentoAlClienteResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitReintentarDescargaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitReaccionarResponse(w http.ResponseWriter) error         { return o.escribir(w) }
func (o respuesta) VisitReintentarMensajeResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitSincronizarPlantillasResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitMensajeDePruebaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitConversacionesSinLeerResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitGuardarTopeResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitAvisoAutomaticoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAvisoDePedidoResponse(w http.ResponseWriter) error   { return o.escribir(w) }

// bandeja: el rol de la bandeja (ACCESO["/admin/whatsapp"]), no solo ser personal.
func bandeja(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/whatsapp")...)
}

// admin: la configuración es solo de administración (cada aviso que se prende se cobra).
func admin(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/whatsapp/configuracion")...)
}

func (a *API) interno(ctx context.Context) error {
	if !a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
		return plataforma.NuevoProblema(http.StatusForbidden, "Solo el servidor de la aplicación puede pedir esto.")
	}
	return nil
}

func normalizarFiltro(f *string) string {
	v := oTexto(f, "")
	// «cerradas» era el nombre viejo de «resueltas»: los enlaces guardados siguen andando.
	if v == "cerradas" {
		v = "resueltas"
	}
	if contiene(Filtros, v) {
		return v
	}
	return "todas"
}

// Bandeja es todo lo que muestra /admin/whatsapp (y /atencion).
type Bandeja struct {
	Filtro         string                `json:"filtro"`
	Conversaciones []ConversacionListada `json:"conversaciones"`
	Contadores     Contadores            `json:"contadores"`
	Estado         EstadoBandeja         `json:"estado"`
	Plantillas     []PlantillaDisponible `json:"plantillas"`
	Personal       []Persona             `json:"personal"`
	Gasto          GastoChico            `json:"gasto"`
	Detalle        *DetalleConversacion  `json:"detalle"`
}

// AbrirBandeja junta en un pedido lo que la vista pedía en seis. Abrir una
// conversación es haberla leída: se ponen en cero los no leídos y se le avisa
// a WhatsApp (los dos tildes azules), después de contestar.
func (s *Servicio) AbrirBandeja(ctx context.Context, ses *auth.Sesion, filtro, chat string) (*Bandeja, error) {
	b := &Bandeja{Filtro: filtro}
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { b.Conversaciones, err = s.ListarConversaciones(gctx, filtro, ses.UserID); return })
	g.Go(func() (err error) { b.Estado, err = s.EstadoWhatsapp(gctx); return })
	g.Go(func() (err error) { b.Plantillas, err = s.PlantillasDisponibles(gctx); return })
	g.Go(func() (err error) { b.Contadores, err = s.ContarBandeja(gctx, ses.UserID); return })
	g.Go(func() (err error) { b.Personal, err = s.PersonalDeLaBandeja(gctx); return })
	g.Go(func() error {
		gasto, err := s.GastoDelMes(gctx, s.ahora())
		b.Gasto = GastoChico{gasto.USD, gasto.Tope, gasto.Proporcion, gasto.Alcanzado}
		return err
	})
	if err := g.Wait(); err != nil {
		return nil, err
	}
	elegida := chat
	if elegida == "" && len(b.Conversaciones) > 0 {
		elegida = b.Conversaciones[0].ID
	}
	if elegida != "" {
		d, err := s.ObtenerConversacion(ctx, elegida)
		if err != nil {
			return nil, err
		}
		b.Detalle = d
		if d != nil && d.NoLeidos > 0 {
			go s.marcarLeida(d.ID)
		}
	}
	return b, nil
}

func (s *Servicio) marcarLeida(id string) {
	ctx, cancelar := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelar()
	ultimo, err := s.MarcarLeidaSilencioso(ctx, id)
	if err != nil {
		s.log.Error("whatsapp: marcar leída", "error", err)
		return
	}
	if ultimo != "" {
		s.prov.MarcarLeido(ctx, ultimo)
	}
}

func (a *API) AbrirBandeja(ctx context.Context, r whatsappapi.AbrirBandejaRequestObject) (whatsappapi.AbrirBandejaResponseObject, error) {
	ses, err := bandeja(ctx)
	if err != nil {
		return nil, err
	}
	b, err := a.s.AbrirBandeja(ctx, ses, normalizarFiltro(r.Params.Filtro), oTexto(r.Params.Chat, ""))
	if err != nil {
		return nil, err
	}
	return ok(b), nil
}

func (a *API) ConversacionesSinLeer(ctx context.Context, _ whatsappapi.ConversacionesSinLeerRequestObject) (whatsappapi.ConversacionesSinLeerResponseObject, error) {
	if _, err := bandeja(ctx); err != nil {
		return nil, err
	}
	n, err := a.s.ConversacionesSinLeer(ctx)
	return ok(map[string]int{"total": n}), err
}

func (a *API) BuscarClientesParaVincular(ctx context.Context, r whatsappapi.BuscarClientesParaVincularRequestObject) (whatsappapi.BuscarClientesParaVincularResponseObject, error) {
	if _, err := bandeja(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.BuscarClientes(ctx, r.Params.Q)
	return ok(v), err
}

func (a *API) ObtenerConversacion(ctx context.Context, r whatsappapi.ObtenerConversacionRequestObject) (whatsappapi.ObtenerConversacionResponseObject, error) {
	if _, err := bandeja(ctx); err != nil {
		return nil, err
	}
	d, err := a.s.ObtenerConversacion(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	if d == nil {
		return nil, plataforma.NuevoProblema(http.StatusNotFound, noEncontrada)
	}
	return ok(d), nil
}

func (a *API) AbrirConversacion(ctx context.Context, r whatsappapi.AbrirConversacionRequestObject) (whatsappapi.AbrirConversacionResponseObject, error) {
	if _, err := bandeja(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.AbrirConversacion(ctx, r.Body.Telefono)
	return ok(v), err
}

func si(b *bool) bool { return b != nil && *b }

func (a *API) Responder(ctx context.Context, r whatsappapi.ResponderRequestObject) (whatsappapi.ResponderResponseObject, error) {
	ses, err := bandeja(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.Responder(ctx, ses, r.Id, r.Body.Cuerpo, oTexto(r.Body.Citado, ""), si(r.Body.ConfirmarTope))
	return ok(v), err
}

// formulario lee un multipart con un archivo (`archivo`) de hasta 25 MB.
func formulario(r *multipart.Reader) (map[string]string, []byte, error) {
	const tope = 26 << 20
	campos := map[string]string{}
	var archivo []byte
	leido := int64(0)
	for {
		p, err := r.NextPart()
		if errors.Is(err, io.EOF) {
			return campos, archivo, nil
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
			return nil, nil, plataforma.NuevoProblema(http.StatusRequestEntityTooLarge, "El archivo pesa más de 25 MB.")
		}
		if p.FormName() == "archivo" {
			if len(datos) > 0 {
				archivo = datos
			}
			continue
		}
		campos[p.FormName()] = string(datos)
	}
}

func (a *API) EnviarPlantilla(ctx context.Context, r whatsappapi.EnviarPlantillaRequestObject) (whatsappapi.EnviarPlantillaResponseObject, error) {
	ses, err := bandeja(ctx)
	if err != nil {
		return nil, err
	}
	c, archivo, err := formulario(r.Body)
	if err != nil {
		return nil, err
	}
	valores := map[string]string{}
	if c["valores"] != "" {
		if err := json.Unmarshal([]byte(c["valores"]), &valores); err != nil {
			return nil, plataforma.NuevoProblema(http.StatusBadRequest, "Los valores no son un JSON de textos.")
		}
	}
	var doc *PDF
	if archivo != nil {
		doc = &PDF{Contenido: archivo, Nombre: c["archivoNombre"]}
	}
	v, err := a.s.EnviarPlantilla(ctx, ses, r.Id, c["plantilla"], c["idioma"], valores, doc, c["confirmarTope"] == "si")
	return ok(v), err
}

func (a *API) EnviarDocumento(ctx context.Context, r whatsappapi.EnviarDocumentoRequestObject) (whatsappapi.EnviarDocumentoResponseObject, error) {
	ses, err := bandeja(ctx)
	if err != nil {
		return nil, err
	}
	c, archivo, err := formulario(r.Body)
	if err != nil {
		return nil, err
	}
	var doc *PDF
	if archivo != nil {
		doc = &PDF{Contenido: archivo, Nombre: c["archivoNombre"], Descripcion: c["descripcion"]}
	}
	v, err := a.s.EnviarDocumento(ctx, ses, r.Id, c["tipo"], c["id"], cortarJS(c["epigrafe"], 1000), doc, c["confirmarTope"] == "si")
	return ok(v), err
}

func (a *API) EnviarDocumentoAlCliente(ctx context.Context, r whatsappapi.EnviarDocumentoAlClienteRequestObject) (whatsappapi.EnviarDocumentoAlClienteResponseObject, error) {
	ses, err := bandeja(ctx)
	if err != nil {
		return nil, err
	}
	c, archivo, err := formulario(r.Body)
	if err != nil {
		return nil, err
	}
	var doc *DocumentoAlCliente
	if archivo != nil {
		doc = &DocumentoAlCliente{PDF: PDF{Contenido: archivo, Nombre: c["archivoNombre"], Descripcion: c["descripcion"]},
			CustomerID: nulo(ptr(c["customerId"])), Telefono: nulo(ptr(c["telefonoDelDocumento"])), Contacto: nulo(ptr(c["contacto"]))}
	}
	var epigrafe *string
	if e, hay := c["epigrafe"]; hay {
		epigrafe = &e
	}
	v, err := a.s.EnviarDocumentoAlCliente(ctx, ses, c["tipo"], c["id"], c["telefono"], epigrafe, doc, c["confirmarTope"] == "si")
	return ok(v), err
}

func (a *API) AsignarConversacion(ctx context.Context, r whatsappapi.AsignarConversacionRequestObject) (whatsappapi.AsignarConversacionResponseObject, error) {
	ses, err := bandeja(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.Asignar(ctx, ses, r.Id, r.Body.UsuarioId)
	return ok(v), err
}

func (a *API) CambiarEstadoConversacion(ctx context.Context, r whatsappapi.CambiarEstadoConversacionRequestObject) (whatsappapi.CambiarEstadoConversacionResponseObject, error) {
	ses, err := bandeja(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.CambiarEstado(ctx, ses, r.Id, r.Body.Estado)
	return ok(v), err
}

func (a *API) VincularCliente(ctx context.Context, r whatsappapi.VincularClienteRequestObject) (whatsappapi.VincularClienteResponseObject, error) {
	if _, err := bandeja(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Vincular(ctx, r.Id, nulo(r.Body.CustomerId))
	return ok(v), err
}

func (a *API) CambiarBaja(ctx context.Context, r whatsappapi.CambiarBajaRequestObject) (whatsappapi.CambiarBajaResponseObject, error) {
	ses, err := bandeja(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.CambiarBaja(ctx, ses, r.Id, r.Body.Baja)
	return ok(v), err
}

func (a *API) SimularEntrante(ctx context.Context, r whatsappapi.SimularEntranteRequestObject) (whatsappapi.SimularEntranteResponseObject, error) {
	if _, err := bandeja(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.SimularEntrante(ctx, r.Id, r.Body.Cuerpo)
	return ok(v), err
}

func (a *API) ReintentarMensaje(ctx context.Context, r whatsappapi.ReintentarMensajeRequestObject) (whatsappapi.ReintentarMensajeResponseObject, error) {
	ses, err := bandeja(ctx)
	if err != nil {
		return nil, err
	}
	confirmar := r.Body != nil && si(r.Body.ConfirmarTope)
	v, err := a.s.ReintentarMensaje(ctx, ses, r.Id, confirmar)
	return ok(v), err
}

func (a *API) Reaccionar(ctx context.Context, r whatsappapi.ReaccionarRequestObject) (whatsappapi.ReaccionarResponseObject, error) {
	if _, err := bandeja(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Reaccionar(ctx, r.Id, r.Body.Emoji)
	return ok(v), err
}

func (a *API) ReintentarDescarga(ctx context.Context, r whatsappapi.ReintentarDescargaRequestObject) (whatsappapi.ReintentarDescargaResponseObject, error) {
	if _, err := bandeja(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.ReintentarDescarga(ctx, r.Id)
	return ok(v), err
}

func (a *API) ConfiguracionWhatsapp(ctx context.Context, _ whatsappapi.ConfiguracionWhatsappRequestObject) (whatsappapi.ConfiguracionWhatsappResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.LeerConfiguracion(ctx)
	return ok(v), err
}

func (a *API) CambiarAviso(ctx context.Context, r whatsappapi.CambiarAvisoRequestObject) (whatsappapi.CambiarAvisoResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.CambiarAviso(ctx, ses, r.Id, r.Body.Activo)
	return ok(v), err
}

func (a *API) GuardarTextoAviso(ctx context.Context, r whatsappapi.GuardarTextoAvisoRequestObject) (whatsappapi.GuardarTextoAvisoResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.GuardarTextoAviso(ctx, r.Id, r.Body.TextoLibre)
	return ok(v), err
}

func (a *API) SincronizarPlantillas(ctx context.Context, _ whatsappapi.SincronizarPlantillasRequestObject) (whatsappapi.SincronizarPlantillasResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Sincronizar(ctx)
	return ok(v), err
}

func (a *API) DiagnosticarWhatsapp(ctx context.Context, _ whatsappapi.DiagnosticarWhatsappRequestObject) (whatsappapi.DiagnosticarWhatsappResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Diagnosticar(ctx)
	return ok(v), err
}

func (a *API) MensajeDePrueba(ctx context.Context, r whatsappapi.MensajeDePruebaRequestObject) (whatsappapi.MensajeDePruebaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.MensajeDePrueba(ctx, ses, r.Body.Telefono)
	return ok(v), err
}

func (a *API) GuardarTope(ctx context.Context, r whatsappapi.GuardarTopeRequestObject) (whatsappapi.GuardarTopeResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	v, err := a.s.GuardarTope(ctx, ses, map[string]string{"tope": b.Tope, "utility": b.Utility, "service": b.Service,
		"marketing": b.Marketing, "authentication": b.Authentication})
	return ok(v), err
}

func (a *API) AvisosManuales(ctx context.Context, r whatsappapi.AvisosManualesRequestObject) (whatsappapi.AvisosManualesResponseObject, error) {
	if _, err := bandeja(ctx); err != nil {
		return nil, err
	}
	ids := []string{}
	for _, id := range strings.Split(r.Params.Ids, ",") {
		if id = strings.TrimSpace(id); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) > 200 {
		return nil, plataforma.NuevoProblema(http.StatusBadRequest, "Demasiados avisos de una vez.")
	}
	if r.Params.Saldo != nil && len(ids) == 1 {
		v, err := a.s.AvisoManual(ctx, r.Params.Evento, r.Params.Tipo, ids[0], map[string]string{"saldo": *r.Params.Saldo})
		if err != nil {
			return nil, err
		}
		out := map[string]*AvisoManualListo{}
		if v != nil {
			out[v.EntidadID] = v
		}
		return ok(out), nil
	}
	v, err := a.s.AvisosManualesDe(ctx, r.Params.Evento, r.Params.Tipo, ids)
	return ok(v), err
}

func (a *API) AvisoDelUltimoRecibo(ctx context.Context, r whatsappapi.AvisoDelUltimoReciboRequestObject) (whatsappapi.AvisoDelUltimoReciboResponseObject, error) {
	if _, err := bandeja(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.AvisoDelUltimoRecibo(ctx, r.CustomerId)
	return ok(v), err
}

func (a *API) RegistrarAvisoManual(ctx context.Context, r whatsappapi.RegistrarAvisoManualRequestObject) (whatsappapi.RegistrarAvisoManualResponseObject, error) {
	ses, err := bandeja(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	v, err := a.s.RegistrarAvisoManual(ctx, ses, b.Evento, b.EntidadTipo, b.EntidadId, b.Telefono)
	return ok(v), err
}

func (a *API) AvisoAutomatico(ctx context.Context, r whatsappapi.AvisoAutomaticoRequestObject) (whatsappapi.AvisoAutomaticoResponseObject, error) {
	if err := a.interno(ctx); err != nil {
		return nil, err
	}
	c, archivo, err := formulario(r.Body)
	if err != nil {
		return nil, err
	}
	var o OpcionesAviso
	if err := json.Unmarshal([]byte(c["datos"]), &o); err != nil {
		return nil, plataforma.NuevoProblema(http.StatusBadRequest, "Los datos del aviso no son un JSON válido.")
	}
	if archivo != nil {
		o.Documento = &Documento{Contenido: archivo, Nombre: c["archivoNombre"]}
	}
	return ok(a.s.AvisarPorWhatsapp(ctx, o)), nil
}

func (a *API) AvisoDePedido(ctx context.Context, r whatsappapi.AvisoDePedidoRequestObject) (whatsappapi.AvisoDePedidoResponseObject, error) {
	if err := a.interno(ctx); err != nil {
		return nil, err
	}
	if !plataforma.UUIDValido(r.Body.OrderId) {
		return ok(ResultadoAviso{"omitida", "No existe el pedido."}), nil
	}
	return ok(a.s.AvisarCambioDePedido(ctx, r.Body.OrderId, r.Body.Estado)), nil
}

// --- las rutas que no van por el contrato ---

// Rutas registra las direcciones de siempre: el webhook de Meta (no cambia:
// es la que está dada de alta en Meta), los adjuntos y el envío de archivos.
func (s *Servicio) Rutas(m *http.ServeMux) {
	m.HandleFunc("GET /api/whatsapp/webhook", s.VerificarWebhook)
	m.HandleFunc("POST /api/whatsapp/webhook", s.RecibirWebhook)
	m.HandleFunc("GET /api/whatsapp/medios/{id}", s.ServirMedio)
	m.HandleFunc("POST /api/whatsapp/enviar-archivo", s.EnviarArchivo)
}

func puedeBandeja(r *http.Request) *auth.Sesion {
	ses := auth.DeContexto(r.Context())
	if !ses.EsStaff() || !roles.PuedeEntrar("/admin/whatsapp", ses.RolStaff) {
		return nil
	}
	return ses
}

// Lo que el navegador puede mostrar adentro de la bandeja; el resto se descarga.
var enLinea = regexp.MustCompile(`^(image/(jpeg|png|webp)|audio/|video/(mp4|3gpp)|application/pdf)`)

var reNombreArchivo = regexp.MustCompile(`[^\w.\- ]+`)

// ServirMedio sirve un adjunto, solo a quien puede abrir la bandeja. A todo
// lo demás, 404: un 401 le confirmaría a quien prueba ids que ese mensaje
// existe. Las cabeceras impiden que el archivo se interprete como otra cosa.
func (s *Servicio) ServirMedio(w http.ResponseWriter, r *http.Request) {
	noEncontrado := func() { http.Error(w, "No encontrado", http.StatusNotFound) }
	if puedeBandeja(r) == nil {
		noEncontrado()
		return
	}
	id := r.PathValue("id")
	if !plataforma.UUIDValido(id) {
		noEncontrado()
		return
	}
	var ref, mime, nombre *string
	if err := s.pool.QueryRow(r.Context(), `select media_url, media_mime, media_nombre from whatsapp_mensajes where id = $1`, id).Scan(&ref, &mime, &nombre); err != nil || vacio(ref) {
		noEncontrado()
		return
	}
	contenido, mimeArchivo := s.LeerPrivado(*ref)
	if contenido == nil {
		noEncontrado()
		return
	}
	tipo := oTexto(mime, "")
	if tipo == "" {
		tipo = mimeArchivo
	}
	tipo = strings.TrimSpace(strings.SplitN(tipo, ";", 2)[0])
	n := cortarJS(reNombreArchivo.ReplaceAllString(oTexto(nombre, "archivo"), "_"), 120)
	h := w.Header()
	if enLinea.MatchString(tipo) {
		h.Set("Content-Type", tipo)
		h.Set("Content-Disposition", `inline; filename="`+n+`"`)
	} else {
		h.Set("Content-Type", "application/octet-stream")
		h.Set("Content-Disposition", `attachment; filename="`+n+`"`)
	}
	h.Set("Cache-Control", "private, max-age=3600")
	h.Set("X-Content-Type-Options", "nosniff")
	// El visor de PDF del navegador no abre adentro de un `sandbox`.
	if tipo != "application/pdf" {
		h.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox")
	}
	_, _ = w.Write(contenido)
}

var topesDeArchivo = map[string]int{"image": 5 << 20, "video": 16 << 20, "audio": 16 << 20, "document": 25 << 20}

// esImagenDeVerdad mira la firma de JPG y PNG, no lo que dice el navegador.
func esImagenDeVerdad(b []byte, mime string) bool {
	switch mime {
	case "image/jpeg":
		return len(b) >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff
	case "image/png":
		return len(b) >= 4 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4e && b[3] == 0x47
	}
	return false
}

// EnviarArchivo manda una foto o un archivo desde la bandeja: se sube a Meta
// y sale por id, y se guarda una copia privada para la conversación.
func (s *Servicio) EnviarArchivo(w http.ResponseWriter, r *http.Request) {
	responder := func(estado int, v any) { plataforma.EscribirJSON(w, estado, v) }
	fallar := func(t string, estado int) { responder(estado, map[string]string{"error": t}) }
	ses := puedeBandeja(r)
	if ses == nil {
		fallar("No autorizado.", http.StatusUnauthorized)
		return
	}
	mr, err := r.MultipartReader()
	if err != nil {
		fallar("No llegó el archivo.", http.StatusBadRequest)
		return
	}
	var archivo []byte
	var nombreArchivo, tipoArchivo string
	campos := map[string]string{}
	for {
		p, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			fallar("No llegó el archivo.", http.StatusBadRequest)
			return
		}
		datos, err := io.ReadAll(io.LimitReader(p, (26<<20)+1))
		if err != nil || len(datos) > 26<<20 {
			fallar("El archivo pesa más de 25 MB.", http.StatusRequestEntityTooLarge)
			return
		}
		if p.FormName() == "archivo" && p.FileName() != "" {
			archivo, nombreArchivo, tipoArchivo = datos, p.FileName(), p.Header.Get("Content-Type")
			continue
		}
		campos[p.FormName()] = string(datos)
	}
	convID := campos["conversacionId"]
	epigrafe := cortarJS(trimJS(campos["epigrafe"]), 1024)
	citado := nulo(ptr(trimJS(campos["citado"])))
	if len(archivo) == 0 {
		fallar("Elegí un archivo.", http.StatusBadRequest)
		return
	}
	if !reUUIDBandeja.MatchString(convID) {
		fallar("Conversación inválida.", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	c, err := s.Conversacion(ctx, convID)
	if err != nil || c == nil {
		fallar(noEncontrada, http.StatusNotFound)
		return
	}
	if !VentanaAbierta(c.UltimoEntranteAt, s.ahora()) {
		responder(http.StatusConflict, map[string]any{
			"error":             "Pasaron más de 24 horas desde su último mensaje: un archivo suelto no se puede mandar. Usá un mensaje preparado.",
			"requierePlantilla": true,
		})
		return
	}
	if tipoArchivo == "" {
		tipoArchivo = "application/octet-stream"
	}
	mime := LimpiarMime(tipoArchivo)
	clase := TipoParaEnviar(mime)
	// Una «imagen» que no es JPG ni PNG de verdad va como documento.
	if clase == "image" && !esImagenDeVerdad(archivo, mime) {
		clase = "document"
		if !strings.HasPrefix(mime, "image/") {
			mime = "application/octet-stream"
		}
	}
	if len(archivo) > topesDeArchivo[clase] {
		mb := topesDeArchivo[clase] / 1024 / 1024
		t := "El archivo pesa más de " + strconv.Itoa(mb) + " MB."
		if clase == "image" {
			t = "WhatsApp no acepta fotos de más de " + strconv.Itoa(mb) + " MB. Mandala como documento o achicala."
		}
		fallar(t, http.StatusRequestEntityTooLarge)
		return
	}
	confirmar := campos["confirmarTope"] == "si"
	if !confirmar && s.TopeAlcanzado(ctx) {
		responder(http.StatusConflict, map[string]any{"error": ErrorTope.Texto, "requiereConfirmacionTope": true})
		return
	}
	nombre := cortarJS(reNombreArchivo.ReplaceAllString(nombreArchivo, "_"), 120)
	if nombre == "" {
		nombre = "archivo"
	}
	mediaID, e := s.prov.SubirMedia(ctx, archivo, mime, nombre)
	if e != nil || mediaID == "" {
		t := "WhatsApp no aceptó el archivo."
		if e != nil {
			t = e.Texto
		}
		fallar(t, http.StatusBadGateway)
		return
	}
	ref, n, err := s.GuardarPrivado(archivo, mime)
	if err != nil {
		s.log.Error("whatsapp: guardando un archivo", "error", err)
		fallar("No se pudo guardar el archivo.", http.StatusInternalServerError)
		return
	}
	res, err := s.EnviarYRegistrar(ctx, Envio{ConversacionID: c.ID, WaJid: c.WaJid,
		Mensaje:  Saliente{Tipo: "media", Clase: clase, Media: &RefMedia{ID: mediaID}, Epigrafe: &epigrafe, NombreArchivo: &nombre, Citado: citado},
		Registro: Registro{Cuerpo: epigrafe, Citado: citado, Media: &MediaRegistro{Referencia: ref, Tipo: clase, Mime: mime, Nombre: &nombre, Bytes: &n, MediaID: &mediaID}},
		Origen:   "panel", EnviadoPor: &ses.UserID, ConfirmarTope: true})
	if err != nil {
		s.log.Error("whatsapp: enviando un archivo", "error", err)
		fallar("No se pudo enviar.", http.StatusInternalServerError)
		return
	}
	if res.Error != nil {
		responder(http.StatusBadGateway, map[string]any{"error": res.Error.Texto, "requierePlantilla": res.Error.Accion == AccionPlantilla,
			"requiereConfirmacionTope": res.Error.Accion == AccionTope})
		return
	}
	responder(http.StatusOK, map[string]any{"ok": true, "mensajeId": res.MensajeID})
}

// reUUIDBandeja es el /^[0-9a-f-]{36}$/i del TS.
var reUUIDBandeja = regexp.MustCompile(`^[0-9a-fA-F-]{36}$`)

func (o respuesta) VisitCrearFichaDesdeConversacionResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

func (a *API) CrearFichaDesdeConversacion(ctx context.Context, r whatsappapi.CrearFichaDesdeConversacionRequestObject) (whatsappapi.CrearFichaDesdeConversacionResponseObject, error) {
	ses, err := bandeja(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	de := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	v, err := a.s.CrearFicha(ctx, ses, r.Id, FormFicha{Nombre: de(b.Nombre), Documento: de(b.Documento), Rubro: de(b.Rubro), Email: de(b.Email)})
	return ok(v), err
}
