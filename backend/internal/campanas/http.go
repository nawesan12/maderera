package campanas

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"mjbj/internal/api/campanasapi"
	"mjbj/internal/auth"
	"mjbj/internal/avisos"
	"mjbj/internal/plataforma"
	"mjbj/internal/push"
	"mjbj/internal/roles"
)

// API son los handlers de api/campanas.yaml, más la baja con un clic de
// siempre (POST /api/baja).
type API struct {
	s      *Servicio
	avisos *avisos.Servicio
	push   *push.Avisador
	clave  string
}

// NuevaAPI arma los handlers. clave es la VAPID pública.
func NuevaAPI(s *Servicio, a *avisos.Servicio, p *push.Avisador, clavePublica string) *API {
	return &API{s: s, avisos: a, push: p, clave: clavePublica}
}

var _ campanasapi.StrictServerInterface = (*API)(nil)

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

func hecho(m string) respuesta { return ok(map[string]string{"ok": m}) }

func hechoConID(m, id string) respuesta { return ok(map[string]string{"ok": m, "id": id}) }

func (o respuesta) VisitActivarPushResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitAlcanceDelSegmentoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAvisosEnviadosResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCambiarAvisoEmailResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitCancelarEnvioDeCampanaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitClaveDePushResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitConfirmarBajaResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitDesactivarPushResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitDesprogramarCampanaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitDuplicarCampanaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitEliminarBorradorDeCampanaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitEnviarCampanaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitEnviarPruebaDeCampanaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitEstadoDeCampanasResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitEstadoDelCorreoResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitFallidosDeCampanaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitGuardarCampanaResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitGuardarTextoAvisoEmailResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitLeerBajaResponse(w http.ResponseWriter) error          { return o.escribir(w) }
func (o respuesta) VisitListarAvisosEmailResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitListarCampanasResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitObtenerCampanaResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitProbarPushResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitProgramarCampanaResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitVistaPreviaDeCampanaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

func admin(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/campanas")...)
}

func adminAvisos(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/avisos")...)
}

/* ------------------------------- campañas ------------------------------- */

// segmentoDelFormulario es leerSegmento sobre los campos sueltos del
// formulario (tipo, rubros, actividad, meses).
func segmentoDelFormulario(m map[string]any) Segmento {
	d := DatosDeSegmento{Tipo: m["tipo"], Actividad: m["actividad"], Meses: m["meses"]}
	if rs, ok := m["rubros"].([]any); ok {
		d.Rubros = rs
	}
	return LeerSegmento(d)
}

func (r *Resumen) conDescripcion() map[string]any {
	b, _ := json.Marshal(r)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	m["descripcion"] = DescribirSegmento(r.Segmento)
	return m
}

func (a *API) ListarCampanas(ctx context.Context, _ campanasapi.ListarCampanasRequestObject) (campanasapi.ListarCampanasResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	l, err := a.s.Listar(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, len(l))
	for i := range l {
		out[i] = l[i].conDescripcion()
	}
	return ok(out), nil
}

func (a *API) ObtenerCampana(ctx context.Context, r campanasapi.ObtenerCampanaRequestObject) (campanasapi.ObtenerCampanaResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	c, err := a.s.Obtener(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, plataforma.NuevoProblema(http.StatusNotFound, "No existe esa campaña.")
	}
	m := c.conDescripcion()
	m["muestra"] = ArmarCorreo(a.s.cfg.URLDelSitio(), a.s.cfg.Secreto, ParaArmar{Asunto: c.Asunto, Adelanto: c.Adelanto, Cuerpo: c.Cuerpo,
		ImagenURL: c.ImagenURL, BotonTexto: c.BotonTexto, BotonURL: c.BotonURL}, "cliente@ejemplo.com", "Cliente").HTML
	return ok(m), nil
}

func (a *API) FallidosDeCampana(ctx context.Context, r campanasapi.FallidosDeCampanaRequestObject) (campanasapi.FallidosDeCampanaResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	f, err := a.s.Fallidos(ctx, r.Id.String())
	return ok(f), err
}

// motivo es motivoParaNoEnviar: sin envío real no le llega a nadie. (El
// otro motivo del TS —un despliegue sin el cron— no existe en Go: las tandas
// las manda el worker.)
func (a *API) motivo() *string {
	if !a.s.envio.Real() {
		m := sinCorreo
		return &m
	}
	return nil
}

func (a *API) EstadoDeCampanas(ctx context.Context, _ campanasapi.EstadoDeCampanasRequestObject) (campanasapi.EstadoDeCampanasResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	n, err := a.s.CantidadDeBajas(ctx)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"real": a.s.envio.Real(), "porMinuto": a.s.PorMinuto(), "bajas": n, "motivo": a.motivo()}), nil
}

func (a *API) AlcanceDelSegmento(ctx context.Context, r campanasapi.AlcanceDelSegmentoRequestObject) (campanasapi.AlcanceDelSegmentoResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	seg := segmentoDelFormulario(*r.Body)
	n, err := a.s.Contar(ctx, seg)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"cantidad": n, "descripcion": DescribirSegmento(seg), "porMinuto": a.s.PorMinuto()}), nil
}

