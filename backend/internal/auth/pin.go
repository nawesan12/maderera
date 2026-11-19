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

// ErrSinClave es una cuenta que entra solo por link: no tiene con qué probar
// que quien carga el PIN es su dueño.
var ErrSinClave = errors.New("la cuenta no tiene contraseña")

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
	if err := s.probarClave(ctx, ses, clave); err != nil {
		return err
	}
	hash, err := HashearPIN(pin)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `UPDATE "user" SET pin_autorizacion = $2, updated_at = (now() at time zone 'utc') WHERE id = $1`, ses.UserID, hash)
	return err
}

// probarClave verifica la contraseña de la cuenta de la sesión. Sin
// contraseña no hay prueba: antes se salteaba la verificación, y quien
// encontraba abierta la sesión de un admin que entra por link le ponía un
// PIN propio y se autorizaba solo desde su cuenta, mucho después de cerrada
// la del admin.
func (s *Servicio) probarClave(ctx context.Context, ses *Sesion, clave string) error {
	fila, err := s.q.CuentaConClave(ctx, ses.Correo)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && fila.Password == nil) {
		return ErrSinClave
	}
	if err != nil {
		return err
	}
	ok, err := verificarClave(*fila.Password, clave)
	if err != nil {
		return err
	}
	if !ok {
		return ErrCredenciales
	}
	return nil
}

// DestrabarPIN borra los topes de errores del PIN (los de cada sucursal y el
// del día, internal/autorizacion): diez errores de cualquiera, por bronca o
// por dedos torpes, trababan todas las autorizaciones del negocio hasta la
// medianoche, y el admin no tenía cómo destrabarlas sin atender él con su
// sesión. Pide la contraseña, como cargar el PIN.
func (s *Servicio) DestrabarPIN(ctx context.Context, ses *Sesion, clave string) error {
	if err := s.probarClave(ctx, ses, clave); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM rate_limits WHERE clave LIKE 'pin:%'`)
	return err
}
