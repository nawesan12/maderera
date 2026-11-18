package auth

import (
	"context"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5"
)

// El PIN de autorización de un administrador (T3, 18/11/2026): lo teclea en
// el mostrador cuando un vendedor vende bajo la lista, anula una venta ajena
// o se pasa del límite de cuenta corriente. Lo verifica
// internal/autorizacion; acá se guarda.
//
// Seis dígitos como mínimo: con cuatro, cinco intentos cada quince minutos
// agotan las diez mil combinaciones en semanas. Dos administradores pueden
// tener el mismo PIN: rechazarlo le contaba a quien carga el suyo cuál es el
// del otro. Si coinciden, la autorización queda a nombre de los dos.

// rePIN son de 6 a 8 dígitos.
var rePIN = regexp.MustCompile(`^\d{6,8}$`)

// PINValido dice si el PIN tiene la forma.
func PINValido(pin string) bool { return rePIN.MatchString(pin) }

// ErrPINInvalido es un PIN sin la forma.
var ErrPINInvalido = errors.New("el PIN son de 6 a 8 números")

// HashearPIN es el hash del PIN, igual que el de la clave (scrypt).
func HashearPIN(pin string) (string, error) { return hashearClave(pin) }

// VerificarPIN compara en tiempo constante.
func VerificarPIN(hash, pin string) (bool, error) { return verificarClave(hash, pin) }

// CargarPIN guarda el PIN del administrador de la sesión. Pide la clave de
// la cuenta (la del panel, no el PIN viejo): quien encuentra la sesión de un
// admin abierta no puede ponerle un PIN propio.
func (s *Servicio) CargarPIN(ctx context.Context, ses *Sesion, clave, pin string) error {
	if !PINValido(pin) {
		return ErrPINInvalido
	}
	fila, err := s.q.CuentaConClave(ctx, ses.Correo)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil && fila.Password != nil {
		ok, err := verificarClave(*fila.Password, clave)
		if err != nil {
			return err
		}
		if !ok {
			return ErrCredenciales
		}
	}
	hash, err := HashearPIN(pin)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `UPDATE "user" SET pin_autorizacion = $2, updated_at = (now() at time zone 'utc') WHERE id = $1`, ses.UserID, hash)
	return err
}
