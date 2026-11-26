// Package autorizacion es la segunda firma sobre la plata (T3, 18/11/2026):
// lo que un vendedor no puede hacer solo —vender por debajo de la lista más
// de lo libre, anular una venta ajena o ya cobrada, pasarse del límite de
// cuenta corriente, respetar los precios de un presupuesto vencido— lo
// destraba el PIN de un administrador, tecleado ahí mismo en el mostrador.
//
// Las reglas:
//
//   - Una sesión de administrador no pide PIN: ya es la firma.
//   - El PIN se prueba contra todos los administradores que lo cargaron (son
//     uno o dos). Si dos tienen el mismo, la autorización queda a nombre de
//     los dos.
//   - Cuentan **solo los errores**: el sexto PIN correcto seguido no bloquea
//     el mostrador. Cinco errores cada quince minutos por sucursal (no por
//     vendedor: con tres cuentas serían quince), y diez en el día para todo
//     el negocio. Al tercer error seguido se avisa a los administradores.
//   - **Si la base falla, no pasa.** Al revés que el límite de los ingresos:
//     un limitador caído acá abriría la caja.
//   - Los errores se cuentan con el pool y no con la transacción de quien
//     pide: la venta rechazada vuelve atrás y el intento tiene que quedar.
//   - **El intento se cuenta antes de probar el PIN**, y se descuenta si era
//     el correcto. Contado después, quinientos pedidos a la vez leían todos
//     «cero errores» mientras el scrypt tardaba, y se probaban quinientos
//     PIN antes de que el tope se enterara.
//   - Un PIN correcto devuelve una ficha de un solo motivo, atada a la clave
//     de la operación y a los montos, que vale dos minutos: si la venta falla
//     después por otra cosa (la caja se cerró, faltó un dato), el vendedor
//     la corrige y reenvía sin volver a llamar al admin, que ya se fue.
//   - Cada PIN que firma le avisa a los administradores: el día que un
//     vendedor aprende el PIN, la primera firma que el admin no hizo salta en
//     el momento, y no recién en el inventario.
package autorizacion

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/sqlc"
)

// Motivo es lo que se autoriza.
type Motivo string

const (
	// Precio: la venta deja de cobrar más que el porcentaje libre.
	Precio Motivo = "precio"
	// Credito: la venta a cuenta corriente pasa el límite o tiene mora.
	Credito Motivo = "credito"
	// Anular: una venta ajena, de otro turno, ya cobrada o cuya mercadería
	// no vuelve.
	Anular Motivo = "anular"
	// Presupuesto: respetar los precios de un presupuesto vencido.
	Presupuesto Motivo = "presupuesto"
	// Remito: anular un remito que ya firmó quien recibió (mes simulado: el
	// depósito lo anulaba con un toque y la mercadería volvía al stock
	// aunque el cliente se la había llevado).
	Remito Motivo = "remito"
)

// Los topes de errores.
const (
	maxPorSucursal   = 5
	ventanaSucursal  = 15 * time.Minute
	maxEnElDia       = 10
	avisoAlError     = 3
	vigenciaDeFicha  = 2 * time.Minute
	claveGlobal      = "pin:todos"
	prefijoSucursal  = "pin:sucursal:"
	prefijoDeUsuario = "pin:usuario:"
	// prefijoAviso marca que el aviso de una ventana ya salió: con pedidos a
	// la vez, «avisar cuando la cuenta llega a tres» se salteaba si dos
	// errores sumaban juntos.
	prefijoAviso = "pin:aviso:"
)

// Pedido es una autorización que hace falta.
type Pedido struct {
	Motivo Motivo
	// Monto es lo que se autoriza (lo dejado de cobrar, lo que se pasa del
	// límite, la venta que se anula).
	Monto float64
	// Credito es lo que va a cuenta corriente pasado el límite cuando la
	// misma venta además deja de cobrar (Motivo Precio): un solo PIN firma
	// las dos cosas, pero el admin ve las dos cifras y la ficha cubre las
	// dos. Antes la ficha del precio destrababa cualquier crédito.
	Credito float64
	// Clave ata la ficha a la operación: la clave de la venta, el id del
	// pedido o del presupuesto.
	Clave string
	// Sucursal es donde se teclea; vacía cuenta por quien pide.
	Sucursal string
	// PIN tecleado, o la Ficha que devolvió un PIN anterior.
	PIN   string
	Ficha string
}

