package mostrador

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/caja"
	"mjbj/internal/jsmath"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
	"mjbj/internal/zodjs"
)

// Las acciones de caja del mostrador (abrirCaja, registrarMovimientoDeCaja,
// cerrarCaja de app/mostrador/actions.ts) y el movimiento que llega de la
// cola sin conexión. Devuelven el mensaje para la pantalla, o un rechazo con
// su motivo (Rechazo), igual que el EstadoMostrador del TS.

// Rechazo es un «error» de EstadoMostrador: un motivo para mostrar.
type Rechazo struct{ Mensaje string }

func (r *Rechazo) Error() string { return r.Mensaje }

func rechazo(m string) error { return &Rechazo{m} }

func (s *Servicio) anotar(ctx context.Context, ses *auth.Sesion, accion sqlc.AccionAuditoria, entidad, id, descripcion string, detalle any) {
	bitacora.Anotar(ctx, sqlc.New(s.pool), s.log, ses, accion, entidad, id, descripcion, detalle)
}

func f2(n float64) string { return jsmath.Fijo2(n) }

// AbrirCaja abre el turno con su fondo (como movimiento «apertura»). Abrir
// con menos que la base de cambio se puede, pero se avisa.
func (s *Servicio) AbrirCaja(ctx context.Context, ses *auth.Sesion, sucursal string, fondo float64) (string, error) {
	if math.IsNaN(fondo) || math.IsInf(fondo, 0) || fondo < 0 {
		return "", rechazo("El fondo inicial no puede ser negativo.")
	}
	base, err := caja.FondoBase(ctx, s.pool, sucursal)
	if err != nil {
		return "", err
	}
	faltaCambio := base > 0 && fondo < base
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var sesion string
		if err := tx.QueryRow(ctx, `INSERT INTO cash_sessions (branch_id, abierta_por) VALUES ($1, $2) RETURNING id`, sucursal, ses.UserID).Scan(&sesion); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO cash_movements (session_id, tipo, monto, motivo, creado_por) VALUES ($1, 'apertura', $2::numeric, 'Fondo inicial', $3)`,
			sesion, f2(fondo), ses.UserID)
		return err
	})
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.ConstraintName == "cash_sessions_una_abierta_por_sucursal" {
		return "", rechazo("Ya hay una caja abierta en esta sucursal.")
	}
	if err != nil {
		return "", err
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "caja", "", "Abrió la caja con un fondo de $"+f2(fondo), nil)
	if faltaCambio {
		return "Caja abierta, pero el fondo quedó por debajo de la base de $" + f2(base) + ". Reponé el cambio.", nil
	}
	return "Caja abierta.", nil
}

// MovimientoDeCaja es un ingreso o un retiro desde el mostrador. Un retiro
// no puede dejar el cajón por debajo del fondo de cambio.
func (s *Servicio) MovimientoDeCaja(ctx context.Context, ses *auth.Sesion, sesion, tipo string, monto float64, motivo string) (string, error) {
	if math.IsNaN(monto) || math.IsInf(monto, 0) || monto <= 0 {
		return "", rechazo("El monto tiene que ser mayor a cero.")
	}
	motivo = zodjs.TrimJS(motivo)
	if motivo == "" {
		return "", rechazo("Poné el motivo: un movimiento sin explicación no se puede revisar después.")
	}
	if tipo == "retiro" {
		var esperado, base jsmath.Num
		err := s.pool.QueryRow(ctx, `
			SELECT coalesce(sum(m.monto), 0), b.fondo_base
			FROM cash_sessions s JOIN branches b ON b.id = s.branch_id
			LEFT JOIN cash_movements m ON m.session_id = s.id
			WHERE s.id::text = $1 GROUP BY s.id, b.fondo_base LIMIT 1`, sesion).Scan(&esperado, &base)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		enCaja := esperado.F()
		if base.F() > 0 && enCaja-monto < base.F() {
			disponible := math.Max(0, enCaja-base.F())
			if disponible > 0 {
				return "", rechazo("Ese retiro deja el cajón sin el cambio de la base ($" + f2(base.F()) + "). Podés retirar hasta $" + f2(disponible) + ".")
			}
			return "", rechazo("No se puede retirar: en el cajón hay $" + f2(enCaja) + " y la base de cambio es $" + f2(base.F()) + ".")
		}
	}
	firmado := monto
	if tipo == "retiro" {
		firmado = -monto
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO cash_movements (session_id, tipo, monto, motivo, creado_por) VALUES ($1, $2, $3::numeric, $4, $5)`,
		sesion, tipo, f2(firmado), motivo, ses.UserID); err != nil {
		return "", err
	}
	verbo := "Ingresó"
	if tipo == "retiro" {
		verbo = "Retiró"
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "caja", "", verbo+" $"+f2(monto)+": "+motivo, nil)
	if tipo == "retiro" {
		return "Retiro registrado.", nil
	}
	return "Ingreso registrado.", nil
}

