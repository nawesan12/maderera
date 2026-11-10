package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"mjbj/internal/sqlc"
)

// El link mágico (notas del 9/11/2026): entrar sin clave, con un enlace de un
// solo uso. Dos usos:
//
//   - Activación: al aprobar a un profesional que pidió el acceso sin cuenta.
//     Vence a los 7 días; el panel lo copia o lo manda por WhatsApp.
//   - Ingreso: «mandame un link» en /ingresar. Vence a los 15 minutos y va
//     solo al correo de la cuenta. También sirve de «olvidé mi clave».
//
// Se guarda en `verification` (la tabla de better-auth que nadie usaba) **el
// hash del token, nunca el token**: quien lea la base no puede entrar con lo
// que ve. El uso es único porque usarlo borra la fila.
const (
	EnlaceActivacion = "activacion"
	EnlaceIngreso    = "ingreso"

	VenceActivacion = 7 * 24 * time.Hour
	VenceIngreso    = 15 * time.Minute
	VencePonerClave = 30 * time.Minute
)

// habilitaClave es la fila que permite, a la sesión que entró con un link,
// poner clave sin la actual.
func habilitaClave(sesionToken string) string {
	h := sha256.Sum256([]byte(sesionToken))
	return "clave:" + hex.EncodeToString(h[:])
}

// LimpiarEnlaces borra los enlaces vencidos: cada «mandame un link» suma una
// fila que solo se borraba si alguien la usaba. La llama la tarea diaria.
func LimpiarEnlaces(ctx context.Context, db ejecutor) (int64, error) {
	t, err := db.Exec(ctx, `DELETE FROM verification WHERE expires_at < (now() at time zone 'utc')
		AND (identifier LIKE 'enlace:%' OR identifier LIKE 'clave:%')`)
	return t.RowsAffected(), err
}

// Errores del enlace. Vencido y usado se distinguen porque la pantalla dice
// cosas distintas: uno se pide de nuevo, el otro ya entró.
var (
	ErrEnlaceInvalido = errors.New("el enlace no existe o ya se usó")
	ErrEnlaceVencido  = errors.New("el enlace venció")
)

type ejecutor interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func hashDeEnlace(token string) string {
	h := sha256.Sum256([]byte(token))
	return "enlace:" + hex.EncodeToString(h[:])
}

// NuevoEnlace guarda un enlace para la cuenta y devuelve el token, que va en
// /entrar/<token>. `db` puede ser una transacción: el enlace nace con lo que
// lo origina (la aprobación) o no nace.
func NuevoEnlace(ctx context.Context, db ejecutor, userID, proposito string, vence time.Duration, ahora time.Time) (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b[:])
	// Un link nuevo anula los anteriores del mismo tipo: el que se filtró
	// antes deja de servir.
	if _, err := db.Exec(ctx, `DELETE FROM verification WHERE value = $1`, proposito+":"+userID); err != nil {
		return "", err
	}
	// La columna es timestamp sin zona, como la dejó better-auth: va en UTC.
	_, err := db.Exec(ctx, `INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, now(), now())`,
		nuevoID(), hashDeEnlace(token), proposito+":"+userID, ahora.Add(vence).UTC().Format("2006-01-02 15:04:05.999999"))
	return token, err
}

// CrearCuentaSinClave da de alta una cuenta web que solo entra por enlace:
// la del profesional aprobado que pidió el acceso sin registrarse. Sin fila
// en `account`, la clave no existe; puede ponerse una después desde su cuenta.
func CrearCuentaSinClave(ctx context.Context, q *sqlc.Queries, nombre, correo string, ahora time.Time) (string, error) {
	id := nuevoID()
	if err := q.CrearUsuario(ctx, sqlc.CrearUsuarioParams{ID: id, Name: strings.TrimSpace(nombre), Email: normalizarCorreo(correo), CreatedAt: ahora}); err != nil {
		return "", err
	}
	return id, q.CrearPerfilDeCliente(ctx, id)
}

// UsarEnlace consume el enlace y abre la sesión. Devuelve para qué era.
func (s *Servicio) UsarEnlace(ctx context.Context, w http.ResponseWriter, token, ip, agente string) (*Sesion, string, error) {
	var valor string
	var vigente bool
	err := s.pool.QueryRow(ctx, `DELETE FROM verification WHERE identifier = $1
		RETURNING value, expires_at > (now() at time zone 'utc')`, hashDeEnlace(token)).Scan(&valor, &vigente)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrEnlaceInvalido
	}
	if err != nil {
		return nil, "", err
	}
	if !vigente {
		return nil, "", ErrEnlaceVencido
	}
	proposito, userID, ok := strings.Cut(valor, ":")
	if !ok {
		return nil, "", ErrEnlaceInvalido
	}
	sesion, err := s.crearSesion(ctx, s.q, userID, ip, agente, true)
	if err != nil {
		// La cuenta se borró después de mandar el enlace.
		if strings.Contains(err.Error(), "foreign key") {
			return nil, "", ErrEnlaceInvalido
		}
		return nil, "", err
	}
	// Quien entró con un link puede ponerse una clave sin dar la actual
	// durante media hora: es el «olvidé mi clave» y la primera clave de la
	// cuenta que creó la aprobación.
	if _, err := s.pool.Exec(ctx, `INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, now(), now())`, nuevoID(), habilitaClave(sesion), "clave:"+userID,
		s.ahora().Add(VencePonerClave).UTC().Format("2006-01-02 15:04:05.999999")); err != nil {
		return nil, "", err
	}
	s.escribirCookie(w, sesion, true)
	ses, err := s.sesionDe(ctx, sesion)
	return ses, proposito, err
}

// EnlaceDeIngreso arma el enlace de 15 minutos para el correo de una cuenta.
// Si el correo no tiene cuenta devuelve vacío sin error: quien pide no se
// entera de si el correo existe.
func (s *Servicio) EnlaceDeIngreso(ctx context.Context, correo string) (nombre, token string, err error) {
	var userID string
	var personal bool
	err = s.pool.QueryRow(ctx, `SELECT u.id, u.name, coalesce(p.role::text = 'staff', false) FROM "user" u
		LEFT JOIN profiles p ON p.user_id = u.id WHERE u.email = $1`, normalizarCorreo(correo)).Scan(&userID, &nombre, &personal)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil
	}
	if err != nil {
		return "", "", err
	}
	// El personal entra solo con clave: con un link, quien lea el correo del
	// local entraría al panel sin ella. Responde igual que un correo sin
	// cuenta.
	if personal {
		return "", "", nil
	}
	token, err = NuevoEnlace(ctx, s.pool, userID, EnlaceIngreso, VenceIngreso, s.ahora())
	return nombre, token, err
}