// Firma es quién autorizó.
type Firma struct {
	UserID string
	// Nombre del o los administradores (dos con el mismo PIN firman juntos).
	Nombre string
	// Ficha sirve para reenviar la misma operación sin volver a pedir el PIN.
	Ficha string
}

// Falta es lo que contesta cuando no alcanza: la pantalla muestra el campo
// del PIN al lado del monto, o el bloqueo.
type Falta struct {
	Motivo         Motivo
	Monto          float64
	Credito        float64
	PinIncorrecto  bool
	BloqueadoHasta *time.Time
	// SinAdmins: ningún administrador cargó su PIN todavía.
	SinAdmins bool
}

func (f *Falta) Error() string { return f.Mensaje() }

// Mensaje es lo que lee el vendedor.
func (f *Falta) Mensaje() string {
	switch {
	case f.BloqueadoHasta != nil:
		return "Bloqueado hasta las " + f.BloqueadoHasta.In(argentina).Format("15:04") + "."
	case f.SinAdmins:
		return "Ningún administrador cargó su PIN: se carga desde su menú del panel."
	case f.PinIncorrecto:
		return "PIN incorrecto."
	}
	return "Hace falta el PIN de un administrador."
}

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// Servicio verifica.
type Servicio struct {
	pool  *pgxpool.Pool
	log   *slog.Logger
	clave []byte
	ahora func() time.Time
	// avisar le manda a los administradores el aviso del tercer error.
	avisar func(ctx context.Context, titulo, cuerpo string)
}

// Nuevo arma el servicio. Sin secreto, la clave de las fichas es al azar:
// una ficha vale en el proceso que la dio (las fichas duran dos minutos).
func Nuevo(pool *pgxpool.Pool, log *slog.Logger, secreto string) *Servicio {
	var k []byte
	if secreto != "" {
		m := hmac.New(sha256.New, []byte(secreto))
		m.Write([]byte("mjbj/autorizacion/ficha/v1"))
		k = m.Sum(nil)
	} else {
		k = make([]byte, 32)
		_, _ = rand.Read(k)
	}
	return &Servicio{pool: pool, log: log, clave: k, ahora: time.Now}
}

// ConAvisos le da cómo avisar a los administradores (push).
func (s *Servicio) ConAvisos(f func(ctx context.Context, titulo, cuerpo string)) *Servicio {
	s.avisar = f
	return s
}

// Avisar le manda un aviso a los administradores por el mismo canal que el
// de los errores (lo usa el drenaje de la cola sin conexión).
func (s *Servicio) Avisar(ctx context.Context, titulo, cuerpo string) {
	if s.avisar != nil {
		s.avisar(context.WithoutCancel(ctx), titulo, cuerpo)
	}
}

// ConReloj es para las pruebas.
func (s *Servicio) ConReloj(f func() time.Time) *Servicio {
	s.ahora = f
	return s
}

