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
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
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
//
// **El turno arranca con lo que quedó contado** (mes simulado, H024 y
// H249). Abrir con la base cuando al cierre quedaron más hacía desaparecer
// la diferencia entre turnos sin un solo movimiento: $301.374 en una semana.
// Ahora, si el fondo no es lo contado al cerrar el turno anterior, hace
// falta decir adónde fue (o de dónde vino) la diferencia, y queda a la
// vista: la apertura es lo contado y la diferencia, un retiro (o un
// ingreso) «entre turnos» con ese motivo. Los recuadros del turno y el
// arqueo la muestran como cualquier otro retiro.
//
// `puesto` es la caja física de la PC que abre (vacío si no tiene): queda en
// el turno para el arqueo por caja (H356).
//
// **Contar mal no es sacar plata** (mes simulado, M2S3-002). Con `corregir`,
// la diferencia no es un movimiento: se rehace el arqueo del turno anterior
// (contado_corregido, con el motivo y quién), sin tocar lo que se contó
// entonces. Cargada como retiro, la caja fuerte sumaba plata que no existía y
// el sobrante falso quedaba como ganancia. Solo el último turno cerrado y si
// su mes no está cerrado: lo de antes ya está en un archivo del estudio.
func (s *Servicio) AbrirCaja(ctx context.Context, ses *auth.Sesion, sucursal string, fondo float64, motivo, puesto string, corregir bool) (string, error) {
	if math.IsNaN(fondo) || math.IsInf(fondo, 0) || fondo < 0 {
		return "", rechazo("El fondo inicial no puede ser negativo.")
	}
	base, err := caja.FondoBase(ctx, s.pool, sucursal)
	if err != nil {
		return "", err
	}
	anterior, err := caja.UltimoContado(ctx, s.pool, sucursal)
	if err != nil {
		return "", err
	}
	motivo = zodjs.TrimJS(motivo)
	diferencia := 0.0
	if anterior != nil && math.Abs(*anterior-fondo) > caja.ToleranciaArqueo {
		diferencia = jsmath.Redondear2(*anterior - fondo)
	}
	if diferencia != 0 && motivo == "" {
		if diferencia > 0 {
			return "", rechazo("Al cerrar quedaron " + formato.Importe(*anterior) + ". Poné adónde fueron los " + formato.Importe(diferencia) + ".")
		}
		return "", rechazo("Al cerrar quedaron " + formato.Importe(*anterior) + ". Poné de dónde salieron los " + formato.Importe(-diferencia) + ".")
	}
	var posID *string
	if plataforma.UUIDValido(puesto) {
		posID = &puesto
	}
	faltaCambio := base > 0 && fondo < base
	corregido := corregir && diferencia != 0
	err = plataforma.EnTransaccion(ctx, s.pool, func(tx pgx.Tx) error {
		if corregido {
			var previo string
			var mes string
			err := tx.QueryRow(ctx, `SELECT id, mes_de_instante(cerrada_at) FROM cash_sessions
				WHERE branch_id = $1 AND estado = 'cerrada' AND contado IS NOT NULL
				ORDER BY cerrada_at DESC LIMIT 1 FOR UPDATE`, sucursal).Scan(&previo, &mes)
			if err != nil {
				return err
			}
			var cerrado bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM meses_cerrados WHERE mes = $1)`, mes).Scan(&cerrado); err != nil {
				return err
			}
			if cerrado {
				return rechazo("Ese turno es de un mes ya cerrado: la diferencia va como movimiento entre turnos.")
			}
			if _, err := tx.Exec(ctx, `UPDATE cash_sessions SET contado_corregido = $2::numeric, correccion_motivo = $3,
				corregido_por = $4, corregido_at = now() WHERE id = $1`, previo, f2(fondo), motivo, ses.UserID); err != nil {
				return err
			}
		}
		var sesion string
		if err := tx.QueryRow(ctx, `INSERT INTO cash_sessions (branch_id, abierta_por, pos_device_id)
			VALUES ($1, $2, (SELECT id FROM pos_devices WHERE id::text = $3 AND branch_id = $1)) RETURNING id`,
			sucursal, ses.UserID, posID).Scan(&sesion); err != nil {
			return err
		}
		if diferencia == 0 || corregido {
			_, err := tx.Exec(ctx, `INSERT INTO cash_movements (session_id, tipo, monto, motivo, creado_por) VALUES ($1, 'apertura', $2::numeric, 'Fondo inicial', $3)`,
				sesion, f2(fondo), ses.UserID)
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO cash_movements (session_id, tipo, monto, motivo, creado_por) VALUES ($1, 'apertura', $2::numeric, 'Quedó del turno anterior', $3)`,
			sesion, f2(*anterior), ses.UserID); err != nil {
			return err
		}
		tipo := "retiro"
		if diferencia < 0 {
			tipo = "ingreso"
		}
		_, err := tx.Exec(ctx, `INSERT INTO cash_movements (session_id, tipo, monto, motivo, creado_por) VALUES ($1, $2, $3::numeric, $4, $5)`,
			sesion, tipo, f2(-diferencia), "Entre turnos: "+motivo, ses.UserID)
		return err
	})
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.ConstraintName == "cash_sessions_una_abierta_por_sucursal" {
		return "", rechazo("Ya hay una caja abierta en esta sucursal.")
	}
	if err != nil {
		return "", err
	}
	desc := "Abrió la caja con un fondo de " + formato.Importe(fondo)
	if corregido {
		desc += " y corrigió el conteo del turno anterior: " + formato.Importe(*anterior) + " → " + formato.Importe(fondo) + " (" + motivo + ")"
	} else if diferencia != 0 {
		desc += " (al cerrar quedaron " + formato.Importe(*anterior) + "; entre turnos: " + motivo + ")"
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "caja", "", desc, nil)
	if faltaCambio {
		return "Caja abierta, pero el fondo quedó por debajo de la base de " + formato.Importe(base) + ". Reponé el cambio.", nil
	}
	return "Caja abierta.", nil
}