func (a *API) GuardarCampana(ctx context.Context, r campanasapi.GuardarCampanaRequestObject) (campanasapi.GuardarCampanaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	m := *r.Body
	f, l := ValidarCampana(m)
	if err := l.Problema(); err != nil {
		return nil, err
	}
	id, _ := m["id"].(string)
	if id != "" && !plataforma.UUIDValido(id) {
		return nil, invalido("Esa campaña no existe.")
	}
	nuevo, err := a.s.Guardar(ctx, ses, id, f, segmentoDelFormulario(m))
	if err != nil {
		return nil, err
	}
	return hechoConID("Guardada.", nuevo), nil
}

func (a *API) VistaPreviaDeCampana(ctx context.Context, r campanasapi.VistaPreviaDeCampanaRequestObject) (campanasapi.VistaPreviaDeCampanaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	f, l := ValidarCampana(*r.Body)
	if err := l.Problema(); err != nil {
		return nil, err
	}
	return ok(map[string]string{"html": a.s.Correo(ses, f).HTML}), nil
}

func (a *API) EnviarPruebaDeCampana(ctx context.Context, r campanasapi.EnviarPruebaDeCampanaRequestObject) (campanasapi.EnviarPruebaDeCampanaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	if !a.s.envio.Real() {
		return nil, invalido("El envío de correos no está conectado todavía.")
	}
	f, l := ValidarCampana(*r.Body)
	if err := l.Problema(); err != nil {
		return nil, err
	}
	m, err := a.s.EnviarPrueba(ctx, ses, f)
	if err != nil {
		return nil, err
	}
	return hecho(m), nil
}

func (a *API) EnviarCampana(ctx context.Context, r campanasapi.EnviarCampanaRequestObject) (campanasapi.EnviarCampanaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	if m := a.motivo(); m != nil {
		return nil, invalido(*m)
	}
	m, err := a.s.Enviar(ctx, ses, r.Id.String())
	if err != nil {
		return nil, err
	}
	return hecho(m), nil
}

func (a *API) ProgramarCampana(ctx context.Context, r campanasapi.ProgramarCampanaRequestObject) (campanasapi.ProgramarCampanaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	if err := a.s.Programar(ctx, ses, r.Id.String(), r.Body.Cuando); err != nil {
		return nil, err
	}
	return hecho("Programada."), nil
}

func (a *API) DesprogramarCampana(ctx context.Context, r campanasapi.DesprogramarCampanaRequestObject) (campanasapi.DesprogramarCampanaResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	if err := a.s.Desprogramar(ctx, r.Id.String()); err != nil {
		return nil, err
	}
	return hecho("Volvió a borrador."), nil
}

func (a *API) CancelarEnvioDeCampana(ctx context.Context, r campanasapi.CancelarEnvioDeCampanaRequestObject) (campanasapi.CancelarEnvioDeCampanaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	n, err := a.s.Cancelar(ctx, ses, r.Id.String())
	if err != nil {
		return nil, err
	}
	return hecho(fmt.Sprintf("Cancelada. %d quedaron sin mandar.", n)), nil
}

func (a *API) DuplicarCampana(ctx context.Context, r campanasapi.DuplicarCampanaRequestObject) (campanasapi.DuplicarCampanaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	id, err := a.s.Duplicar(ctx, ses, r.Id.String())
	if err != nil {
		return nil, err
	}
	return hechoConID("Duplicada.", id), nil
}

func (a *API) EliminarBorradorDeCampana(ctx context.Context, r campanasapi.EliminarBorradorDeCampanaRequestObject) (campanasapi.EliminarBorradorDeCampanaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	if err := a.s.EliminarBorrador(ctx, ses, r.Id.String()); err != nil {
		return nil, err
	}
	return hecho("Borrador eliminado."), nil
}

/* ------------------------------- las bajas ------------------------------- */

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (a *API) LeerBaja(ctx context.Context, r campanasapi.LeerBajaRequestObject) (campanasapi.LeerBajaResponseObject, error) {
	correo, valida := a.s.Verificar(texto(r.Params.E), texto(r.Params.T))
	if !valida {
		return ok(map[string]any{"email": nil, "dadoDeBaja": false}), nil
	}
	baja, err := a.s.EstaDadoDeBaja(ctx, correo)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{"email": correo, "dadoDeBaja": baja}), nil
}

func (a *API) ConfirmarBaja(ctx context.Context, r campanasapi.ConfirmarBajaRequestObject) (campanasapi.ConfirmarBajaResponseObject, error) {
	correo, valida := a.s.Verificar(r.Body.E, r.Body.T)
	if !valida {
		return nil, invalido("El enlace no es válido.")
	}
	var err error
	if r.Body.Recibir {
		err = a.s.VolverARecibir(ctx, correo)
	} else {
		err = a.s.DarDeBaja(ctx, correo, "enlace")
	}
	if err != nil {
		return nil, err
	}
	return hecho("Listo."), nil
}

