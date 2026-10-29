// Package caja es el turno de caja del mostrador (lib/mostrador/caja.ts,
// lib/mostrador/turno.ts, lib/mostrador/arqueo.ts) y lo que el mostrador
// sabe de las cajas físicas (cajasConPendientes, anotarLatido).
//
// Lo que sostiene todo es una regla sola: **el efectivo esperado no se
// guarda, se suma.** Cada vez que hace falta, se suman los movimientos del
// turno; el signo lo pone el tipo (un retiro es negativo).
package caja

import (
	"context"
	"errors"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"mjbj/internal/jsmath"
)

// Consultador es una transacción o el pool.
type Consultador interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// ToleranciaArqueo: hasta un peso se considera que el arqueo cerró.
const ToleranciaArqueo = 1

// NombreDeLaDiferencia: «sin diferencia», «faltante» o «sobrante».
func NombreDeLaDiferencia(d float64) string {
	if math.Abs(d) <= ToleranciaArqueo {
		return "sin diferencia"
	}
	if d > 0 {
		return "sobrante"
	}
	return "faltante"
}

// TurnoQueContiene es el turno de la sucursal que estaba abierto en ese
// momento: se busca por la ventana del turno y no por su estado, así una
// venta sin conexión de las 19:40 cae en el turno de las 19:40 aunque llegue
// después del cierre. Si dos se tocan en el borde, gana el más nuevo.
func TurnoQueContiene(ctx context.Context, c Consultador, sucursal string, momento time.Time) (string, bool, error) {
	var id string
	err := c.QueryRow(ctx, `
		SELECT id FROM cash_sessions
		WHERE branch_id = $1 AND abierta_at <= $2 AND (cerrada_at IS NULL OR cerrada_at >= $2)
		ORDER BY abierta_at DESC LIMIT 1`, sucursal, momento).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return id, err == nil, err
}

// TurnoAbiertoDe es el id del turno abierto de la sucursal, si hay.
func TurnoAbiertoDe(ctx context.Context, c Consultador, sucursal string) (string, bool, error) {
	var id string
	err := c.QueryRow(ctx, `SELECT id FROM cash_sessions WHERE branch_id = $1 AND estado = 'abierta' LIMIT 1`, sucursal).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return id, err == nil, err
}

// TurnoAbierto es el turno abierto con sus totales ya sumados.
type TurnoAbierto struct {
	ID               string    `json:"id"`
	Sucursal         string    `json:"sucursal"`
	BranchID         string    `json:"branchId"`
	AbiertaPor       string    `json:"abiertaPor"`
	AbiertaAt        time.Time `json:"abiertaAt"`
	Esperado         float64   `json:"esperado"`
	FondoInicial     float64   `json:"fondoInicial"`
	FondoBase        float64   `json:"fondoBase"`
	VentasEnEfectivo float64   `json:"ventasEnEfectivo"`
	OtrosIngresos    float64   `json:"otrosIngresos"`
	Retiros          float64   `json:"retiros"`
	CantidadDeVentas int       `json:"cantidadDeVentas"`
}

// Abierto es turnoAbierto: nil si la sucursal no tiene caja abierta.
func Abierto(ctx context.Context, c Consultador, sucursal string) (*TurnoAbierto, error) {
	var t TurnoAbierto
	var esperado, fondoBase, fondoInicial, ventas, ingresos, retiros jsmath.Num
	err := c.QueryRow(ctx, `
		SELECT s.id, s.branch_id, b.name, u.name, s.abierta_at,
		       coalesce(sum(m.monto), 0), b.fondo_base,
		       coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'apertura'), 0),
		       coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'venta'), 0),
		       coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'ingreso'), 0),
		       coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'retiro'), 0),
		       count(*) FILTER (WHERE m.tipo = 'venta')::int
		FROM cash_sessions s
		JOIN branches b ON b.id = s.branch_id
		JOIN "user" u ON u.id = s.abierta_por
		LEFT JOIN cash_movements m ON m.session_id = s.id
		WHERE s.branch_id = $1 AND s.estado = 'abierta'
		GROUP BY s.id, s.branch_id, b.name, b.fondo_base, u.name, s.abierta_at
		LIMIT 1`, sucursal).Scan(&t.ID, &t.BranchID, &t.Sucursal, &t.AbiertaPor, &t.AbiertaAt,
		&esperado, &fondoBase, &fondoInicial, &ventas, &ingresos, &retiros, &t.CantidadDeVentas)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t.Esperado, t.FondoBase, t.FondoInicial = esperado.F(), fondoBase.F(), fondoInicial.F()
	t.VentasEnEfectivo, t.OtrosIngresos, t.Retiros = ventas.F(), ingresos.F(), retiros.F()
	return &t, nil
}

