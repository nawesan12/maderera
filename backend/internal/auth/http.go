package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"mjbj/internal/api/sesionapi"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
)

// API son las rutas de sesión (api/sesion.yaml).
type API struct {
	s   *Servicio
	lim *limites.Limitador
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, lim *limites.Limitador) *API { return &API{s: s, lim: lim} }

var _ sesionapi.StrictServerInterface = (*API)(nil)

func dto(s *Sesion) sesionapi.Sesion {
	out := sesionapi.Sesion{UserId: s.UserID, Nombre: s.Nombre, Correo: s.Correo, Rol: sesionapi.SesionRol(s.Rol), ListaDePrecios: s.ListaPrecio}
	if s.RolStaff != nil {
		r := sesionapi.SesionRolStaff(*s.RolStaff)
		out.RolStaff = &r
	}
	return out
}

// Los mensajes son los de los formularios de Next (app/(auth)/…/actions.ts).
func correoValido(c string) bool { return plataforma.CorreoValido(strings.TrimSpace(c)) }

func ipYAgente(ctx context.Context) (string, string) {
	r := plataforma.PedidoDe(ctx)
	if r == nil {
		return "", ""
	}
	return plataforma.IPDelCliente(r), r.UserAgent()
}

func espera(v limites.Veredicto) *plataforma.Problema {
	p := plataforma.NuevoProblema(http.StatusTooManyRequests, limites.AvisoDeEspera(v))
	return p
}

// VerSesion es quién pide.
func (a *API) VerSesion(ctx context.Context, _ sesionapi.VerSesionRequestObject) (sesionapi.VerSesionResponseObject, error) {
	ses, err := ExigirSesion(ctx)
	if err != nil {
		return nil, err
	}
	return sesionapi.VerSesion200JSONResponse(dto(ses)), nil
}

// Entrar valida y abre la sesión. Cuenta los intentos por IP y por correo.
func (a *API) Entrar(ctx context.Context, req sesionapi.EntrarRequestObject) (sesionapi.EntrarResponseObject, error) {
	b := req.Body
	errs := map[string]string{}
	if !correoValido(b.Correo) {
		errs["correo"] = "Revisá el correo, no parece válido."
	}
	if b.Clave == "" {
		errs["clave"] = "Escribí tu contraseña."
	}
	if len(errs) > 0 {
		return nil, plataforma.Invalido(errs)
	}
	ip, agente := ipYAgente(ctx)
	correo := normalizarCorreo(b.Correo)
	if v := a.lim.PorAmbos(ctx, limites.Ingresar, ip, "correo", correo); !v.Permitido {
		return nil, espera(v)
	}
	recordar := b.Recordar == nil || *b.Recordar
	ses, err := a.s.Entrar(ctx, plataforma.EscritorDe(ctx), correo, b.Clave, ip, agente, recordar)
	if errors.Is(err, ErrCredenciales) {
		return nil, plataforma.Invalido(map[string]string{"clave": "El correo o la contraseña no coinciden."})
	}
	if err != nil {
		return nil, err
	}
	// Acertó: la cuenta se suelta. Si no, alguien que se equivoca dos veces y
	// después entra bien arrastraría el límite el resto de la ventana.
	a.lim.Soltar(ctx, limites.Ingresar, "correo:"+correo)
	return sesionapi.Entrar200JSONResponse(dto(ses)), nil
}

// Salir borra la sesión. Sin sesión también contesta 204: el resultado es el
// mismo.
func (a *API) Salir(ctx context.Context, _ sesionapi.SalirRequestObject) (sesionapi.SalirResponseObject, error) {
	if err := a.s.Salir(ctx, plataforma.EscritorDe(ctx), plataforma.PedidoDe(ctx)); err != nil {
		return nil, err
	}
	return sesionapi.Salir204Response{}, nil
}

// Registrarse crea la cuenta de cliente. El registro no confirma el correo
// (todavía no hay remitente propio), así que el freno es cuántas cuentas
// crea una IP por hora.
func (a *API) Registrarse(ctx context.Context, req sesionapi.RegistrarseRequestObject) (sesionapi.RegistrarseResponseObject, error) {
	b := req.Body
	errs := map[string]string{}
	nombre := strings.TrimSpace(b.Nombre)
	if utf8.RuneCountInString(nombre) < 2 {
		errs["nombre"] = "Escribí tu nombre."
	} else if utf8.RuneCountInString(nombre) > 120 {
		errs["nombre"] = "El nombre es demasiado largo."
	}
	if !correoValido(b.Correo) {
		errs["correo"] = "Revisá el correo, no parece válido."
	}
	tel := ""
	if b.Telefono != nil {
		tel = strings.TrimSpace(*b.Telefono)
	}
	if n := utf8.RuneCountInString(tel); n < 6 || n > 40 {
		errs["telefono"] = "Dejanos un teléfono para coordinar las entregas."
	}
	if utf8.RuneCountInString(b.Clave) < 8 {
		errs["clave"] = "La contraseña necesita 8 caracteres o más."
	} else if utf8.RuneCountInString(b.Clave) > 128 {
		errs["clave"] = "La contraseña es demasiado larga."
	}
	if len(errs) > 0 {
		return nil, plataforma.Invalido(errs)
	}
	ip, agente := ipYAgente(ctx)
	if v := a.lim.Permitido(ctx, limites.Registrarse, "ip:"+ip); !v.Permitido {
		return nil, espera(v)
	}
	ses, err := a.s.Registrar(ctx, plataforma.EscritorDe(ctx), Alta{Nombre: nombre, Correo: b.Correo, Telefono: tel, Clave: b.Clave}, ip, agente)
	if errors.Is(err, ErrCorreoUsado) {
		// Acá sí se dice: quien se registra necesita saber que tiene que
		// ingresar, y el dato no revela nada que un intento de alta no revele.
		return nil, plataforma.Invalido(map[string]string{"correo": "Ya hay una cuenta con ese correo. Probá ingresando."})
	}
	if err != nil {
		return nil, err
	}
	return sesionapi.Registrarse201JSONResponse(dto(ses)), nil
}

// CambiarClave pide la actual y cierra las otras sesiones.
func (a *API) CambiarClave(ctx context.Context, req sesionapi.CambiarClaveRequestObject) (sesionapi.CambiarClaveResponseObject, error) {
	ses, err := ExigirSesion(ctx)
	if err != nil {
		return nil, err
	}
	if utf8.RuneCountInString(req.Body.Nueva) < 8 {
		return nil, plataforma.Invalido(map[string]string{"nueva": "La contraseña necesita 8 caracteres o más."})
	}
	if err := a.s.CambiarClave(ctx, ses, req.Body.Actual, req.Body.Nueva); errors.Is(err, ErrCredenciales) {
		return nil, plataforma.Invalido(map[string]string{"actual": "La contraseña actual no es esa."})
	} else if err != nil {
		return nil, err
	}
	return sesionapi.CambiarClave204Response{}, nil
}
