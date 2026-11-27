package caja

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
	"mjbj/internal/zodjs"
)

// SaldoDeCajaFuerte es lo que tiene la caja fuerte de una sucursal: lo que
// le llegó de los cajones, menos lo que volvió a un cajón y lo que se
// depositó en el banco (00350). Solo sumaba, y ninguna pantalla podía decir
// cuánto había (mes simulado, M3S1-005).
type SaldoDeCajaFuerte struct {
	BranchID string  `json:"branchId"`
	Sucursal string  `json:"sucursal"`
	Saldo    float64 `json:"saldo"`
	// UltimoDeposito: el último depósito en el banco, para no hacerlo dos veces.
	UltimoDeposito *time.Time `json:"ultimoDeposito"`
}

// AlaCajaFuerte (alias m): el retiro fue a la caja fuerte. Es la regla de
// reportes.RetiroACajaFuerte, acá para no depender de reportes.
const AlaCajaFuerte = `(m.tipo = 'retiro' AND coalesce(m.destino = 'caja_fuerte', NOT coalesce(m.motivo ~* '(banco|dep[oó]sit)', false) AND coalesce(m.motivo, '') NOT LIKE 'Entre turnos:%'))`

// DeLaCajaFuerte (alias m): el ingreso vino de la caja fuerte (desde la 00350
// lo dice el ingreso).
const DeLaCajaFuerte = `(m.tipo = 'ingreso' AND m.destino = 'caja_fuerte')`

// saldoDeCajaFuerte es el saldo de la sucursal `b`.
const saldoDeCajaFuerte = `
	  coalesce((SELECT -sum(m.monto) FROM cash_movements m JOIN cash_sessions s ON s.id = m.session_id
	            WHERE s.branch_id = b.id AND ` + AlaCajaFuerte + `), 0)
	  - coalesce((SELECT sum(m.monto) FROM cash_movements m JOIN cash_sessions s ON s.id = m.session_id
	            WHERE s.branch_id = b.id AND ` + DeLaCajaFuerte + `), 0)
	  - coalesce((SELECT sum(f.monto) FROM caja_fuerte_movimientos f WHERE f.branch_id = b.id AND f.tipo = 'deposito'), 0)`

// CajasFuertes son los saldos de las sucursales activas.
func (p *Panel) CajasFuertes(ctx context.Context) ([]SaldoDeCajaFuerte, error) {
	filas, err := p.pool.Query(ctx, `
		SELECT b.id, b.name, `+saldoDeCajaFuerte+`,
		  (SELECT max(f.created_at) FROM caja_fuerte_movimientos f WHERE f.branch_id = b.id AND f.tipo = 'deposito')
		FROM branches b WHERE b.active = true ORDER BY b.sort_order`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []SaldoDeCajaFuerte{}
	for filas.Next() {
		var x SaldoDeCajaFuerte
		var saldo jsmath.Num
		if err := filas.Scan(&x.BranchID, &x.Sucursal, &saldo, &x.UltimoDeposito); err != nil {
			return nil, err
		}
		x.Saldo = jsmath.Redondear2(saldo.F())
		out = append(out, x)
	}
	return out, filas.Err()
}

// DepositarDeLaCajaFuerte anota que se llevó plata de la caja fuerte al
// banco (el asiento Banco a Caja lo arma el cierre). No más de lo que tiene;
// la clave por intento hace que el doble clic no deposite dos veces.
func (p *Panel) DepositarDeLaCajaFuerte(ctx context.Context, ses *auth.Sesion, sucursal string, monto float64, motivo, clave string) (string, error) {
	if !plataforma.UUIDValido(sucursal) {
		return "", problema("Esa sucursal no existe.")
	}
	if !(monto > 0) || monto > 1e9 {
		return "", problema("El monto tiene que ser mayor a cero.")
	}
	if clave == "" || len(clave) > 80 {
		return "", problema("Falta la clave del depósito.")
	}
	motivo = zodjs.TrimJS(motivo)
	if motivo == "" {
		motivo = "Depósito en el banco"
	}
	var nombre string
	nuevo := false
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('caja_fuerte:' || $1::text))`, sucursal); err != nil {
			return err
		}
		var ya bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM caja_fuerte_movimientos WHERE clave = $1)`, clave).Scan(&ya); err != nil || ya {
			return err
		}
		var saldo jsmath.Num
		if err := tx.QueryRow(ctx, `SELECT b.name, `+saldoDeCajaFuerte+` FROM branches b WHERE b.id = $1`, sucursal).Scan(&nombre, &saldo); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return problema("Esa sucursal no existe.")
			}
			return err
		}
		if monto > saldo.F()+0.005 {
			return problema("En la caja fuerte de " + nombre + " hay " + formato.Importe(saldo.F()) + ".")
		}
		nuevo = true
		_, err := tx.Exec(ctx, `INSERT INTO caja_fuerte_movimientos (branch_id, tipo, monto, motivo, clave, created_by_user_id)
			VALUES ($1, 'deposito', $2::numeric, $3, $4, $5)`, sucursal, jsmath.Fijo2(monto), motivo, clave, ses.UserID)
		return err
	})
	if err != nil {
		return "", err
	}
	if nuevo {
		bitacora.Anotar(ctx, p.q, p.log, ses, sqlc.AccionAuditoriaCrear, "caja", "", "Depositó en el banco "+formato.Importe(monto)+" de la caja fuerte de "+nombre+": "+motivo, nil)
	}
	return "Depósito anotado.", nil
}

