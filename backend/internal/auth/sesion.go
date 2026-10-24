package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/sqlc"
)

// Los tiempos de lib/auth-options.ts.
const (
	duracion   = 30 * 24 * time.Hour // expiresIn
	renovarCon = 24 * time.Hour      // updateAge
	// Con «no recordarme» la sesión dura un día y la cookie, lo que dure el
	// navegador abierto.
	duracionSinRecordar = 24 * time.Hour
)

// Config es lo que necesita la sesión.
type Config struct {
	// El mismo secreto que tenía better-auth: firma las cookies. Cambiarlo
	// cierra todas las sesiones.
	Secreto string `env:"BETTER_AUTH_SECRET,required"`
	// La dirección pública: si es https, la cookie lleva el prefijo
	// __Secure- y el atributo Secure, como hacía better-auth.
	URL string `env:"BETTER_AUTH_URL,required"`
}

// Sesion es quién pide. Rol y RolStaff salen de profiles; sin perfil, es
// cliente (como en lib/dal/session.ts).
type Sesion struct {
	UserID      string          `json:"userId"`
	Nombre      string          `json:"nombre"`
	Correo      string          `json:"correo"`
	Rol         sqlc.UserRole   `json:"rol"`
	RolStaff    *sqlc.StaffRole `json:"rolStaff"`
	ListaPrecio *string         `json:"listaDePrecios"`
	token       string
}

// EsStaff es personal de la maderera con un rol del panel.
func (s *Sesion) EsStaff() bool {
	return s != nil && s.Rol == sqlc.UserRoleStaff && s.RolStaff != nil
}

// Tiene dice si el personal tiene alguno de los roles.
func (s *Sesion) Tiene(roles ...sqlc.StaffRole) bool {
	if !s.EsStaff() {
		return false
	}
	for _, r := range roles {
		if *s.RolStaff == r {
			return true
		}
	}
	return false
}

// Servicio maneja las sesiones contra la base.
type Servicio struct {
	pool    *pgxpool.Pool
	q       *sqlc.Queries
	secreto string
	segura  bool
	ahora   func() time.Time
}

// Nuevo arma el servicio.
func Nuevo(cfg Config, pool *pgxpool.Pool) *Servicio {
	return &Servicio{
		pool:    pool,
		q:       sqlc.New(pool),
		secreto: cfg.Secreto,
		segura:  strings.HasPrefix(cfg.URL, "https://"),
		// Los timestamps de estas tablas son sin zona y guardan UTC (es lo que
		// escribía node-postgres, ver el golden): todo va en UTC.
		ahora: func() time.Time { return time.Now().UTC() },
	}
}

func (s *Servicio) nombre(base string) string {
	if s.segura {
		return prefijoSeguro + base
	}
	return base
}

// tokenDe busca la cookie de sesión. Como getSessionCookie de better-auth,
// acepta la del prefijo seguro y la común.
func (s *Servicio) tokenDe(r *http.Request) (string, bool) {
	for _, n := range []string{prefijoSeguro + nombreCookie, nombreCookie} {
		if c, err := r.Cookie(n); err == nil {
			if v, ok := leerFirmado(c.Value, s.secreto); ok {
				return v, true
			}
		}
	}
	return "", false
}

func (s *Servicio) noRecordar(r *http.Request) bool {
	for _, n := range []string{prefijoSeguro + nombreNoRecordar, nombreNoRecordar} {
		if c, err := r.Cookie(n); err == nil {
			if _, ok := leerFirmado(c.Value, s.secreto); ok {
				return true
			}
		}
	}
	return false
}

func (s *Servicio) cookie(nombre, valor string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     s.nombre(nombre),
		Value:    valor,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   s.segura,
		SameSite: http.SameSiteLaxMode,
	}
}

