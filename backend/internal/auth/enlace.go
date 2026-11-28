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
	"unicode/utf8"

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
	// EnlaceClavePersonal es el del alta del personal (recorrido, M4-006): la
	// persona elige su contraseña y nadie más la conoce. No abre sesión: el
	// personal entra solo con clave, y con este link solo se pone una.
	EnlaceClavePersonal = "clave_personal"

	VenceActivacion = 7 * 24 * time.Hour
	VenceIngreso    = 15 * time.Minute
	VencePonerClave = 30 * time.Minute
	// VenceClavePersonal: tres días, lo que tarda en llegarle a quien entra
	// a trabajar el lunes.
	VenceClavePersonal = 72 * time.Hour
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
	// El de la clave del personal no abre sesión, y probarlo acá no lo gasta.
	err := s.pool.QueryRow(ctx, `DELETE FROM verification WHERE identifier = $1 AND value NOT LIKE $2
		RETURNING value, expires_at > (now() at time zone 'utc')`, hashDeEnlace(token), EnlaceClavePersonal+":%").Scan(&valor, &vigente)
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
	// El personal entra solo con clave. Se mira al emitir y otra vez acá: una
	// cuenta que pasó a ser del personal con un link de activación vigente
	// (7 días) abría el panel sin clave.
	var personal bool
	if err := s.pool.QueryRow(ctx, `SELECT exists(SELECT 1 FROM profiles WHERE user_id = $1 AND role = 'staff')`, userID).Scan(&personal); err != nil {
		return nil, "", err
	}
	if personal {
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

// ErrClaveCorta es la contraseña de menos de 8 caracteres.
var ErrClaveCorta = errors.New("la contraseña necesita 8 caracteres o más")

// PonerClaveConEnlace consume el link del alta del personal y le pone la
// contraseña que eligió la persona. No abre sesión: después entra con su
// correo y esa clave. Un link de otro tipo no sirve, ni el de alguien que ya
// no es del personal.
func (s *Servicio) PonerClaveConEnlace(ctx context.Context, token, clave string) (correo string, err error) {
	if utf8.RuneCountInString(clave) < 8 {
		return "", ErrClaveCorta
	}
	hash, err := hashearClave(clave)
	if err != nil {
		return "", err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var valor string
		var vigente bool
		err := tx.QueryRow(ctx, `DELETE FROM verification WHERE identifier = $1 AND value LIKE $2
			RETURNING value, expires_at > (now() at time zone 'utc')`, hashDeEnlace(token), EnlaceClavePersonal+":%").Scan(&valor, &vigente)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrEnlaceInvalido
		}
		if err != nil {
			return err
		}
		if !vigente {
			return ErrEnlaceVencido
		}
		userID := strings.TrimPrefix(valor, EnlaceClavePersonal+":")
		var personal bool
		if err := tx.QueryRow(ctx, `SELECT u.email, exists(SELECT 1 FROM profiles p WHERE p.user_id = u.id AND p.role = 'staff')
			FROM "user" u WHERE u.id = $1`, userID).Scan(&correo, &personal); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrEnlaceInvalido
			}
			return err
		}
		if !personal {
			return ErrEnlaceInvalido
		}
		if _, err := tx.Exec(ctx, `DELETE FROM account WHERE user_id = $1 AND provider_id = 'credential'`, userID); err != nil {
			return err
		}
		return sqlc.New(tx).CrearCuentaConClave(ctx, sqlc.CrearCuentaConClaveParams{ID: nuevoID(), AccountID: userID, Password: &hash, CreatedAt: s.ahora()})
	})
	if err != nil {
		// Vencido o inválido, el link ya no está: la transacción volvió atrás
		// el DELETE, así que se borra aparte (no sirve más).
		if errors.Is(err, ErrEnlaceVencido) {
			_, _ = s.pool.Exec(ctx, `DELETE FROM verification WHERE identifier = $1`, hashDeEnlace(token))
		}
		return "", err
	}
	return correo, nil
}