// Movimiento es un renglón del turno.
type Movimiento struct {
	ID        string    `json:"id"`
	Tipo      string    `json:"tipo"`
	Monto     float64   `json:"monto"`
	Motivo    *string   `json:"motivo"`
	OrderID   *string   `json:"orderId"`
	CreatedAt time.Time `json:"createdAt"`
	Quien     *string   `json:"quien"`
}

// MovimientosDelTurno, del más nuevo al más viejo.
func MovimientosDelTurno(ctx context.Context, c Consultador, sesion string) ([]Movimiento, error) {
	filas, err := c.Query(ctx, `
		SELECT m.id, m.tipo::text, m.monto, m.motivo, m.order_id, m.created_at, u.name
		FROM cash_movements m LEFT JOIN "user" u ON u.id = m.creado_por
		WHERE m.session_id = $1 ORDER BY m.created_at DESC`, sesion)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Movimiento{}
	for filas.Next() {
		var m Movimiento
		var monto jsmath.Num
		if err := filas.Scan(&m.ID, &m.Tipo, &monto, &m.Motivo, &m.OrderID, &m.CreatedAt, &m.Quien); err != nil {
			return nil, err
		}
		m.Monto = monto.F()
		out = append(out, m)
	}
	return out, filas.Err()
}

// FondoBase es el cambio que tiene que quedar en el cajón de la sucursal.
func FondoBase(ctx context.Context, c Consultador, sucursal string) (float64, error) {
	var f jsmath.Num
	err := c.QueryRow(ctx, `SELECT fondo_base FROM branches WHERE id = $1`, sucursal).Scan(&f)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return f.F(), err
}

// VentaDeHoy es una venta de mostrador del día.
type VentaDeHoy struct {
	ID        string    `json:"id"`
	Numero    string    `json:"numero"`
	Cliente   string    `json:"cliente"`
	Total     float64   `json:"total"`
	MedioPago *string   `json:"medioPago"`
	Estado    string    `json:"estado"`
	CreatedAt time.Time `json:"createdAt"`
}

// Argentina es la zona del negocio.
var Argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// InicioDelDia es la medianoche argentina del día de `ahora`.
func InicioDelDia(ahora time.Time) time.Time {
	a := ahora.In(Argentina)
	return time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, Argentina)
}

