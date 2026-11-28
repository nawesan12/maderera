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
	"fmt"
	"math"
	"slices"
	"sort"
	"strings"
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
	// Cobros: el efectivo de los recibos que entró al turno (cuenta y
	// pedidos). Iba dentro de «Otros ingresos» junto al ingreso a mano
	// (M4-023: $ 606.947,50 eran $ 601.947,50 de cobros y $ 5.000 a mano).
	Cobros  float64 `json:"cobros"`
	Retiros float64 `json:"retiros"`
	// Devoluciones (anulaciones y devoluciones parciales en efectivo) y
	// Gastos (los que se cargan en efectivo desde el panel) también salen del
	// cajón: sin ellos los recuadros no sumaban «Debería haber» y la plata
	// salía sin que el vendedor la viera (mes simulado, H177 y H366).
	Devoluciones     float64 `json:"devoluciones"`
	Gastos           float64 `json:"gastos"`
	CantidadDeVentas int     `json:"cantidadDeVentas"`
}

// Abierto es turnoAbierto: nil si la sucursal no tiene caja abierta.
func Abierto(ctx context.Context, c Consultador, sucursal string) (*TurnoAbierto, error) {
	var t TurnoAbierto
	var esperado, fondoBase, fondoInicial, ventas, ingresos, cobrosDelTurno, retiros, devoluciones, gastos jsmath.Num
	err := c.QueryRow(ctx, `
		SELECT s.id, s.branch_id, b.name, u.name, s.abierta_at,
		       coalesce(sum(m.monto), 0), b.fondo_base,
		       coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'apertura'), 0),
		       coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'venta'), 0),
		       coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'ingreso' AND NOT `+DevuelveUnGasto+` AND NOT `+EsUnCobro+`), 0),
		       coalesce(sum(m.monto) FILTER (WHERE `+EsUnCobro+`), 0),
		       coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'retiro'), 0),
		       coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'devolucion'), 0),
		       coalesce(sum(m.monto) FILTER (WHERE m.tipo NOT IN ('apertura', 'venta', 'ingreso', 'retiro', 'devolucion') OR `+DevuelveUnGasto+`), 0),
		       count(*) FILTER (WHERE m.tipo = 'venta')::int
		FROM cash_sessions s
		JOIN branches b ON b.id = s.branch_id
		JOIN "user" u ON u.id = s.abierta_por
		LEFT JOIN cash_movements m ON m.session_id = s.id
		WHERE s.branch_id = $1 AND s.estado = 'abierta'
		GROUP BY s.id, s.branch_id, b.name, b.fondo_base, u.name, s.abierta_at
		LIMIT 1`, sucursal).Scan(&t.ID, &t.BranchID, &t.Sucursal, &t.AbiertaPor, &t.AbiertaAt,
		&esperado, &fondoBase, &fondoInicial, &ventas, &ingresos, &cobrosDelTurno, &retiros, &devoluciones, &gastos, &t.CantidadDeVentas)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t.Esperado, t.FondoBase, t.FondoInicial = esperado.F(), fondoBase.F(), fondoInicial.F()
	t.VentasEnEfectivo, t.OtrosIngresos, t.Retiros = ventas.F(), ingresos.F(), retiros.F()
	t.Devoluciones, t.Gastos, t.Cobros = devoluciones.F(), gastos.F(), cobrosDelTurno.F()
	return &t, nil
}

// EsUnCobro: el ingreso (alias m) es el efectivo de un recibo
// (cobros.efectivoALaCaja lo anota «Recibo REC-… — …»).
const EsUnCobro = `coalesce(m.tipo = 'ingreso' AND left(m.motivo, 7) = 'Recibo ' AND m.expense_id IS NULL AND m.supplier_payment_id IS NULL, false)`