// Exigir devuelve quién autoriza, o un *Falta. Un error que no sea *Falta es
// de la base: la operación no sigue.
func (s *Servicio) Exigir(ctx context.Context, ses *auth.Sesion, p Pedido) (*Firma, error) {
	if ses.Tiene(sqlc.StaffRoleAdmin) {
		return &Firma{UserID: ses.UserID, Nombre: ses.Nombre}, nil
	}
	falta := &Falta{Motivo: p.Motivo, Monto: p.Monto, Credito: p.Credito}
	if p.Ficha != "" {
		if f, ok, err := s.leerFicha(ctx, p); err != nil {
			return nil, err
		} else if ok {
			return f, nil
		}
	}
	if p.PIN == "" {
		return nil, falta
	}

	ahora := s.ahora()
	// La sucursal la dice quien pide: una que no existe contaría en una
	// ventana propia, y cambiándola se esquivaría el tope. Sin una sucursal
	// de verdad, cuenta por la persona.
	sujeto := prefijoDeUsuario + ses.UserID
	if p.Sucursal != "" {
		var existe bool
		if err := s.pool.QueryRow(ctx, `SELECT exists(SELECT 1 FROM branches WHERE id::text = $1)`, p.Sucursal).Scan(&existe); err != nil {
			return nil, err
		}
		if existe {
			sujeto = prefijoSucursal + p.Sucursal
		}
	}
	vSuc, finSuc := ventanaFija(ahora, ventanaSucursal)
	vDia, finDia := ventanaDelDia(ahora)
	// El tope del día se lee primero: si ya está, no se cuenta nada más.
	delDia, err := s.cuenta(ctx, claveGlobal, vDia)
	if err != nil {
		return nil, err
	}
	if delDia >= maxEnElDia {
		falta.BloqueadoHasta = &finDia
		return nil, falta
	}

	admins, err := s.adminsConPIN(ctx)
	if err != nil {
		return nil, err
	}
	if len(admins) == 0 {
		falta.SinAdmins = true
		return nil, falta
	}

	// El intento cuenta antes de verificar (INSERT … ON CONFLICT … RETURNING,
	// atómico): el que llega pasado el tope se rechaza sin probar el PIN.
	errores, err := s.sumar(ctx, sujeto, vSuc)
	if err != nil {
		return nil, err
	}
	if errores > maxPorSucursal {
		falta.BloqueadoHasta = &finSuc
		return nil, falta
	}
	if delDia, err = s.sumar(ctx, claveGlobal, vDia); err != nil {
		return nil, err
	}
	if delDia > maxEnElDia {
		falta.BloqueadoHasta = &finDia
		return nil, falta
	}

	var ids, nombres []string
	if auth.PINValido(p.PIN) {
		for _, a := range admins {
			ok, err := auth.VerificarPIN(a.hash, p.PIN)
			if err != nil {
				s.log.Warn("autorizacion: hash de PIN ilegible", "usuario", a.id, "error", err)
				continue
			}
			if ok {
				ids = append(ids, a.id)
				nombres = append(nombres, a.nombre)
			}
		}
	}
	if len(ids) == 0 {
		// Con >= y una marca por ventana, no con == : dos errores que suman
		// juntos pueden saltear el número exacto.
		if delDia >= maxEnElDia && s.primeraVez(ctx, prefijoAviso+"dia", vDia) {
			s.avisarErrores(ctx, ses, errores, delDia)
		} else if errores >= avisoAlError && s.primeraVez(ctx, prefijoAviso+sujeto, vSuc) {
			s.avisarErrores(ctx, ses, errores, delDia)
		}
		falta.PinIncorrecto = true
		switch {
		case delDia >= maxEnElDia:
			falta.BloqueadoHasta = &finDia
		case errores >= maxPorSucursal:
			falta.BloqueadoHasta = &finSuc
		}
		return nil, falta
	}
	// Acertó: el intento no era un error. Los seguidos de la sucursal vuelven
	// a cero (y su aviso, a poder salir); el del día se descuenta, porque es
	// el techo de errores para todo el negocio.
	if _, err := s.pool.Exec(ctx, `DELETE FROM rate_limits WHERE clave = ANY($1) AND ventana = $2`,
		[]string{sujeto, prefijoAviso + sujeto}, vSuc); err != nil {
		return nil, err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE rate_limits SET cuenta = cuenta - 1 WHERE clave = $1 AND ventana = $2 AND cuenta > 0`,
		claveGlobal, vDia); err != nil {
		return nil, err
	}
	f := &Firma{UserID: ids[0], Nombre: strings.Join(nombres, " y ")}
	f.Ficha = s.ficha(p, f.UserID, ahora.Add(vigenciaDeFicha))
	s.avisarFirma(ctx, ses, p, f.Nombre)
	return f, nil
}

// primeraVez dice si es la primera vez que se marca esa clave en la ventana:
// el aviso sale una sola vez aunque los errores lleguen juntos.
func (s *Servicio) primeraVez(ctx context.Context, clave string, ventana time.Time) bool {
	n, err := s.sumar(ctx, clave, ventana)
	if err != nil {
		s.log.Warn("autorizacion: marca del aviso", "error", err)
		return true
	}
	return n == 1
}

// QueSeAutoriza es la cifra en el idioma del mostrador, la misma que muestra
// el campo del PIN (components/autorizacion/campo-pin.tsx).
func QueSeAutoriza(motivo Motivo, monto, credito float64) string {
	m := formato.MonedaEntera(monto)
	var t string
	switch motivo {
	case Credito:
		t = m + " a cuenta, pasado el límite"
	case Anular:
		t = "anular " + m
	case Remito:
		t = "anular un remito firmado"
	default:
		t = m + " abajo del precio"
	}
	if credito > 0 {
		t += " · " + formato.MonedaEntera(credito) + " a cuenta, pasado el límite"
	}
	return t
}

// avisarFirma le cuenta a los administradores cada PIN que firmó: quién lo
// pidió, qué y a nombre de quién. Un PIN aprendido no se detecta por los
// errores, se detecta cuando firma algo que su dueño no firmó.
func (s *Servicio) avisarFirma(ctx context.Context, ses *auth.Sesion, p Pedido, admin string) {
	cuerpo := fmt.Sprintf("%s usó el PIN de %s: %s.", ses.Nombre, admin, QueSeAutoriza(p.Motivo, p.Monto, p.Credito))
	s.log.Info("autorizacion: firmó con PIN", "usuario", ses.UserID, "motivo", p.Motivo, "monto", p.Monto, "clave", p.Clave)
	if s.avisar != nil {
		s.avisar(context.WithoutCancel(ctx), "Autorización con PIN", cuerpo)
	}
}

type admin struct{ id, nombre, hash string }

// adminsConPIN son los administradores con PIN cargado.
func (s *Servicio) adminsConPIN(ctx context.Context) ([]admin, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT u.id, u.name, u.pin_autorizacion FROM "user" u
		JOIN profiles p ON p.user_id = u.id AND p.role = 'staff' AND p.staff_role = 'admin'
		WHERE u.pin_autorizacion IS NOT NULL ORDER BY u.created_at, u.id`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	var out []admin
	for filas.Next() {
		var a admin
		if err := filas.Scan(&a.id, &a.nombre, &a.hash); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, filas.Err()
}

// HayAdminConPIN dice si alguno lo cargó: sin ninguno, todo lo que pide
// autorización queda trabado, y el inicio del panel lo avisa.
func HayAdminConPIN(ctx context.Context, c interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) (bool, error) {
	var hay bool
	err := c.QueryRow(ctx, `SELECT exists(SELECT 1 FROM "user" u
		JOIN profiles p ON p.user_id = u.id AND p.role = 'staff' AND p.staff_role = 'admin'
		WHERE u.pin_autorizacion IS NOT NULL)`).Scan(&hay)
	return hay, err
}

// cuenta lee sin sumar.
func (s *Servicio) cuenta(ctx context.Context, clave string, ventana time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT coalesce(max(cuenta), 0)::int FROM rate_limits WHERE clave = $1 AND ventana = $2`, clave, ventana).Scan(&n)
	return n, err
}

// sumar cuenta un error.
func (s *Servicio) sumar(ctx context.Context, clave string, ventana time.Time) (int, error) {
	n, err := sqlc.New(s.pool).ContarIntento(ctx, sqlc.ContarIntentoParams{Clave: clave, Ventana: ventana})
	return int(n), err
}

func (s *Servicio) avisarErrores(ctx context.Context, ses *auth.Sesion, seguidos, delDia int) {
	cuerpo := fmt.Sprintf("%s erró el PIN %d veces seguidas.", ses.Nombre, seguidos)
	if delDia >= maxEnElDia {
		cuerpo = fmt.Sprintf("%d errores de PIN hoy: las autorizaciones quedan bloqueadas hasta mañana o hasta que un admin las destrabe. El último lo tecleó %s.", delDia, ses.Nombre)
	}
	s.log.Warn("autorizacion: errores de PIN", "usuario", ses.UserID, "seguidos", seguidos, "delDia", delDia)
	if s.avisar != nil {
		s.avisar(context.WithoutCancel(ctx), "PIN de autorización", cuerpo)
	}
}

// ventanaFija es la del limitador: cortes fijos desde la época.
func ventanaFija(t time.Time, v time.Duration) (inicio, fin time.Time) {
	ms := v.Milliseconds()
	inicio = time.UnixMilli(t.UnixMilli() / ms * ms).UTC()
	return inicio, inicio.Add(v)
}

// ventanaDelDia es el día argentino.
func ventanaDelDia(t time.Time) (inicio, fin time.Time) {
	a := t.In(argentina)
	inicio = time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, argentina)
	return inicio.UTC(), inicio.AddDate(0, 0, 1)
}

/* --------------------------------- fichas --------------------------------- */

// centavos del monto: la ficha cubre hasta ese monto.
func centavos(m float64) int64 { return int64(jsmath.Round(m * 100)) }

func (s *Servicio) mac(motivo Motivo, clave string, monto, credito int64, vence int64, usuario string) string {
	m := hmac.New(sha256.New, s.clave)
	m.Write([]byte("v2|" + string(motivo) + "|" + clave + "|" + strconv.FormatInt(monto, 10) + "|" + strconv.FormatInt(credito, 10) +
		"|" + strconv.FormatInt(vence, 10) + "|" + usuario))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// ficha es «v2.<monto en centavos>.<crédito en centavos>.<vence>.<usuario en
// base64>.<mac>». La v1 no llevaba el crédito: una ficha del precio cubría
// cualquier pase del límite que apareciera después.
func (s *Servicio) ficha(p Pedido, usuario string, vence time.Time) string {
	monto, credito, v := centavos(p.Monto), centavos(p.Credito), vence.Unix()
	return strings.Join([]string{"v2", strconv.FormatInt(monto, 10), strconv.FormatInt(credito, 10), strconv.FormatInt(v, 10),
		base64.RawURLEncoding.EncodeToString([]byte(usuario)), s.mac(p.Motivo, p.Clave, monto, credito, v, usuario)}, ".")
}

// leerFicha: del mismo motivo, la misma operación, vigente y por montos que
// cubran los que se piden. El administrador tiene que seguir siéndolo.
func (s *Servicio) leerFicha(ctx context.Context, p Pedido) (*Firma, bool, error) {
	partes := strings.Split(p.Ficha, ".")
	if len(partes) != 6 || partes[0] != "v2" {
		return nil, false, nil
	}
	monto, err1 := strconv.ParseInt(partes[1], 10, 64)
	credito, err2 := strconv.ParseInt(partes[2], 10, 64)
	vence, err3 := strconv.ParseInt(partes[3], 10, 64)
	usuario, err4 := base64.RawURLEncoding.DecodeString(partes[4])
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
		return nil, false, nil
	}
	if !hmac.Equal([]byte(partes[5]), []byte(s.mac(p.Motivo, p.Clave, monto, credito, vence, string(usuario)))) {
		return nil, false, nil
	}
	if s.ahora().Unix() > vence || centavos(p.Monto) > monto || centavos(p.Credito) > credito {
		return nil, false, nil
	}
	var nombre string
	err := s.pool.QueryRow(ctx, `SELECT u.name FROM "user" u JOIN profiles p ON p.user_id = u.id
		WHERE u.id = $1 AND p.role = 'staff' AND p.staff_role = 'admin' AND u.pin_autorizacion IS NOT NULL`, string(usuario)).Scan(&nombre)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &Firma{UserID: string(usuario), Nombre: nombre, Ficha: p.Ficha}, true, nil
}
