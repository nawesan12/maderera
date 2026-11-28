package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// El personal desde el panel (mes simulado, H006): la dueña no tenía dónde
// darle usuario a un empleado nuevo ni cambiarle el rol; solo se hacía desde
// la terminal (mjbj usuario staff). La pantalla es /admin/personal y la
// bitácora la anota internal/clientes, que es quien llama (auth no puede
// importar la bitácora).
//
// El personal entra **solo con clave** (UsarEnlace rechaza los links de una
// cuenta del personal), así que el alta lleva la contraseña inicial, que la
// persona cambia después desde Mi cuenta.

// Persona es alguien del personal.
type Persona struct {
	ID     string         `json:"id"`
	Nombre string         `json:"nombre"`
	Correo string         `json:"correo"`
	Rol    sqlc.StaffRole `json:"rol"`
}

// ListarPersonal es el personal por puesto y nombre.
func ListarPersonal(ctx context.Context, db interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}) ([]Persona, error) {
	rs, err := db.Query(ctx, `
		SELECT u.id, u.name, u.email, p.staff_role
		FROM "user" u JOIN profiles p ON p.user_id = u.id
		WHERE p.role = 'staff' AND p.staff_role IS NOT NULL
		ORDER BY array_position(ARRAY['admin', 'vendedor', 'deposito', 'aserradero']::staff_role[], p.staff_role), u.name, u.id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rs, func(r pgx.CollectableRow) (Persona, error) {
		var x Persona
		return x, r.Scan(&x.ID, &x.Nombre, &x.Correo, &x.Rol)
	})
}

// AltaDePersonal da de alta a alguien del personal dentro de tx. Si el correo
// ya tiene cuenta (una de cliente), se la hace del personal **sin tocarle la
// clave**: pisarla dejaría a esa persona afuera de su propia cuenta. Devuelve
// el id y si entra con la clave que ya tenía.
func AltaDePersonal(ctx context.Context, tx pgx.Tx, correo, nombre, clave string, rol sqlc.StaffRole, ahora time.Time) (string, bool, error) {
	if !rol.Valid() {
		return "", false, plataforma.Invalido(map[string]string{"rol": "Elegí el puesto."})
	}
	nombre = strings.TrimSpace(nombre)
	if utf8.RuneCountInString(nombre) < 2 {
		return "", false, plataforma.Invalido(map[string]string{"nombre": "Poné el nombre."})
	}
	correo = normalizarCorreo(correo)
	if !strings.Contains(correo, "@") || strings.ContainsAny(correo, " ,;") {
		return "", false, plataforma.Invalido(map[string]string{"correo": "Ese correo no es válido."})
	}
	q := sqlc.New(tx)
	// Sin clave, la cuenta nace sin ella: la elige la persona con el link del
	// alta (EnlaceClavePersonal; recorrido, M4-006).
	ponerClave := func(id string) error {
		if clave == "" {
			return nil
		}
		if utf8.RuneCountInString(clave) < 8 {
			return plataforma.Invalido(map[string]string{"clave": "La contraseña necesita 8 caracteres o más."})
		}
		hash, err := hashearClave(clave)
		if err != nil {
			return err
		}
		return q.CrearCuentaConClave(ctx, sqlc.CrearCuentaConClaveParams{ID: nuevoID(), AccountID: id, Password: &hash, CreatedAt: ahora})
	}
	previo, err := q.UsuarioPorCorreo(ctx, correo)
	var id string
	conSuClave := false
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		id = nuevoID()
		if err := q.CrearUsuario(ctx, sqlc.CrearUsuarioParams{ID: id, Name: nombre, Email: correo, CreatedAt: ahora}); err != nil {
			return "", false, err
		}
		if err := ponerClave(id); err != nil {
			return "", false, err
		}
		if err := q.CrearPerfilDeCliente(ctx, id); err != nil {
			return "", false, err
		}
	case err != nil:
		return "", false, err
	default:
		id = previo.ID
		var yaEs bool
		if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM profiles WHERE user_id = $1 AND role = 'staff')`, id).Scan(&yaEs); err != nil {
			return "", false, err
		}
		if yaEs {
			return "", false, plataforma.Invalido(map[string]string{"correo": "Ya es del personal."})
		}
		if previo.ConClave {
			conSuClave = true
		} else if err := ponerClave(id); err != nil {
			return "", false, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, id); err != nil {
			return "", false, err
		}
	}
	return id, conSuClave, q.HacerStaff(ctx, sqlc.HacerStaffParams{UserID: id, StaffRole: &rol})
}