// DevuelveUnGasto: el ingreso (alias m) es el efectivo que vuelve de un gasto
// o de un pago anulado. Cuenta con los gastos y no como otro ingreso: el
// gasto anulado figuraba dos veces, «Gastos −$ 45.000» y «Otros ingresos»
// con los $ 45.000 de la anulación (mes simulado, M2S1-182).
const DevuelveUnGasto = `(m.tipo = 'ingreso' AND (m.expense_id IS NOT NULL OR m.supplier_payment_id IS NOT NULL))`

// Movimiento es un renglón del turno.
type Movimiento struct {
	ID        string    `json:"id"`
	Tipo      string    `json:"tipo"`
	Monto     float64   `json:"monto"`
	Motivo    *string   `json:"motivo"`
	OrderID   *string   `json:"orderId"`
	CreatedAt time.Time `json:"createdAt"`
	Quien     *string   `json:"quien"`
	Destino   *string   `json:"destino"`
	// Anulado: el gasto (o el pago) del renglón se anuló después; su
	// efectivo volvió con otro renglón. Se ve tachado (M2S1-182).
	Anulado bool `json:"anulado"`
	// OtroPuesto: lo cargó alguien que no es quien mira (en el mostrador,
	// quien está en la terminal) o, en el panel, quien abrió el turno: un
	// recibo cobrado desde el panel (M2S2-063). Contra quien abrió, el
	// vendedor de un turno que abrió el admin veía sus propias ventas como
	// cargadas por otro (mes 23, Casa Central).
	OtroPuesto bool `json:"otroPuesto"`
}

// consultaDeMovimientos son los renglones de los turnos de $1, del más nuevo
// al más viejo; %s filtra (es siempre de este archivo).
const consultaDeMovimientos = `
		SELECT m.session_id::text, m.id, m.tipo::text, m.monto, m.motivo, m.order_id, m.created_at, u.name, m.destino,
		       coalesce(e.anulado_at IS NOT NULL, false) OR coalesce(sp.anulado_at IS NOT NULL, false),
		       coalesce(m.tipo <> 'apertura' AND m.creado_por <> coalesce($2::text, s.abierta_por), false)
		FROM cash_movements m
		JOIN cash_sessions s ON s.id = m.session_id
		LEFT JOIN "user" u ON u.id = m.creado_por
		LEFT JOIN expenses e ON e.id = m.expense_id AND m.tipo <> 'ingreso'
		LEFT JOIN supplier_payments sp ON sp.id = m.supplier_payment_id AND m.tipo <> 'ingreso'
		WHERE m.session_id = ANY($1::uuid[]) %s
		ORDER BY m.created_at DESC`

func movimientos(ctx context.Context, c Consultador, sesiones []string, filtro string, quien *string) (map[string][]Movimiento, error) {
	por := map[string][]Movimiento{}
	if len(sesiones) == 0 {
		return por, nil
	}
	filas, err := c.Query(ctx, fmt.Sprintf(consultaDeMovimientos, filtro), sesiones, quien)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var sesion string
		var m Movimiento
		var monto jsmath.Num
		if err := filas.Scan(&sesion, &m.ID, &m.Tipo, &monto, &m.Motivo, &m.OrderID, &m.CreatedAt, &m.Quien, &m.Destino, &m.Anulado, &m.OtroPuesto); err != nil {
			return nil, err
		}
		m.Monto = monto.F()
		por[sesion] = append(por[sesion], m)
	}
	return por, filas.Err()
}

// MovimientosDelTurno, del más nuevo al más viejo; OtroPuesto, contra quien
// abrió el turno.
func MovimientosDelTurno(ctx context.Context, c Consultador, sesion string) ([]Movimiento, error) {
	return MovimientosDelTurnoPara(ctx, c, sesion, "")
}

// MovimientosDelTurnoPara es MovimientosDelTurno visto por `quien` (el
// usuario de la terminal): OtroPuesto es lo que cargó otra persona. Vacío,
// contra quien abrió el turno.
func MovimientosDelTurnoPara(ctx context.Context, c Consultador, sesion, quien string) ([]Movimiento, error) {
	var q *string
	if quien != "" {
		q = &quien
	}
	por, err := movimientos(ctx, c, []string{sesion}, "", q)
	if err != nil {
		return nil, err
	}
	if out := por[sesion]; out != nil {
		return out, nil
	}
	return []Movimiento{}, nil
}

