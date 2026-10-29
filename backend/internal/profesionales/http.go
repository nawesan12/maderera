package profesionales

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"mjbj/internal/api/profesionalesapi"
	"mjbj/internal/auth"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// API son los handlers de api/profesionales.yaml.
type API struct {
	s       *Servicio
	lim     *limites.Limitador
	interna plataforma.ConfigInterna
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, lim *limites.Limitador, interna plataforma.ConfigInterna) *API {
	return &API{s: s, lim: lim, interna: interna}
}

var _ profesionalesapi.StrictServerInterface = (*API)(nil)

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

func listo(m string) respuesta { return ok(map[string]string{"ok": m}) }

func (o respuesta) VisitAnotarseAEventoResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitAprobarSolicitudResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitAsistentesDeEventoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAvisarInscripcionPorPagoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCambiarEstadoEventoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCrearEventoResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitEstadoProfesionalResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitListarEventosAdminResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitListarSolicitudesProfesionalesResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitListasAsignablesResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitMandarRecordatoriosResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitMarcarAsistenciaResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitRechazarSolicitudResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitResumenProfesionalesResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitSolicitarAccesoProfesionalResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

// El panel sigue el ACCESO de la pantalla (el TS pedía solo ser personal: el
// depósito y el aserradero, que no entran a la pantalla, podían aprobar).
func panelProfesionales(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/profesionales")...)
}

func panelEventos(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/eventos")...)
}

func espera(v limites.Veredicto) error {
	return plataforma.NuevoProblema(http.StatusTooManyRequests, limites.AvisoDeEspera(v))
}

/* ------------------------------ profesionales ------------------------------ */

func (a *API) ListarSolicitudesProfesionales(ctx context.Context, _ profesionalesapi.ListarSolicitudesProfesionalesRequestObject) (profesionalesapi.ListarSolicitudesProfesionalesResponseObject, error) {
	if _, err := panelProfesionales(ctx); err != nil {
		return nil, err
	}
	l, err := a.s.Solicitudes(ctx)
	return ok(l), err
}

func (a *API) ListasAsignables(ctx context.Context, _ profesionalesapi.ListasAsignablesRequestObject) (profesionalesapi.ListasAsignablesResponseObject, error) {
	if _, err := panelProfesionales(ctx); err != nil {
		return nil, err
	}
	l, err := a.s.Listas(ctx)
	return ok(l), err
}

func (a *API) ResumenProfesionales(ctx context.Context, _ profesionalesapi.ResumenProfesionalesRequestObject) (profesionalesapi.ResumenProfesionalesResponseObject, error) {
	if _, err := panelProfesionales(ctx); err != nil {
		return nil, err
	}
	r, err := a.s.Resumen(ctx)
	return ok(r), err
}

func (a *API) AprobarSolicitud(ctx context.Context, r profesionalesapi.AprobarSolicitudRequestObject) (profesionalesapi.AprobarSolicitudResponseObject, error) {
	ses, err := panelProfesionales(ctx)
	if err != nil {
		return nil, err
	}
	id, lista, limite, l := ValidarAprobar(*r.Body)
	if !l.Ok() {
		return nil, invalido("No pudimos identificar esa solicitud. Recargá la pantalla y probá de nuevo.")
	}
	m, err := a.s.Aprobar(ctx, ses, id, lista, limite)
	if err != nil {
		return nil, err
	}
	return listo(m), nil
}

func (a *API) RechazarSolicitud(ctx context.Context, r profesionalesapi.RechazarSolicitudRequestObject) (profesionalesapi.RechazarSolicitudResponseObject, error) {
	ses, err := panelProfesionales(ctx)
	if err != nil {
		return nil, err
	}
	id, motivo, l := ValidarRechazar(*r.Body)
	if err := l.Problema(); err != nil {
		return nil, err
	}
	if err := a.s.Rechazar(ctx, ses, id, motivo); err != nil {
		return nil, err
	}
	return listo("Solicitud rechazada. Le avisamos por correo."), nil
}

func (a *API) SolicitarAccesoProfesional(ctx context.Context, r profesionalesapi.SolicitarAccesoProfesionalRequestObject) (profesionalesapi.SolicitarAccesoProfesionalResponseObject, error) {
	f, l := ValidarSolicitud(*r.Body)
	if err := l.Problema(); err != nil {
		return nil, err
	}
	// El freno, además de la de una pendiente por documento: sin él, la cola
	// del panel se llena desde un solo lugar cambiando un dígito.
	ip := plataforma.IPDelCliente(plataforma.PedidoDe(ctx))
	if v := a.lim.Permitido(ctx, limites.Profesional, "ip:"+ip); !v.Permitido {
		return nil, espera(v)
	}
	m, err := a.s.Solicitar(ctx, auth.DeContexto(ctx), f)
	if err != nil {
		return nil, err
	}
	return listo(m), nil
}