// CambiarPuesto cambia el rol de alguien del personal dentro de tx. Nadie se
// cambia el suyo (un admin que se saca el rol se queda afuera de esta misma
// pantalla) y siempre queda un admin.
func CambiarPuesto(ctx context.Context, tx pgx.Tx, quien *Sesion, userID string, rol sqlc.StaffRole) (string, error) {
	if !rol.Valid() {
		return "", plataforma.Invalido(map[string]string{"rol": "Elegí el puesto."})
	}
	if userID == quien.UserID {
		return "", plataforma.Invalido(map[string]string{"rol": "El tuyo lo cambia otro admin."})
	}
	nombre, actual, err := delPersonal(ctx, tx, userID)
	if err != nil {
		return "", err
	}
	if actual == sqlc.StaffRoleAdmin && rol != sqlc.StaffRoleAdmin {
		if err := quedaOtroAdmin(ctx, tx, userID); err != nil {
			return "", err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE profiles SET staff_role = $2, updated_at = now() WHERE user_id = $1`, userID, rol)
	return nombre, err
}

// BajaDePersonal saca a alguien del personal dentro de tx: la cuenta queda
// como de cliente (lo que firmó sigue a su nombre en la bitácora) y se cierran
// sus sesiones, así el panel deja de abrirse en el teléfono que tenga.
func BajaDePersonal(ctx context.Context, tx pgx.Tx, quien *Sesion, userID string) (string, error) {
	if userID == quien.UserID {
		return "", plataforma.Invalido(map[string]string{"id": "Tu baja la da otro admin."})
	}
	nombre, actual, err := delPersonal(ctx, tx, userID)
	if err != nil {
		return "", err
	}
	if actual == sqlc.StaffRoleAdmin {
		if err := quedaOtroAdmin(ctx, tx, userID); err != nil {
			return "", err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE profiles SET role = 'cliente', staff_role = NULL, updated_at = now() WHERE user_id = $1`, userID); err != nil {
		return "", err
	}
	// El PIN de un admin dado de baja no autoriza nada más.
	if _, err := tx.Exec(ctx, `UPDATE "user" SET pin_autorizacion = NULL WHERE id = $1`, userID); err != nil {
		return "", err
	}
	// La clave del personal deja de abrir la cuenta: antes la persona dada de
	// baja seguía entrando con ella y caía en Mi cuenta como cliente
	// (simulación del mes). Si además es cliente, entra por el enlace a su
	// correo, que UsarEnlace ya no le rechaza; si vuelve al personal, el alta
	// le pide una clave nueva.
	if _, err := tx.Exec(ctx, `DELETE FROM account WHERE user_id = $1 AND provider_id = 'credential'`, userID); err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `DELETE FROM session WHERE user_id = $1`, userID)
	return nombre, err
}

func delPersonal(ctx context.Context, tx pgx.Tx, userID string) (string, sqlc.StaffRole, error) {
	var nombre string
	var rol sqlc.StaffRole
	err := tx.QueryRow(ctx, `SELECT u.name, p.staff_role FROM "user" u JOIN profiles p ON p.user_id = u.id
		WHERE u.id = $1 AND p.role = 'staff' AND p.staff_role IS NOT NULL FOR UPDATE OF p`, userID).Scan(&nombre, &rol)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", plataforma.NuevoProblema(http.StatusNotFound, "No es del personal.")
	}
	return nombre, rol, err
}

// quedaOtroAdmin: sin ningún admin, nadie puede volver a entrar a Personal
// ni cargar un PIN. Se bloquean los perfiles de los admins para que dos bajas
// a la vez no dejen cero.
func quedaOtroAdmin(ctx context.Context, tx pgx.Tx, userID string) error {
	var otros int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM (SELECT 1 FROM profiles
		WHERE role = 'staff' AND staff_role = 'admin' AND user_id <> $1 FOR UPDATE) x`, userID).Scan(&otros); err != nil {
		return err
	}
	if otros == 0 {
		return plataforma.Invalido(map[string]string{"rol": "Es el único admin: primero dale el puesto a otra persona."})
	}
	return nil
}