// UltimoContado es lo que se contó al cerrar el último turno de la sucursal
// (nil si nunca cerró uno). Es con lo que abre el turno siguiente: abrir con
// la base y no con lo contado hacía desaparecer el efectivo que quedaba en el
// cajón entre turnos, $301.374 en una semana (mes simulado, H024 y H249).
func UltimoContado(ctx context.Context, c Consultador, sucursal string) (*float64, error) {
	var n *jsmath.Num
	err := c.QueryRow(ctx, `SELECT coalesce(contado_corregido, contado) FROM cash_sessions WHERE branch_id = $1 AND estado = 'cerrada' AND contado IS NOT NULL
		ORDER BY cerrada_at DESC LIMIT 1`, sucursal).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && n == nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v := n.F()
	return &v, nil
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
	ID      string  `json:"id"`
	Numero  string  `json:"numero"`
	Cliente string  `json:"cliente"`
	Total   float64 `json:"total"`
	// Devuelto es lo de las devoluciones parciales: la venta seguía diciendo
	// el total original, sin ninguna marca (mes simulado, PED-1202).
	Devuelto  float64 `json:"devuelto"`
	MedioPago *string `json:"medioPago"`
	// Medios son todos los de un pago partido, del más grande al más chico:
	// «Efectivo + Débito» y no solo el principal (mes simulado, H025).
	Medios []string `json:"medios"`
	// ConFactura: tiene factura viva, y se puede devolver una parte (H270).
	ConFactura bool      `json:"conFactura"`
	Estado     string    `json:"estado"`
	CreatedAt  time.Time `json:"createdAt"`
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
		SELECT id, numero, contacto_nombre, total,
		       coalesce((SELECT sum(d.importe) FROM devoluciones d WHERE d.order_id = orders.id), 0),
		       medio_pago::text,
		       coalesce((SELECT array_agg(p.medio::text ORDER BY p.importe DESC) FROM order_payments p WHERE p.order_id = orders.id), '{}'),
		       EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = orders.id AND i.tipo::text NOT LIKE 'nota%' AND i.estado <> 'anulada'),
		       estado::text, created_at
		FROM orders
		WHERE coalesce(caja_branch_id, branch_id) = $1 AND origen = 'mostrador' AND clave_mostrador IS NOT NULL AND created_at >= $2
		ORDER BY created_at DESC LIMIT 40`, sucursal, InicioDelDia(ahora))
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []VentaDeHoy{}
	for filas.Next() {
		var v VentaDeHoy
		var total, devuelto jsmath.Num
		if err := filas.Scan(&v.ID, &v.Numero, &v.Cliente, &total, &devuelto, &v.MedioPago, &v.Medios, &v.ConFactura, &v.Estado, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.Total, v.Devuelto = total.F(), devuelto.F()
		out = append(out, v)
	}
	return out, filas.Err()
}

// RenglonDelCierre es una fila del cierre Z: cuánto entró por cada medio, o
// cuánto se devolvió (Devolucion, con el total en negativo).
type RenglonDelCierre struct {
	MedioPago  string  `json:"medioPago"`
	Cantidad   int     `json:"cantidad"`
	Total      float64 `json:"total"`
	Devolucion bool    `json:"devolucion"`
	// Quien hizo las devoluciones parciales del renglón (nil en las ventas y
	// en las anulaciones): el control de las devoluciones es verlas.
	Quien *string `json:"quien"`
	// Cobranza: lo que entró por recibos de cuenta tomados en el mostrador
	// durante el turno, por medio. El cheque y la transferencia de un cobro
	// de cuenta no figuraban en ningún turno, y el vendedor no podía rendir
	// lo que cobró por banco (mes simulado, H176 y H259).
	Cobranza bool `json:"cobranza"`
	// DePedido: el cobro es de un pedido (el recibo nombra uno), no de la
	// cuenta. El cobro de PED-1035 en efectivo desde su ficha entraba al cajón
	// y en el Z no figuraba en ningún lado (mes simulado, M2S2-130).
	DePedido bool `json:"dePedido"`
	// Pedidos: en una devolución parcial, los pedidos devueltos; en un cobro
	// que tomó otra persona, sus recibos. La devolución decía el nombre del
	// vendedor y el cobro de otra vendedora no decía cuál era (M2S1-081,
	// M2S2-007).
	Pedidos *string `json:"pedidos"`
}

// MedioDeLaDevolucion es por dónde volvió la plata de una devolución parcial
// (alias d): efectivo si salió de la caja, la cuenta corriente, o el medio
// con que se había cobrado la venta si volvió «por afuera» (el tramo que la
// devolución anotó en el cobro, o el medio del pedido). Lo de afuera salía
// como «Cuenta corriente» (mes simulado, M2S1-081 y M3S1-060).
const MedioDeLaDevolucion = `CASE d.destino WHEN 'caja' THEN 'efectivo' WHEN 'afuera' THEN coalesce(
		  (SELECT p.medio::text FROM payment_refunds pr JOIN payments p ON p.id = pr.payment_id
		   WHERE pr.devolucion_id = d.id ORDER BY pr.importe DESC LIMIT 1),
		  (SELECT rr.medio::text FROM receipt_refunds rr WHERE rr.devolucion_id = d.id ORDER BY rr.importe DESC LIMIT 1),
		  (SELECT op.medio::text FROM order_payments op WHERE op.order_id = d.order_id AND op.medio NOT IN ('efectivo', 'cuenta_corriente')
		   ORDER BY op.importe DESC LIMIT 1),
		  (SELECT o2.medio_pago::text FROM orders o2 WHERE o2.id = d.order_id)) ELSE 'cuenta_corriente' END`

// anuladaEnElTurno es, sobre la venta `o` y el turno `s`, la venta del
// mostrador vendida y anulada en el mismo turno: no se cobró nada ni se
// devolvió nada, y el Z no la cuenta de ningún lado (M4-109: «Efectivo (4)»
// con la anulada adentro y aparte «Devoluciones −$ 8.820»). La anulada en
// otro turno sigue como antes: venta en el suyo, devolución en el de la
// anulación.
const anuladaEnElTurno = `(o.estado = 'cancelado' AND o.origen = 'mostrador' AND o.created_at >= s.abierta_at
	AND coalesce((SELECT max(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.estado = 'cancelado'), o.updated_at)
	    <= coalesce(s.cerrada_at, now()))`

// CierresDeTurnos es el cierre Z de cada turno: las ventas de la sucursal en
// la ventana del turno, por medio (order_payments, o el medio único de las
// ventas viejas), y aparte las devoluciones de las ventas anuladas durante
// el turno.
//
// Bug arreglado: las ventas se sumaban sin las anuladas. Anular hoy una venta
// de un turno ya cerrado le cambiaba el Z a ese turno —que ya se había
// arqueado contra otro número— y la devolución no se veía en ningún turno.
// Ahora la venta queda en el Z de su turno aunque después se anule, y la
// devolución aparece en el turno en que se anuló. El momento de la anulación
// es la fila «cancelado» del historial del pedido (la escribe el mostrador
// al anular); para las anuladas antes de eso, la última actualización.
//
// Las devoluciones parciales (facturacion.DevolucionParcial) van en el turno
// de la sucursal adonde entró la mercadería, el día que se hicieron, por medio
// y por quién las hizo. La anulación posterior de esa venta resta lo que ya
// devolvieron: es lo que de verdad salió en ese turno.
func CierresDeTurnos(ctx context.Context, c Consultador, sesiones []string) (map[string][]RenglonDelCierre, error) {
	por := map[string][]RenglonDelCierre{}
	if len(sesiones) == 0 {
		return por, nil
	}
	filas, err := c.Query(ctx, `
		SELECT s.id, false, coalesce(p.medio::text, o.medio_pago::text),
		       count(DISTINCT o.id)::int,
		       coalesce(sum(coalesce(p.importe, o.total)), 0), NULL::text, false, NULL::text, false
		FROM cash_sessions s
		JOIN orders o ON coalesce(o.caja_branch_id, o.branch_id) = s.branch_id AND o.origen = 'mostrador' AND o.clave_mostrador IS NOT NULL
		     AND o.created_at >= s.abierta_at
		     AND (s.cerrada_at IS NULL OR o.created_at <= s.cerrada_at)
		LEFT JOIN order_payments p ON p.order_id = o.id
		WHERE s.id = ANY($1::uuid[]) AND NOT `+anuladaEnElTurno+`
		GROUP BY s.id, coalesce(p.medio::text, o.medio_pago::text)
		UNION ALL
		SELECT s.id, true, coalesce(p.medio::text, a.medio_pago::text),
		       count(DISTINCT a.id)::int,
		       -coalesce(sum(coalesce(p.importe, a.total) - coalesce((SELECT sum(d.importe) FROM devoluciones d WHERE d.order_id = a.id
		          AND d.destino = CASE coalesce(p.medio::text, a.medio_pago::text) WHEN 'efectivo' THEN 'caja' WHEN 'cuenta_corriente' THEN 'cuenta' END), 0)), 0),
		       NULL::text, false, string_agg(DISTINCT a.numero, ', ' ORDER BY a.numero), false
		FROM cash_sessions s
		JOIN LATERAL (
		  SELECT o.id, o.numero, o.medio_pago, o.total,
		         coalesce((SELECT max(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.estado = 'cancelado'),
		                  o.updated_at) AS anulada_at
		  FROM orders o
		  WHERE coalesce(o.caja_branch_id, o.branch_id) = s.branch_id AND o.origen = 'mostrador' AND o.clave_mostrador IS NOT NULL AND o.estado = 'cancelado'
		    AND o.created_at <= coalesce(s.cerrada_at, now())
		    AND NOT `+anuladaEnElTurno+`
		) a ON a.anulada_at >= s.abierta_at AND (s.cerrada_at IS NULL OR a.anulada_at <= s.cerrada_at)
		LEFT JOIN order_payments p ON p.order_id = a.id
		WHERE s.id = ANY($1::uuid[])
		GROUP BY s.id, coalesce(p.medio::text, a.medio_pago::text)
		UNION ALL
		SELECT s.id, true, `+MedioDeLaDevolucion+`,
		       count(*)::int, -sum(d.importe), NULL::text, false, string_agg(DISTINCT o.numero, ', ' ORDER BY o.numero), false
		FROM cash_sessions s
		JOIN devoluciones d ON d.branch_id = s.branch_id AND d.created_at >= s.abierta_at
		     AND (s.cerrada_at IS NULL OR d.created_at <= s.cerrada_at)
		JOIN orders o ON o.id = d.order_id
		WHERE s.id = ANY($1::uuid[]) AND NOT `+anuladaEnElTurno+`
		  AND (d.destino = 'caja' OR coalesce(d.origen, 'mostrador') = 'mostrador')
		GROUP BY s.id, 3
		UNION ALL
		SELECT s.id, false, rp.medio::text, count(DISTINCT r.id)::int, coalesce(sum(rp.importe), 0), r.otro, true,
		       string_agg(DISTINCT r.numero, ', ' ORDER BY r.numero), r.pedido
		FROM cash_sessions s
		JOIN LATERAL (
		  SELECT r.id, r.numero, r.order_id IS NOT NULL AS pedido,
		         r.origen = 'mostrador' AND r.branch_id = s.branch_id
		           AND r.created_at >= s.abierta_at AND (s.cerrada_at IS NULL OR r.created_at <= s.cerrada_at) AS del_puesto,
		         CASE WHEN r.created_by_user_id <> s.abierta_por THEN u.name END AS otro
		  FROM receipts r LEFT JOIN "user" u ON u.id = r.created_by_user_id
		  WHERE r.estado <> 'anulado' AND (
		    (r.origen = 'mostrador' AND r.branch_id = s.branch_id
		     AND r.created_at >= s.abierta_at AND (s.cerrada_at IS NULL OR r.created_at <= s.cerrada_at))
		    OR EXISTS (SELECT 1 FROM cash_movements cm WHERE cm.session_id = s.id AND cm.tipo = 'ingreso'
		               AND cm.motivo LIKE 'Recibo ' || r.numero || ' —%'))
		) r ON true
		JOIN receipt_parts rp ON rp.receipt_id = r.id AND (r.del_puesto OR rp.medio = 'efectivo')
		WHERE s.id = ANY($1::uuid[])
		GROUP BY s.id, rp.medio, r.otro, r.pedido`, sesiones)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var id string
		var medio *string
		var r RenglonDelCierre
		var total jsmath.Num
		if err := filas.Scan(&id, &r.Devolucion, &medio, &r.Cantidad, &total, &r.Quien, &r.Cobranza, &r.Pedidos, &r.DePedido); err != nil {
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
	for id, rs := range por {
		por[id] = juntarDevoluciones(rs)
	}
	// Primero las ventas, de la más grande a la más chica; después los
	// cobros de cuenta y al final las devoluciones, igual.
	for _, rs := range por {
		sort.SliceStable(rs, func(i, j int) bool {
			if rs[i].Devolucion != rs[j].Devolucion {
				return !rs[i].Devolucion
			}
			if rs[i].Cobranza != rs[j].Cobranza {
				return !rs[i].Cobranza
			}
			if rs[i].Devolucion {
				return rs[i].Total < rs[j].Total
			}
			return rs[i].Total > rs[j].Total
		})
	}
	return por, nil
}

// juntarDevoluciones deja una sola fila de devoluciones por medio: las de
// las anulaciones (sin quién) y las parciales (una por quien las hizo) salían
// en filas separadas, «Efectivo» y «Efectivo · Prueba vendedor», y el
// vendedor rendía dos veces el mismo cajón (mes simulado). Quién las hizo
// sigue a la vista, junto al medio.
func juntarDevoluciones(rs []RenglonDelCierre) []RenglonDelCierre {
	out := make([]RenglonDelCierre, 0, len(rs))
	donde := map[string]int{}
	quienes := map[string][]string{}
	for _, r := range rs {
		if !r.Devolucion {
			out = append(out, r)
			continue
		}
		i, ya := donde[r.MedioPago]
		if !ya {
			donde[r.MedioPago] = len(out)
			r2 := r
			r2.Quien = nil
			out = append(out, r2)
			i = len(out) - 1
		} else {
			out[i].Cantidad += r.Cantidad
			out[i].Total = jsmath.Redondear2(float64(out[i].Total + r.Total))
			out[i].Pedidos = sumarPedidos(out[i].Pedidos, r.Pedidos)
		}
		if r.Quien != nil && !slices.Contains(quienes[r.MedioPago], *r.Quien) {
			quienes[r.MedioPago] = append(quienes[r.MedioPago], *r.Quien)
		}
	}
	for medio, i := range donde {
		if q := quienes[medio]; len(q) > 0 {
			t := strings.Join(q, ", ")
			out[i].Quien = &t
		}
	}
	return out
}

// sumarPedidos junta dos listas «PED-1, PED-2» sin repetir y en orden. Una
// venta con una devolución parcial y después anulada está en las dos.
func sumarPedidos(a, b *string) *string {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	todos := strings.Split(*a+", "+*b, ", ")
	slices.SortFunc(todos, func(x, y string) int {
		if len(x) != len(y) {
			return len(x) - len(y)
		}
		return strings.Compare(x, y)
	})
	t := strings.Join(slices.Compact(todos), ", ")
	return &t
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