func (a *API) EstadoProfesional(ctx context.Context, _ profesionalesapi.EstadoProfesionalRequestObject) (profesionalesapi.EstadoProfesionalResponseObject, error) {
	e, err := a.s.Estado(ctx, auth.DeContexto(ctx))
	return ok(e), err
}

/* ------------------------------ eventos ------------------------------ */

func (a *API) ListarEventosAdmin(ctx context.Context, _ profesionalesapi.ListarEventosAdminRequestObject) (profesionalesapi.ListarEventosAdminResponseObject, error) {
	if _, err := panelEventos(ctx); err != nil {
		return nil, err
	}
	l, err := a.s.Eventos(ctx)
	return ok(l), err
}

func (a *API) AsistentesDeEvento(ctx context.Context, r profesionalesapi.AsistentesDeEventoRequestObject) (profesionalesapi.AsistentesDeEventoResponseObject, error) {
	if _, err := panelEventos(ctx); err != nil {
		return nil, err
	}
	l, err := a.s.Asistentes(ctx, r.Id.String())
	return ok(l), err
}

func (a *API) CrearEvento(ctx context.Context, r profesionalesapi.CrearEventoRequestObject) (profesionalesapi.CrearEventoResponseObject, error) {
	if _, err := panelEventos(ctx); err != nil {
		return nil, err
	}
	f, l := ValidarEvento(*r.Body)
	if err := l.Problema(); err != nil {
		return nil, err
	}
	if err := a.s.CrearEvento(ctx, f); err != nil {
		return nil, err
	}
	return listo("Evento creado como borrador. Revisalo y publicalo."), nil
}

func (a *API) CambiarEstadoEvento(ctx context.Context, r profesionalesapi.CambiarEstadoEventoRequestObject) (profesionalesapi.CambiarEstadoEventoResponseObject, error) {
	if _, err := panelEventos(ctx); err != nil {
		return nil, err
	}
	id, estado, l := ValidarEstadoEvento(*r.Body)
	if !l.Ok() {
		return nil, invalido("No pudimos identificar ese evento. Recargá la pantalla y probá de nuevo.")
	}
	if err := a.s.CambiarEstadoEvento(ctx, id, estado); err != nil {
		return nil, err
	}
	return listo(TextoDeEstado[estado]), nil
}

func (a *API) MarcarAsistencia(ctx context.Context, r profesionalesapi.MarcarAsistenciaRequestObject) (profesionalesapi.MarcarAsistenciaResponseObject, error) {
	if _, err := panelEventos(ctx); err != nil {
		return nil, err
	}
	id, estado, l := ValidarAsistencia(*r.Body)
	if !l.Ok() {
		return nil, invalido("No pudimos registrar la asistencia. Recargá la pantalla y probá de nuevo.")
	}
	if err := a.s.MarcarAsistencia(ctx, id, estado); err != nil {
		return nil, err
	}
	return listo("Listo."), nil
}

func (a *API) MandarRecordatorios(ctx context.Context, _ profesionalesapi.MandarRecordatoriosRequestObject) (profesionalesapi.MandarRecordatoriosResponseObject, error) {
	if _, err := panelEventos(ctx); err != nil {
		return nil, err
	}
	n, err := a.s.EnviarRecordatorios(ctx)
	if err != nil {
		return nil, err
	}
	switch n {
	case 0:
		return listo("No hay eventos mañana con gente sin avisar."), nil
	case 1:
		return listo("Salieron 1 recordatorio."), nil
	}
	return listo(fmt.Sprintf("Salieron %d recordatorios.", n)), nil
}

func (a *API) AnotarseAEvento(ctx context.Context, r profesionalesapi.AnotarseAEventoRequestObject) (profesionalesapi.AnotarseAEventoResponseObject, error) {
	f, l := ValidarAnotarse(*r.Body)
	if err := l.Problema(); err != nil {
		return nil, err
	}
	// El evento con precio crea una preferencia real en Mercado Pago por
	// inscripción: esto impide las mil con mil correos desde el mismo lado.
	ip := plataforma.IPDelCliente(plataforma.PedidoDe(ctx))
	if v := a.lim.PorAmbos(ctx, limites.Evento, ip, "correo", f.Email); !v.Permitido {
		return nil, espera(v)
	}
	ses := auth.DeContexto(ctx)
	e, err := a.s.Estado(ctx, ses)
	if err != nil {
		return nil, err
	}
	var userID *string
	if ses != nil {
		userID = &ses.UserID
	}
	ins, err := a.s.Anotar(ctx, f, e.CustomerID, userID, e.Aprobado)
	if err != nil {
		return nil, err
	}
	return ok(ins), nil
}

func (a *API) AvisarInscripcionPorPago(ctx context.Context, r profesionalesapi.AvisarInscripcionPorPagoRequestObject) (profesionalesapi.AvisarInscripcionPorPagoResponseObject, error) {
	if !a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
		return nil, plataforma.NuevoProblema(http.StatusForbidden, "Solo el servidor.")
	}
	a.s.AvisarInscripcionPorPago(ctx, r.Body.CustomerId.String())
	return listo("Listo."), nil
}