func (s *Servicio) escribirCookie(w http.ResponseWriter, token string, recordar bool) {
	maxAge := int(duracion.Seconds())
	if !recordar {
		maxAge = 0 // de sesión: muere al cerrar el navegador
	}
	http.SetCookie(w, s.cookie(nombreCookie, firmar(token, s.secreto), maxAge))
	if !recordar {
		http.SetCookie(w, s.cookie(nombreNoRecordar, firmar("true", s.secreto), 0))
	}
}

func (s *Servicio) borrarCookies(w http.ResponseWriter) {
	http.SetCookie(w, s.cookie(nombreCookie, "", -1))
	http.SetCookie(w, s.cookie(nombreNoRecordar, "", -1))
}

// Leer devuelve la sesión del pedido, o nil si no hay. Hace lo mismo que
// getSession de better-auth: si venció, la borra; si pasó un día desde la
// última renovación, la extiende otros 30 días y reescribe la cookie.
func (s *Servicio) Leer(w http.ResponseWriter, r *http.Request) (*Sesion, error) {
	token, ok := s.tokenDe(r)
	if !ok {
		return nil, nil
	}
	ctx := r.Context()
	fila, err := s.q.SesionPorToken(ctx, token)
	if errors.Is(err, pgx.ErrNoRows) {
		s.borrarCookies(w)
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("leyendo la sesión: %w", err)
	}
	ahora := s.ahora()
	if fila.ExpiresAt.Before(ahora) {
		s.borrarCookies(w)
		if err := s.q.BorrarSesion(ctx, token); err != nil {
			return nil, err
		}
		return nil, nil
	}
	// shouldBeUpdated de better-auth: expiresAt − expiresIn + updateAge ≤ ahora.
	if !s.noRecordar(r) && !fila.ExpiresAt.Add(-duracion).Add(renovarCon).After(ahora) {
		vence := ahora.Add(duracion)
		if _, err := s.q.RenovarSesion(ctx, sqlc.RenovarSesionParams{Token: token, ExpiresAt: vence, UpdatedAt: ahora}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) { // la borraron mientras tanto
				s.borrarCookies(w)
				return nil, nil
			}
			return nil, fmt.Errorf("renovando la sesión: %w", err)
		}
		s.escribirCookie(w, token, true)
	}
	ses := &Sesion{
		UserID: fila.UserID, Nombre: fila.Name, Correo: fila.Email,
		Rol: sqlc.UserRoleCliente, RolStaff: fila.RolStaff, ListaPrecio: fila.PriceListID, token: token,
	}
	if fila.Rol != nil {
		ses.Rol = *fila.Rol
	}
	return ses, nil
}

// ErrCredenciales es correo o clave equivocados, sin decir cuál de los dos.
var ErrCredenciales = errors.New("el correo o la clave no son correctos")

// ErrCorreoUsado es un registro con un correo que ya tiene cuenta.
var ErrCorreoUsado = errors.New("ya hay una cuenta con ese correo")

func normalizarCorreo(c string) string { return strings.ToLower(strings.TrimSpace(c)) }

// Entrar valida la clave y abre una sesión.
func (s *Servicio) Entrar(ctx context.Context, w http.ResponseWriter, correo, clave, ip, agente string, recordar bool) (*Sesion, error) {
	fila, err := s.q.CuentaConClave(ctx, normalizarCorreo(correo))
	if errors.Is(err, pgx.ErrNoRows) {
		// Se hashea igual: que la respuesta tarde lo mismo exista o no el correo.
		_, _ = verificarClave(hashDeRelleno, clave)
		return nil, ErrCredenciales
	}
	if err != nil {
		return nil, err
	}
	if fila.Password == nil {
		_, _ = verificarClave(hashDeRelleno, clave)
		return nil, ErrCredenciales
	}
	ok, err := verificarClave(*fila.Password, clave)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrCredenciales
	}
	token, err := s.crearSesion(ctx, s.q, fila.ID, ip, agente, recordar)
	if err != nil {
		return nil, err
	}
	s.escribirCookie(w, token, recordar)
	return s.sesionDe(ctx, token)
}

