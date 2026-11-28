package entregas

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/autorizacion"
	"mjbj/internal/cobros"
	"mjbj/internal/plataforma"
	"mjbj/internal/reglas"
	"mjbj/internal/roles"
	"mjbj/internal/ventas/fragmentos"
)

// Soltar mercadería sin cobrar (mes simulado 2, M2S1-018 y M2S1-019): el
// depósito entregaba $ 836.680 sin cobrar con un toque, y despachaba un
// envío de $ 481.900 a una clienta con un límite de $ 300.000 sin que nadie
// lo preguntara. Ahora la salida de un pedido que debe algo fuera de la
// cuenta corriente pide el PIN de un admin:
//
//   - Siempre a quien no maneja plata (el depósito): no puede cobrar, así
//     que tampoco decide fiar.
//   - Con la regla entregar_sin_cobrar en «fuera_de_la_cuenta», también a
//     quien vende si el cliente no tiene cuenta corriente o la deuda pasa
//     su límite.
//
// El admin firma con su sesión (autorizacion.Exigir). Lo que va a cuenta
// corriente ya pasó el límite al crear el pedido: no se pregunta de nuevo.

// SalidaSinCobrar es el PIN (o la ficha de uno anterior) que trae quien
// suelta la mercadería.
type SalidaSinCobrar struct {
	PIN, Ficha string
}

// AutorizarSinCobrar controla la salida de la mercadería de un pedido con
// algo sin cobrar. Devuelve el nombre de quien autorizó ("" si no hizo
// falta o firmó quien la suelta) o el 422 con el PIN que falta.
func AutorizarSinCobrar(ctx context.Context, tx pgx.Tx, aut *autorizacion.Servicio, ses *auth.Sesion, pedido string, a SalidaSinCobrar) (string, error) {
	if ses == nil {
		return "", nil
	}
	var sinCobrar *float64
	var cliente, sucursal *string
	var contraEntrega bool
	err := tx.QueryRow(ctx, `SELECT `+fragmentos.SinCobrarDelPedido+`::float8, o.customer_id::text, o.branch_id::text,
		o.tipo_entrega = 'envio' AND o.medio_pago = 'efectivo'
		FROM orders o WHERE o.id = $1`, pedido).Scan(&sinCobrar, &cliente, &sucursal, &contraEntrega)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if sinCobrar == nil || *sinCobrar <= 0.005 {
		return "", nil
	}
	pide := ses.EsStaff() && !ses.Tiene(roles.ManejanPlata...)
	// El envío en efectivo lo cobra el chofer en la puerta (M4-078): con la
	// regla en «sin_pin» el depósito lo despacha sin el PIN, y sigue «A
	// cobrar» en el reparto hasta que se registre el cobro.
	if pide && contraEntrega && reglas.Es(ctx, tx, reglas.DespachoContraEntrega, "sin_pin") {
		pide = false
	}
	if !pide && reglas.Es(ctx, tx, reglas.EntregarSinCobrar, "fuera_de_la_cuenta") {
		if cliente == nil {
			pide = true
		} else {
			motivo, err := cobros.LimiteEnLaTransaccion(ctx, tx, *cliente, *sinCobrar)
			if err != nil {
				return "", err
			}
			pide = motivo != ""
		}
	}
	if !pide {
		return "", nil
	}
	if aut == nil {
		return "", plataforma.NuevoProblema(http.StatusForbidden, "Lo que no se cobró lo entrega un administrador.")
	}
	donde := ""
	if sucursal != nil {
		donde = *sucursal
	}
	firma, err := aut.Exigir(ctx, ses, autorizacion.Pedido{Motivo: autorizacion.SinCobrar, Monto: *sinCobrar, Clave: pedido,
		Sucursal: donde, PIN: a.PIN, Ficha: a.Ficha})
	var falta *autorizacion.Falta
	if errors.As(err, &falta) {
		return "", FaltaElPIN(falta)
	}
	if err != nil {
		return "", err
	}
	// Quién firmó queda en el pedido (M4-114): se descartaba, y ni el
	// historial ni «El personal» sabían quién había soltado la mercadería.
	// El admin que despacha él mismo no se autoriza a sí mismo.
	if firma.UserID == ses.UserID {
		return "", nil
	}
	if firma.UserID != "" {
		if _, err := tx.Exec(ctx, `UPDATE orders SET salida_autorizada_por = $2, salida_sin_cobrar = $3::numeric, salida_autorizada_at = now() WHERE id = $1`,
			pedido, firma.UserID, fijo2(*sinCobrar)); err != nil {
			return "", err
		}
	}
	return firma.Nombre, nil
}

// FaltaElPIN es el 422 con lo que la pantalla necesita para pedir el PIN
// (todas las claves empiezan con «pin»: el mensaje va primero).
func FaltaElPIN(f *autorizacion.Falta) error {
	e := map[string]string{"pin": f.Mensaje(), "pinMonto": jsFijo2(f.Monto), "pinMotivo": string(f.Motivo)}
	if f.PinIncorrecto {
		e["pinIncorrecto"] = "si"
	}
	if f.ConClave {
		e["pinConClave"] = "si"
	}
	if f.SinAdmins {
		e["pinSinAdmins"] = "si"
	}
	if f.BloqueadoHasta != nil {
		e["pinHasta"] = f.BloqueadoHasta.UTC().Format(time.RFC3339)
	}
	return plataforma.Invalido(e)
}

func jsFijo2(x float64) string { return fijo2(x) }