// Registrar suma al mux la baja con un clic de RFC 8058 (la URL de los
// correos que ya salieron no cambia).
//
// Es un POST a propósito: los programas que revisan los enlaces de un correo
// —antivirus, vistas previas— hacen GET, y si un GET diera de baja la gente
// se iría sin haber tocado nada. El GET solo lleva a la página, donde hay
// que confirmar.
func (a *API) Registrar(m *http.ServeMux) {
	m.HandleFunc("POST /api/baja", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		correo, valida := a.s.Verificar(q.Get("e"), q.Get("t"))
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		if !valida {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("Enlace inválido."))
			return
		}
		if err := a.s.DarDeBaja(r.Context(), correo, "enlace"); err != nil {
			a.s.log.Error("baja", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte("No pudimos darte de baja. Probá de nuevo en un rato."))
			return
		}
		_, _ = w.Write([]byte("Listo: no vas a recibir más novedades."))
	})
	m.HandleFunc("GET /api/baja", func(w http.ResponseWriter, r *http.Request) {
		destino := "/baja"
		if r.URL.RawQuery != "" {
			destino += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, destino, http.StatusSeeOther)
	})
}

/* ------------------------------- avisos ------------------------------- */

func (a *API) ListarAvisosEmail(ctx context.Context, _ campanasapi.ListarAvisosEmailRequestObject) (campanasapi.ListarAvisosEmailResponseObject, error) {
	if _, err := adminAvisos(ctx); err != nil {
		return nil, err
	}
	l, err := a.avisos.Listar(ctx)
	return ok(l), err
}

func (a *API) EstadoDelCorreo(ctx context.Context, _ campanasapi.EstadoDelCorreoRequestObject) (campanasapi.EstadoDelCorreoResponseObject, error) {
	if _, err := adminAvisos(ctx); err != nil {
		return nil, err
	}
	return ok(a.avisos.Estado()), nil
}

func (a *API) AvisosEnviados(ctx context.Context, r campanasapi.AvisosEnviadosRequestObject) (campanasapi.AvisosEnviadosResponseObject, error) {
	if _, err := adminAvisos(ctx); err != nil {
		return nil, err
	}
	limite := 40
	if r.Params.Limite != nil {
		limite = *r.Params.Limite
	}
	l, err := a.avisos.Ultimos(ctx, limite)
	return ok(l), err
}

const avisoPerdido = "No pudimos identificar ese aviso. Recargá la pantalla y probá de nuevo."

func (a *API) CambiarAvisoEmail(ctx context.Context, r campanasapi.CambiarAvisoEmailRequestObject) (campanasapi.CambiarAvisoEmailResponseObject, error) {
	if _, err := adminAvisos(ctx); err != nil {
		return nil, err
	}
	id, activo, l := ValidarAvisoActivo(*r.Body)
	if !l.Ok() {
		return nil, invalido(avisoPerdido)
	}
	if err := a.avisos.Cambiar(ctx, id, activo); err != nil {
		return nil, err
	}
	if activo {
		return hecho("Aviso activado."), nil
	}
	return hecho("Aviso apagado."), nil
}

func (a *API) GuardarTextoAvisoEmail(ctx context.Context, r campanasapi.GuardarTextoAvisoEmailRequestObject) (campanasapi.GuardarTextoAvisoEmailResponseObject, error) {
	if _, err := adminAvisos(ctx); err != nil {
		return nil, err
	}
	id, asunto, encabezado, l := ValidarAvisoTexto(*r.Body)
	if err := l.Problema(); err != nil {
		return nil, err
	}
	if err := a.avisos.GuardarTexto(ctx, id, asunto, encabezado); err != nil {
		return nil, err
	}
	return hecho("Texto guardado."), nil
}

/* ------------------------------- push ------------------------------- */

func (a *API) ClaveDePush(ctx context.Context, _ campanasapi.ClaveDePushRequestObject) (campanasapi.ClaveDePushResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	var clave *string
	if a.clave != "" {
		clave = &a.clave
	}
	return ok(map[string]any{"clave": clave, "configurado": a.push.Configurado()}), nil
}

func (a *API) ActivarPush(ctx context.Context, r campanasapi.ActivarPushRequestObject) (campanasapi.ActivarPushResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	if err := a.avisos.Suscribir(ctx, ses, avisos.Suscripcion{Endpoint: b.Endpoint, P256dh: b.P256dh, Auth: b.Auth, Descripcion: b.Descripcion}); err != nil {
		return nil, err
	}
	return hecho("Listo: este dispositivo va a avisar cuando entre una venta."), nil
}

func (a *API) DesactivarPush(ctx context.Context, r campanasapi.DesactivarPushRequestObject) (campanasapi.DesactivarPushResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	if err := a.avisos.Desuscribir(ctx, ses, r.Body.Endpoint); err != nil {
		return nil, err
	}
	return hecho("Este dispositivo dejó de recibir avisos."), nil
}

func (a *API) ProbarPush(ctx context.Context, _ campanasapi.ProbarPushRequestObject) (campanasapi.ProbarPushResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	if err := a.avisos.Probar(ctx, a.push); err != nil {
		return nil, err
	}
	return hecho("Aviso mandado. Si no llega en unos segundos, revisá el permiso del navegador."), nil
}
