package auth

import (
	"context"
	"net/http"

	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

type claveSesion struct{}

// Middleware lee la sesión de cada pedido (si la hay) y la deja en el
// contexto. No exige nada: lo exige cada ruta con Exigir.
func (s *Servicio) Middleware(sig http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ses, err := s.Leer(w, r)
		if err != nil {
			// Sin base no hay sesión que valga; mejor decirlo que tratar a
			// todos como anónimos.
			plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusServiceUnavailable, "No pudimos verificar la sesión. Probá de nuevo en un momento."))
			return
		}
		if ses != nil {
			r = r.WithContext(context.WithValue(r.Context(), claveSesion{}, ses))
		}
		sig.ServeHTTP(w, r)
	})
}

// ConSesion deja una sesión en el contexto (lo hace el middleware; los tests
// de otros paquetes lo usan para no pasar por la cookie).
func ConSesion(ctx context.Context, s *Sesion) context.Context {
	return context.WithValue(ctx, claveSesion{}, s)
}

// DeContexto es la sesión del pedido, o nil.
func DeContexto(ctx context.Context) *Sesion {
	s, _ := ctx.Value(claveSesion{}).(*Sesion)
	return s
}

// Exigir pide sesión y, si se pasan roles, que sea personal con alguno de
// ellos. Devuelve el problema listo para devolver desde el handler.
//
// Es la línea de defensa (no hay RLS en la base): toda ruta que devuelve o
// cambia datos de alguien empieza con esto, y filtra por ses.UserID, nunca
// por un id que mande el cliente.
func Exigir(ctx context.Context, roles ...sqlc.StaffRole) (*Sesion, error) {
	ses := DeContexto(ctx)
	if ses == nil {
		return nil, plataforma.NuevoProblema(http.StatusUnauthorized, "Tenés que entrar para hacer esto.")
	}
	if len(roles) > 0 && !ses.Tiene(roles...) {
		return nil, plataforma.NuevoProblema(http.StatusForbidden, "Tu usuario no tiene permiso para esto.")
	}
	return ses, nil
}

// ExigirStaff pide que sea personal, con cualquier rol.
func ExigirStaff(ctx context.Context) (*Sesion, error) {
	return Exigir(ctx, sqlc.AllStaffRoleValues()...)
}