func (s *Servicio) crearSesion(ctx context.Context, q *sqlc.Queries, userID, ip, agente string, recordar bool) (string, error) {
	ahora := s.ahora()
	vence := ahora.Add(duracion)
	if !recordar {
		vence = ahora.Add(duracionSinRecordar)
	}
	token := nuevoID()
	err := q.CrearSesion(ctx, sqlc.CrearSesionParams{
		ID: nuevoID(), Token: token, ExpiresAt: vence, CreatedAt: ahora,
		IpAddress: &ip, UserAgent: &agente, UserID: userID,
	})
	return token, err
}

func (s *Servicio) sesionDe(ctx context.Context, token string) (*Sesion, error) {
	fila, err := s.q.SesionPorToken(ctx, token)
	if err != nil {
		return nil, err
	}
	ses := &Sesion{UserID: fila.UserID, Nombre: fila.Name, Correo: fila.Email, Rol: sqlc.UserRoleCliente,
		RolStaff: fila.RolStaff, ListaPrecio: fila.PriceListID, token: token}
	if fila.Rol != nil {
		ses.Rol = *fila.Rol
	}
	return ses, nil
}

// Registrar crea el usuario, su cuenta con clave y su perfil de cliente, y
// abre la sesión: lo mismo que signUpEmail con autoSignIn.
func (s *Servicio) Registrar(ctx context.Context, w http.ResponseWriter, nombre, correo, clave, ip, agente string) (*Sesion, error) {
	correo = normalizarCorreo(correo)
	hash, err := hashearClave(clave)
	if err != nil {
		return nil, err
	}
	var token string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		existe, err := q.ExisteCorreo(ctx, correo)
		if err != nil {
			return err
		}
		if existe {
			return ErrCorreoUsado
		}
		ahora := s.ahora()
		id := nuevoID()
		if err := q.CrearUsuario(ctx, sqlc.CrearUsuarioParams{ID: id, Name: strings.TrimSpace(nombre), Email: correo, CreatedAt: ahora}); err != nil {
			return err
		}
		if err := q.CrearCuentaConClave(ctx, sqlc.CrearCuentaConClaveParams{ID: nuevoID(), AccountID: id, Password: &hash, CreatedAt: ahora}); err != nil {
			return err
		}
		if err := q.CrearPerfilDeCliente(ctx, id); err != nil {
			return err
		}
		token, err = s.crearSesion(ctx, q, id, ip, agente, true)
		return err
	})
	if err != nil {
		// Dos registros simultáneos con el mismo correo: el índice único
		// frena al segundo.
		if strings.Contains(err.Error(), "user_email_idx") {
			return nil, ErrCorreoUsado
		}
		return nil, err
	}
	s.escribirCookie(w, token, true)
	return s.sesionDe(ctx, token)
}

// Salir borra la sesión y las cookies.
func (s *Servicio) Salir(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	s.borrarCookies(w)
	if token, ok := s.tokenDe(r); ok {
		return s.q.BorrarSesion(ctx, token)
	}
	return nil
}

// CambiarClave verifica la actual, guarda la nueva y cierra las otras
// sesiones de esa persona (quien cambia la clave porque se la vieron no
// quiere que la sesión del otro siga abierta).
func (s *Servicio) CambiarClave(ctx context.Context, ses *Sesion, actual, nueva string) error {
	fila, err := s.q.CuentaConClave(ctx, ses.Correo)
	if err != nil || fila.Password == nil {
		return ErrCredenciales
	}
	ok, err := verificarClave(*fila.Password, actual)
	if err != nil {
		return err
	}
	if !ok {
		return ErrCredenciales
	}
	hash, err := hashearClave(nueva)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.CambiarClave(ctx, sqlc.CambiarClaveParams{UserID: ses.UserID, Password: &hash, UpdatedAt: s.ahora()}); err != nil {
			return err
		}
		return q.BorrarOtrasSesiones(ctx, sqlc.BorrarOtrasSesionesParams{UserID: ses.UserID, Token: ses.token})
	})
}