// VentasDeHoy son las ventas de mostrador del día (con las anuladas), las
// últimas 40. «Hoy» es el día argentino: el TS usaba date_trunc('day',
// now()) en la zona de la conexión.
func VentasDeHoy(ctx context.Context, c Consultador, sucursal string, ahora time.Time) ([]VentaDeHoy, error) {
	filas, err := c.Query(ctx, `
		SELECT id, numero, contacto_nombre, total, medio_pago::text, estado::text, created_at
		FROM orders
		WHERE branch_id = $1 AND origen = 'mostrador' AND clave_mostrador IS NOT NULL AND created_at >= $2
		ORDER BY created_at DESC LIMIT 40`, sucursal, InicioDelDia(ahora))
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []VentaDeHoy{}
	for filas.Next() {
		var v VentaDeHoy
		var total jsmath.Num
		if err := filas.Scan(&v.ID, &v.Numero, &v.Cliente, &total, &v.MedioPago, &v.Estado, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.Total = total.F()
		out = append(out, v)
	}
	return out, filas.Err()
}

// RenglonDelCierre es una fila del cierre Z: cuánto entró por cada medio.
type RenglonDelCierre struct {
	MedioPago string  `json:"medioPago"`
	Cantidad  int     `json:"cantidad"`
	Total     float64 `json:"total"`
}

// CierresDeTurnos es el cierre Z de cada turno: las ventas de la sucursal en
// la ventana del turno, sin las anuladas, por medio (order_payments, o el
// medio único de las ventas viejas).
func CierresDeTurnos(ctx context.Context, c Consultador, sesiones []string) (map[string][]RenglonDelCierre, error) {
	por := map[string][]RenglonDelCierre{}
	if len(sesiones) == 0 {
		return por, nil
	}
	filas, err := c.Query(ctx, `
		SELECT s.id, coalesce(p.medio::text, o.medio_pago::text),
		       count(DISTINCT o.id)::int,
		       coalesce(sum(coalesce(p.importe, o.total)), 0)
		FROM cash_sessions s
		JOIN orders o ON o.branch_id = s.branch_id AND o.origen = 'mostrador' AND o.clave_mostrador IS NOT NULL
		     AND o.estado <> 'cancelado' AND o.created_at >= s.abierta_at
		     AND (s.cerrada_at IS NULL OR o.created_at <= s.cerrada_at)
		LEFT JOIN order_payments p ON p.order_id = o.id
		WHERE s.id = ANY($1::uuid[])
		GROUP BY s.id, coalesce(p.medio::text, o.medio_pago::text)`, sesiones)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var id string
		var medio *string
		var r RenglonDelCierre
		var total jsmath.Num
		if err := filas.Scan(&id, &medio, &r.Cantidad, &total); err != nil {
			return nil, err
		}
		r.MedioPago = "sin especificar"
		if medio != nil {
			r.MedioPago = *medio
		}
		r.Total = total.F()
		por[id] = append(por[id], r)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	for _, rs := range por {
		sort.SliceStable(rs, func(i, j int) bool { return rs[i].Total > rs[j].Total })
	}
	return por, nil
}

// CierreDelTurno es el cierre Z de un turno solo.
func CierreDelTurno(ctx context.Context, c Consultador, sesion string) ([]RenglonDelCierre, error) {
	m, err := CierresDeTurnos(ctx, c, []string{sesion})
	if err != nil {
		return nil, err
	}
	if r, ok := m[sesion]; ok {
		return r, nil
	}
	return []RenglonDelCierre{}, nil
}

// LatidoVigente: solo cuentan las cajas que dieron señales hace menos de esto.
const LatidoVigente = 15 * time.Minute

// CajaColgada es una caja física con ventas sin subir.
type CajaColgada struct {
	Codigo      string     `json:"codigo"`
	Pendientes  int        `json:"pendientes"`
	UltimaVezAt *time.Time `json:"ultimaVezAt"`
}

// CajasConPendientes son las cajas de la sucursal, vivas hace poco, que
// tienen ventas sin subir: con alguna, no se cierra el turno.
func CajasConPendientes(ctx context.Context, c Consultador, sucursal string) ([]CajaColgada, error) {
	filas, err := c.Query(ctx, `
		SELECT codigo, pendientes, ultima_vez_at FROM pos_devices
		WHERE branch_id = $1 AND activo = true AND pendientes > 0
		  AND ultima_vez_at > now() - interval '15 minutes'
		ORDER BY codigo`, sucursal)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []CajaColgada{}
	for filas.Next() {
		var x CajaColgada
		if err := filas.Scan(&x.Codigo, &x.Pendientes, &x.UltimaVezAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, filas.Err()
}

// AnotarLatido guarda que la caja física está viva y cuántas ventas tiene sin
// subir. El secreto dice de qué caja se habla. Devuelve si la encontró.
func AnotarLatido(ctx context.Context, c Consultador, caja, secreto string, pendientes float64) (bool, error) {
	p := math.Trunc(pendientes)
	if !(p > 0) {
		p = 0
	}
	if p > math.MaxInt32 {
		p = math.MaxInt32
	}
	tag, err := c.Exec(ctx, `UPDATE pos_devices SET ultima_vez_at = now(), pendientes = $3 WHERE id::text = $1 AND secreto = $2`,
		caja, secreto, int32(p))
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