// AsignarReciboAlTurno mete en un turno el efectivo de un recibo que se
// cobró sin caja abierta (el que lista EfectivoFueraDeCaja): el asiento lo
// mandaba a Caja y ningún arqueo lo contaba, sin forma de arreglarlo (mes
// simulado, M3S1-013). Entra con el motivo con que cobros.efectivoALaCaja lo
// anota, que es como se reconoce, y con la hora del recibo si el turno la
// contiene.
func (p *Panel) AsignarReciboAlTurno(ctx context.Context, ses *auth.Sesion, reciboID, sessionID string) (string, error) {
	if !plataforma.UUIDValido(reciboID) || !plataforma.UUIDValido(sessionID) {
		return "", problema("Ese recibo o ese turno no existen.")
	}
	var numero string
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		var recibidoDe string
		var branch *string
		var fecha time.Time
		var efectivo jsmath.Num
		err := tx.QueryRow(ctx, `
			SELECT r.numero, r.recibido_de, r.branch_id, r.created_at,
			       coalesce((SELECT sum(rp.importe) FROM receipt_parts rp WHERE rp.receipt_id = r.id AND rp.medio = 'efectivo'), 0)
			FROM receipts r WHERE r.id = $1 AND r.estado <> 'anulado' FOR UPDATE`, reciboID).Scan(&numero, &recibidoDe, &branch, &fecha, &efectivo)
		if errors.Is(err, pgx.ErrNoRows) {
			return problema("Ese recibo no existe o está anulado.")
		}
		if err != nil {
			return err
		}
		if !(efectivo.F() > 0) {
			return problema("Ese recibo no se cobró en efectivo: no va a la caja.")
		}
		var ya bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cash_movements m WHERE m.motivo LIKE 'Recibo ' || $1 || ' —%')`, numero).Scan(&ya); err != nil {
			return err
		}
		if ya {
			return problema("Ese recibo ya está en un turno.")
		}
		var turnoBranch string
		var abierta time.Time
		var cerrada *time.Time
		err = tx.QueryRow(ctx, `SELECT branch_id, abierta_at, cerrada_at FROM cash_sessions WHERE id = $1 FOR UPDATE`, sessionID).Scan(&turnoBranch, &abierta, &cerrada)
		if errors.Is(err, pgx.ErrNoRows) {
			return problema("Ese turno no existe.")
		}
		if err != nil {
			return err
		}
		if branch != nil && *branch != turnoBranch {
			return problema("Ese turno es de otra sucursal.")
		}
		// Con la hora del recibo si cae en el turno; si no, la de ahora (un
		// turno ya contado no cambia su arqueo: entra como tardío).
		momento := time.Now()
		if !fecha.Before(abierta) && (cerrada == nil || !fecha.After(*cerrada)) {
			momento = fecha
		}
		_, err = tx.Exec(ctx, `INSERT INTO cash_movements (session_id, tipo, monto, motivo, creado_por, created_at)
			VALUES ($1, 'ingreso', $2::numeric, $3, $4, $5)`, sessionID, jsmath.Fijo2(efectivo.F()), "Recibo "+numero+" — "+recibidoDe, ses.UserID, momento)
		return err
	})
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, p.q, p.log, ses, sqlc.AccionAuditoriaEditar, "caja", "", "Asignó el efectivo del recibo "+numero+" a un turno de caja", nil)
	return numero + " quedó en el turno.", nil
}

// PrimerMes es el primer mes (aaaa-mm, hora argentina) con algo en la caja:
// el selector no ofrece los meses vacíos de antes (mes simulado, M2S1-118).
func (p *Panel) PrimerMes(ctx context.Context) (*string, error) {
	var t *time.Time
	if err := p.pool.QueryRow(ctx, `SELECT least(
		  (SELECT min(abierta_at) FROM cash_sessions),
		  (SELECT min(created_at) FROM orders WHERE origen = 'mostrador'))`).Scan(&t); err != nil || t == nil {
		return nil, err
	}
	m := t.In(Argentina).Format("2006-01")
	return &m, nil
}