// MovimientoDeCaja es un ingreso o un retiro desde el mostrador. Un retiro
// no puede dejar el cajón por debajo del fondo de cambio.
//
// El retiro dice a dónde va (H333): al banco, a la caja fuerte u otro. Al
// banco y a la caja fuerte no hace falta escribir el motivo: el destino lo
// dice. Sin destino (un cliente viejo) se clasifica por el motivo, como
// antes.
//
// El ingreso dice de dónde viene (de la caja fuerte, del banco u otro): el
// ingreso suelto no dejaba asiento (M3S3-014). Y el retiro «otro» con una
// categoría de gasto (el flete pagado del cajón) es un gasto en efectivo:
// queda en Gastos, en el resultado y en los asientos, y sale del cajón como
// cualquier gasto (M3S1-005).
func (s *Servicio) MovimientoDeCaja(ctx context.Context, ses *auth.Sesion, sesion, tipo string, monto float64, motivo string, destino, categoria *string) (string, error) {
	if math.IsNaN(monto) || math.IsInf(monto, 0) || monto <= 0 {
		return "", rechazo("El monto tiene que ser mayor a cero.")
	}
	if tipo != "retiro" && tipo != "ingreso" {
		destino = nil
	}
	if categoria != nil && (tipo != "retiro" || destino == nil || *destino != "otro" || !CategoriaDeGasto(*categoria)) {
		categoria = nil
	}
	motivo = zodjs.TrimJS(motivo)
	if motivo == "" && destino != nil {
		if tipo == "ingreso" {
			motivo = MotivoDelOrigen[*destino]
		} else {
			motivo = MotivoDelDestino[*destino]
		}
	}
	if motivo == "" {
		return "", rechazo("Poné el motivo: un movimiento sin explicación no se puede revisar después.")
	}
	// Todo en una transacción con el turno bloqueado: un movimiento no entra
	// en una caja ya arqueada, y dos retiros a la vez no pasan los dos el
	// control de la base de cambio.
	firmado := monto
	if tipo == "retiro" {
		firmado = -monto
	}
	err := plataforma.EnTransaccion(ctx, s.pool, func(tx pgx.Tx) error {
		var estado string
		var base jsmath.Num
		err := tx.QueryRow(ctx, `
			SELECT s.estado, b.fondo_base FROM cash_sessions s JOIN branches b ON b.id = s.branch_id
			WHERE s.id::text = $1 FOR UPDATE OF s`, sesion).Scan(&estado, &base)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && estado != "abierta") {
			return rechazo("Esa caja ya está cerrada.")
		}
		if err != nil {
			return err
		}
		if tipo == "retiro" {
			var esperado jsmath.Num
			if err := tx.QueryRow(ctx, `SELECT coalesce(sum(monto), 0) FROM cash_movements WHERE session_id::text = $1`, sesion).Scan(&esperado); err != nil {
				return err
			}
			enCaja := esperado.F()
			// Sin base de cambio, el piso es cero: el retiro no deja el
			// cajón en negativo (mes simulado).
			piso := math.Max(0, base.F())
			if float64(enCaja-monto)-piso < -0.009 {
				disponible := math.Max(0, jsmath.Redondear2(enCaja-piso))
				switch {
				case piso > 0 && disponible > 0:
					return rechazo("Ese retiro deja el cajón sin el cambio de la base (" + formato.Importe(base.F()) + "). Podés retirar hasta " + formato.Importe(disponible) + ".")
				case piso > 0:
					return rechazo("No se puede retirar: en el cajón hay " + formato.Importe(enCaja) + " y la base de cambio es " + formato.Importe(base.F()) + ".")
				case disponible > 0:
					return rechazo("En el cajón hay " + formato.Importe(enCaja) + ". Podés retirar hasta " + formato.Importe(disponible) + ".")
				}
				return rechazo("No se puede retirar: el cajón no tiene efectivo.")
			}
		}
		if categoria != nil {
			var gasto string
			if err := tx.QueryRow(ctx, `INSERT INTO expenses (fecha, categoria, descripcion, importe, medio, branch_id, created_by_user_id)
				SELECT now(), $1::categoria_gasto, $2, $3::numeric, 'efectivo', s.branch_id, $4 FROM cash_sessions s WHERE s.id::text = $5
				RETURNING id`, *categoria, motivo, f2(monto), ses.UserID, sesion).Scan(&gasto); err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `INSERT INTO cash_movements (session_id, tipo, monto, motivo, expense_id, creado_por) VALUES ($1, 'gasto', $2::numeric, $3, $4, $5)`,
				sesion, f2(firmado), motivo, gasto, ses.UserID)
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO cash_movements (session_id, tipo, monto, motivo, creado_por, destino) VALUES ($1, $2, $3::numeric, $4, $5, $6)`,
			sesion, tipo, f2(firmado), motivo, ses.UserID, destino)
		return err
	})
	if err != nil {
		return "", err
	}
	if categoria != nil {
		s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "gasto", "", "Pagó del cajón "+formato.Importe(monto)+" ("+*categoria+"): "+motivo, nil)
		return "Gasto registrado.", nil
	}
	verbo := "Ingresó"
	if tipo == "retiro" {
		verbo = "Retiró"
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "caja", "", verbo+" "+formato.Importe(monto)+": "+motivo, nil)
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
	notas = zodjs.TrimJS(notas)
	var nota *string
	if notas != "" {
		nota = &notas
	}
	// El esperado se suma con el turno bloqueado: una venta en efectivo que
	// está confirmando tiene el turno compartido, así que el cierre la
	// espera y la cuenta.
	var esperado jsmath.Num
	var diferencia float64
	var nombre string
	err = plataforma.EnTransaccion(ctx, s.pool, func(tx pgx.Tx) error {
		var estado string
		if err := tx.QueryRow(ctx, `SELECT estado FROM cash_sessions WHERE id::text = $1 FOR UPDATE`, sesion).Scan(&estado); err != nil {
			return err
		}
		if estado != "abierta" {
			return rechazo("Esa caja ya estaba cerrada.")
		}
		if err := tx.QueryRow(ctx, `SELECT coalesce(sum(monto), 0) FROM cash_movements WHERE session_id::text = $1`, sesion).Scan(&esperado); err != nil {
			return err
		}
		diferencia = contado - esperado.F()
		nombre = caja.NombreDeLaDiferencia(diferencia)
		if math.Abs(diferencia) > caja.ToleranciaArqueo && notas == "" {
			return rechazo("Hay un " + nombre + " de " + formato.Importe(math.Abs(diferencia)) + ". Escribí qué pasó antes de cerrar: mañana nadie se va a acordar.")
		}
		_, err := tx.Exec(ctx, `
			UPDATE cash_sessions SET estado = 'cerrada', cerrada_por = $2, cerrada_at = now(), contado = $3::numeric, notas = $4
			WHERE id::text = $1`, sesion, ses.UserID, f2(contado), nota)
		return err
	})
	if err != nil {
		return "", err
	}
	sinCambio := base.F() > 0 && contado < base.F()
	desc := "Cerró la caja. Esperado " + formato.Importe(esperado.F()) + ", contado " + formato.Importe(contado)
	if nombre == "sin diferencia" {
		desc += ", sin diferencia"
	} else {
		desc += ", " + nombre + " de " + formato.Importe(math.Abs(diferencia))
	}
	if notas != "" {
		desc += ": " + notas
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCambiarEstado, "caja", "", desc, nil)
	cierre := "Caja cerrada sin diferencia."
	// Dentro del peso de tolerancia, con los centavos: decía «sin
	// diferencia» y la caja del panel, «−$ 0,60» del mismo turno (M2S3-097).
	if nombre == "sin diferencia" && math.Abs(diferencia) >= 0.005 {
		cierre = "Caja cerrada: cierra · " + formato.Importe(jsmath.Redondear2(diferencia)) + "."
	}
	if nombre != "sin diferencia" {
		cierre = "Caja cerrada con un " + nombre + " de " + formato.Importe(math.Abs(diferencia)) + "."
	}
	if sinCambio {
		return cierre + " Ojo: quedan " + formato.Importe(contado) + " en el cajón y la base de cambio es " + formato.Importe(base.F()) + ".", nil
	}
	return cierre, nil
}

func itoa(n int) string { return jsmath.Texto(float64(n)) }

// MotivoDelDestino es el motivo de un retiro que no lo escribió: el destino
// ya dice qué pasó con la plata.
var MotivoDelDestino = map[string]string{
	"banco":       "Depósito en el banco",
	"caja_fuerte": "A la caja fuerte",
}

// MotivoDelOrigen es el de un ingreso que no lo escribió.
var MotivoDelOrigen = map[string]string{
	"banco":       "Extracción del banco",
	"caja_fuerte": "De la caja fuerte",
}

// CategoriaDeGasto: es una de categoria_gasto (00031).
func CategoriaDeGasto(c string) bool {
	switch c {
	case "flete", "combustible", "servicios", "alquiler", "sueldos", "mantenimiento", "impuestos", "librería", "publicidad", "otros":
		return true
	}
	return false
}

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
//
// **Con el turno ya cerrado no cambia su arqueo** (T3, hallazgo 9). Entraba
// con la hora declarada, antes del cierre, así que no contaba como tardío y
// achicaba el faltante de una caja ya contada: un retiro con fecha vieja
// borraba la plata que faltaba. Ahora entra con la hora en que llegó (y se
// ve como tardío, aparte de la diferencia del cierre) y la hora declarada
// queda en declarado_at.
//
// Con el turno abierto, un retiro que deja el cajón por debajo de la base no
// se rechaza —la plata ya salió, sin conexión no se pudo frenar— pero queda
// marcado (bajo_la_base). Los dos casos van a la bitácora.
func (s *Servicio) MovimientoDiferido(ctx context.Context, ses *auth.Sesion, m MovimientoDiferido) (map[string]any, error) {
	ahora := s.ahora()
	momento := ventas.FechaAcotada(m.HechoAt, ahora)
	monto := m.Monto
	if m.Tipo == "retiro" {
		monto = -m.Monto
	}
	var turno string
	var nuevo, cerrado, bajoLaBase bool
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var hay bool
		var err error
		turno, hay, err = caja.TurnoQueContiene(ctx, tx, m.BranchID, momento)
		if err != nil || !hay {
			return err
		}
		// El turno bloqueado: un cierre a la vez con este movimiento.
		var estado string
		var base jsmath.Num
		if err := tx.QueryRow(ctx, `
			SELECT s.estado, b.fondo_base FROM cash_sessions s JOIN branches b ON b.id = s.branch_id
			WHERE s.id = $1 FOR UPDATE OF s`, turno).Scan(&estado, &base); err != nil {
			return err
		}
		cerrado = estado != "abierta"
		creado, declarado := momento, (*time.Time)(nil)
		if cerrado {
			creado, declarado = ahora, &momento
		} else if m.Tipo == "retiro" && base.F() > 0 {
			var enCaja jsmath.Num
			if err := tx.QueryRow(ctx, `SELECT coalesce(sum(monto), 0) FROM cash_movements WHERE session_id = $1`, turno).Scan(&enCaja); err != nil {
				return err
			}
			bajoLaBase = enCaja.F()-m.Monto < base.F()
		}
		// El ingreso también dice de dónde viene (00350).
		destino := m.Destino

		tag, err := tx.Exec(ctx, `
			INSERT INTO cash_movements (session_id, tipo, monto, motivo, clave, creado_por, created_at, declarado_at, bajo_la_base, destino)
			VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (clave) DO NOTHING`, turno, m.Tipo, f2(monto), zodjs.TrimJS(m.Motivo), m.Clave, ses.UserID, creado, declarado, bajoLaBase, destino)
		nuevo = err == nil && tag.RowsAffected() > 0
		return err
	})
	if err != nil {
		return nil, err
	}
	if turno == "" {
		return map[string]any{"error": "sin_turno", "detalle": "No había ninguna caja abierta en ese momento."}, nil
	}
	if nuevo && (cerrado || bajoLaBase) {
		verbo := "Ingreso"
		if m.Tipo == "retiro" {
			verbo = "Retiro"
		}
		hora := momento.In(caja.Argentina).Format("02/01 15:04")
		desc := verbo + " sin conexión de " + formato.Importe(m.Monto) + " (" + hora + ")"
		if cerrado {
			desc += " llegó con la caja ya cerrada: queda como tardío y no cambia el arqueo"
		} else {
			desc += " dejó el cajón por debajo de la base de cambio"
		}
		s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "caja", turno, desc+": "+zodjs.TrimJS(m.Motivo),
			map[string]any{"declaradoAt": momento, "tardio": cerrado, "bajoLaBase": bajoLaBase})
	}
	return map[string]any{"ok": true, "nuevo": nuevo, "sessionId": turno}, nil
}

var _ = time.Now