// CerrarCaja hace el arqueo: no se cierra con ventas colgando en una caja
// física, ni con una diferencia sin explicar.
func (s *Servicio) CerrarCaja(ctx context.Context, ses *auth.Sesion, sesion string, contado float64, notas string) (string, error) {
	if math.IsNaN(contado) || math.IsInf(contado, 0) || contado < 0 {
		return "", rechazo("Lo contado no puede ser negativo.")
	}
	var sucursal string
	var base jsmath.Num
	err := s.pool.QueryRow(ctx, `SELECT s.branch_id, b.fondo_base FROM cash_sessions s JOIN branches b ON b.id = s.branch_id WHERE s.id::text = $1`, sesion).Scan(&sucursal, &base)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", rechazo("Esa caja ya estaba cerrada.")
	}
	if err != nil {
		return "", err
	}
	colgadas, err := caja.CajasConPendientes(ctx, s.pool, sucursal)
	if err != nil {
		return "", err
	}
	if len(colgadas) > 0 {
		partes := make([]string, len(colgadas))
		for i, c := range colgadas {
			partes[i] = c.Codigo + " (" + itoa(c.Pendientes) + ")"
		}
		return "", rechazo("Hay ventas sin subir en " + strings.Join(partes, ", ") + ". Esperá a que la caja recupere conexión: esa plata está en el cajón pero todavía no en el turno.")
	}
	var esperado jsmath.Num
	if err := s.pool.QueryRow(ctx, `SELECT coalesce(sum(monto), 0) FROM cash_movements WHERE session_id = $1`, sesion).Scan(&esperado); err != nil {
		return "", err
	}
	diferencia := contado - esperado.F()
	nombre := caja.NombreDeLaDiferencia(diferencia)
	notas = zodjs.TrimJS(notas)
	if math.Abs(diferencia) > caja.ToleranciaArqueo && notas == "" {
		return "", rechazo("Hay un " + nombre + " de $" + f2(math.Abs(diferencia)) + ". Escribí qué pasó antes de cerrar: mañana nadie se va a acordar.")
	}
	sinCambio := base.F() > 0 && contado < base.F()
	var nota *string
	if notas != "" {
		nota = &notas
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE cash_sessions SET estado = 'cerrada', cerrada_por = $2, cerrada_at = now(), contado = $3::numeric, notas = $4
		WHERE id = $1 AND estado = 'abierta'`, sesion, ses.UserID, f2(contado), nota)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return "", rechazo("Esa caja ya estaba cerrada.")
	}
	desc := "Cerró la caja. Esperado $" + f2(esperado.F()) + ", contado $" + f2(contado)
	if nombre == "sin diferencia" {
		desc += ", sin diferencia"
	} else {
		desc += ", " + nombre + " de $" + f2(math.Abs(diferencia))
	}
	if notas != "" {
		desc += ": " + notas
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCambiarEstado, "caja", "", desc, nil)
	cierre := "Caja cerrada sin diferencia."
	if nombre != "sin diferencia" {
		cierre = "Caja cerrada con un " + nombre + " de $" + f2(math.Abs(diferencia)) + "."
	}
	if sinCambio {
		return cierre + " Ojo: quedan $" + f2(contado) + " en el cajón y la base de cambio es $" + f2(base.F()) + ".", nil
	}
	return cierre, nil
}

func itoa(n int) string { return jsmath.Texto(float64(n)) }

// ResultadoDiferido es lo que contesta POST /api/mostrador/caja/movimientos.
type ResultadoDiferido struct {
	Ok        bool   `json:"ok,omitempty"`
	Nuevo     bool   `json:"nuevo"`
	SessionID string `json:"sessionId,omitempty"`
	Error     string `json:"error,omitempty"`
	Detalle   string `json:"detalle,omitempty"`
}

// MovimientoDiferido es el ingreso o retiro que esperó en la cola: cae en el
// turno que estaba abierto cuando pasó, y la clave lo hace repetible.
func (s *Servicio) MovimientoDiferido(ctx context.Context, ses *auth.Sesion, m MovimientoDiferido) (map[string]any, error) {
	momento := ventas.FechaAcotada(m.HechoAt, s.ahora())
	turno, hay, err := caja.TurnoQueContiene(ctx, s.pool, m.BranchID, momento)
	if err != nil {
		return nil, err
	}
	if !hay {
		return map[string]any{"error": "sin_turno", "detalle": "No había ninguna caja abierta en ese momento."}, nil
	}
	monto := m.Monto
	if m.Tipo == "retiro" {
		monto = -m.Monto
	}
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO cash_movements (session_id, tipo, monto, motivo, clave, creado_por, created_at)
		VALUES ($1, $2, $3::numeric, $4, $5, $6, $7)
		ON CONFLICT (clave) DO NOTHING`, turno, m.Tipo, f2(monto), zodjs.TrimJS(m.Motivo), m.Clave, ses.UserID, momento)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "nuevo": tag.RowsAffected() > 0, "sessionId": turno}, nil
}

var _ = time.Now
