package caja

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas/fragmentos"
	"mjbj/internal/zodjs"
)

// La caja del panel (app/admin/caja y lib/dal/admin/cajas-fisicas.ts): los
// turnos cerrados con su cierre Z, las cajas físicas, las ventas que
// quedaron sin turno, lo emitido en el mostrador y el cambio fijo de cada
// sucursal. Nada de lo que se contó se edita desde acá, a propósito.

// Panel es el servicio de la caja del panel.
type Panel struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
	log  *slog.Logger
}

// NuevoPanel arma el servicio.
func NuevoPanel(pool *pgxpool.Pool, log *slog.Logger) *Panel {
	return &Panel{pool: pool, q: sqlc.New(pool), log: log}
}

// SucursalConCaja es una sucursal activa con su turno abierto, si hay.
type SucursalConCaja struct {
	ID        string     `json:"id"`
	Nombre    string     `json:"nombre"`
	FondoBase float64    `json:"fondoBase"`
	TurnoID   *string    `json:"turnoId"`
	AbiertaAt *time.Time `json:"abiertaAt"`
	// Esperado es el efectivo que tendría que haber ahora en el cajón del
	// turno abierto (la suma de sus movimientos, como el arqueo); nil sin
	// turno.
	Esperado *float64 `json:"esperado"`
}

// SucursalesConCaja es sucursalesConCaja: las activas, en su orden.
func (p *Panel) SucursalesConCaja(ctx context.Context) ([]SucursalConCaja, error) {
	filas, err := p.pool.Query(ctx, `
		SELECT b.id, b.name, b.fondo_base, s.id, s.abierta_at,
		       CASE WHEN s.id IS NOT NULL THEN (SELECT coalesce(sum(m.monto), 0) FROM cash_movements m WHERE m.session_id = s.id) END
		FROM branches b
		LEFT JOIN cash_sessions s ON s.branch_id = b.id AND s.estado = 'abierta'
		WHERE b.active = true
		ORDER BY b.sort_order`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []SucursalConCaja{}
	for filas.Next() {
		var x SucursalConCaja
		var f jsmath.Num
		var esperado *jsmath.Num
		if err := filas.Scan(&x.ID, &x.Nombre, &f, &x.TurnoID, &x.AbiertaAt, &esperado); err != nil {
			return nil, err
		}
		x.FondoBase = f.F()
		if esperado != nil {
			e := esperado.F()
			x.Esperado = &e
		}
		out = append(out, x)
	}
	return out, filas.Err()
}

// TurnoCerrado es una fila del historial de turnos, con su cierre Z.
type TurnoCerrado struct {
	ID         string     `json:"id"`
	Sucursal   string     `json:"sucursal"`
	AbiertaAt  time.Time  `json:"abiertaAt"`
	CerradaAt  *time.Time `json:"cerradaAt"`
	Contado    *float64   `json:"contado"`
	Notas      *string    `json:"notas"`
	AbiertaPor string     `json:"abiertaPor"`
	Esperado   float64    `json:"esperado"`
	// Esperado es lo que tendría que haber habido al arquear: lo que entró
	// hasta cerrada_at. Tardios son los movimientos que llegaron después
	// (ventas y retiros sin conexión): van aparte, con su monto (T3,
	// hallazgo 9). El que sacó plata no cambia la diferencia de una caja ya
	// contada: un retiro con fecha vieja borraba un faltante. El que entró con
	// una hora declarada dentro del turno sí suma al esperado: la plata
	// estaba en el cajón cuando se contó, y dejarla afuera dejaba un
	// sobrante falso para siempre (que además tapaba un faltante del mismo
	// monto). Sumar plata al esperado no puede esconder nada: solo agranda
	// un faltante.
	Tardios      int     `json:"tardios"`
	TardiosMonto float64 `json:"tardiosMonto"`
	// BajoLista son las ventas sin conexión del turno que pasaron lo libre
	// sin PIN (T3): ya pasaron y no se rechazan, pero se ven en rojo en el
	// cierre, con lo que dejaron de cobrar.
	BajoLista      int     `json:"bajoLista"`
	BajoListaMonto float64 `json:"bajoListaMonto"`
	// CreditoSinAutorizar: las del turno que cargaron a cuenta corriente
	// pasado el límite o con mora, sin PIN (revisión de T3).
	CreditoSinAutorizar      int                `json:"creditoSinAutorizar"`
	CreditoSinAutorizarMonto float64            `json:"creditoSinAutorizarMonto"`
	Cierre                   []RenglonDelCierre `json:"cierre"`
}

// TurnosCerrados son los turnos cerrados entre `desde` y `hasta` (el mes
// argentino de la pantalla), del más nuevo al más viejo, de a `limite` a
// partir de `desplazamiento`, con cuántos hay en total para paginar. Antes
// traía los últimos 30 sin importar el mes elegido arriba, y el turno de hace
// dos meses que había que revisar no aparecía nunca.
func (p *Panel) TurnosCerrados(ctx context.Context, desde, hasta time.Time, limite, desplazamiento int) ([]TurnoCerrado, int, error) {
	var total int
	if err := p.pool.QueryRow(ctx, `SELECT count(*)::int FROM cash_sessions WHERE estado = 'cerrada' AND cerrada_at >= $1 AND cerrada_at <= $2`,
		desde, hasta).Scan(&total); err != nil {
		return nil, 0, err
	}
	filas, err := p.pool.Query(ctx, `
		SELECT s.id, b.name, s.abierta_at, s.cerrada_at, s.contado, s.notas, u.name,
		       coalesce(sum(m.monto) FILTER (WHERE m.created_at <= s.cerrada_at
		                                 OR (m.monto > 0 AND m.declarado_at IS NOT NULL AND m.declarado_at <= s.cerrada_at)), 0),
		       count(m.id) FILTER (WHERE m.created_at > s.cerrada_at)::int,
		       coalesce(sum(m.monto) FILTER (WHERE m.created_at > s.cerrada_at), 0),
		       (SELECT count(*)::int FROM orders o WHERE o.bajo_lista_sin_autorizar AND o.branch_id = s.branch_id
		          AND coalesce(o.cobrada_at, o.created_at) BETWEEN s.abierta_at AND s.cerrada_at),
		       (SELECT coalesce(sum(o.dejado_de_cobrar), 0) FROM orders o WHERE o.bajo_lista_sin_autorizar AND o.branch_id = s.branch_id
		          AND coalesce(o.cobrada_at, o.created_at) BETWEEN s.abierta_at AND s.cerrada_at),
		       (SELECT count(*)::int FROM orders o WHERE o.credito_sin_autorizar > 0 AND o.branch_id = s.branch_id
		          AND coalesce(o.cobrada_at, o.created_at) BETWEEN s.abierta_at AND s.cerrada_at),
		       (SELECT coalesce(sum(o.credito_sin_autorizar), 0) FROM orders o WHERE o.credito_sin_autorizar > 0 AND o.branch_id = s.branch_id
		          AND coalesce(o.cobrada_at, o.created_at) BETWEEN s.abierta_at AND s.cerrada_at)
		FROM cash_sessions s
		JOIN branches b ON b.id = s.branch_id
		JOIN "user" u ON u.id = s.abierta_por
		LEFT JOIN cash_movements m ON m.session_id = s.id
		WHERE s.estado = 'cerrada' AND s.cerrada_at >= $1 AND s.cerrada_at <= $2
		GROUP BY s.id, b.name, s.abierta_at, s.cerrada_at, s.contado, s.notas, u.name
		ORDER BY s.cerrada_at DESC
		LIMIT $3 OFFSET $4`, desde, hasta, limite, desplazamiento)
	if err != nil {
		return nil, 0, err
	}
	defer filas.Close()
	out := []TurnoCerrado{}
	ids := []string{}
	for filas.Next() {
		var t TurnoCerrado
		var contado *jsmath.Num
		var esperado, tardios, bajoLista, credito jsmath.Num
		if err := filas.Scan(&t.ID, &t.Sucursal, &t.AbiertaAt, &t.CerradaAt, &contado, &t.Notas, &t.AbiertaPor, &esperado, &t.Tardios, &tardios,
			&t.BajoLista, &bajoLista, &t.CreditoSinAutorizar, &credito); err != nil {
			return nil, 0, err
		}
		t.Esperado, t.TardiosMonto, t.BajoListaMonto, t.CreditoSinAutorizarMonto = esperado.F(), tardios.F(), bajoLista.F(), credito.F()
		if contado != nil {
			c := contado.F()
			t.Contado = &c
		}
		out = append(out, t)
		ids = append(ids, t.ID)
	}
	if err := filas.Err(); err != nil {
		return nil, 0, err
	}
	cierres, err := CierresDeTurnos(ctx, p.pool, ids)
	if err != nil {
		return nil, 0, err
	}
	for i := range out {
		out[i].Cierre = cierres[out[i].ID]
		if out[i].Cierre == nil {
			out[i].Cierre = []RenglonDelCierre{}
		}
	}
	return out, total, nil
}

// CajaFisica es una máquina del mostrador.
type CajaFisica struct {
	ID          string     `json:"id"`
	Codigo      string     `json:"codigo"`
	Nombre      *string    `json:"nombre"`
	BranchID    *string    `json:"branchId"`
	Sucursal    *string    `json:"sucursal"`
	Activo      bool       `json:"activo"`
	UltimaVezAt *time.Time `json:"ultimaVezAt"`
	Pendientes  int        `json:"pendientes"`
}

// ListarCajasFisicas es listarCajasFisicas: todas, por código.
func (p *Panel) ListarCajasFisicas(ctx context.Context) ([]CajaFisica, error) {
	filas, err := p.pool.Query(ctx, `
		SELECT d.id, d.codigo, d.nombre, d.branch_id, b.name, d.activo, d.ultima_vez_at, d.pendientes
		FROM pos_devices d LEFT JOIN branches b ON b.id = d.branch_id
		ORDER BY d.codigo`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []CajaFisica{}
	for filas.Next() {
		var c CajaFisica
		if err := filas.Scan(&c.ID, &c.Codigo, &c.Nombre, &c.BranchID, &c.Sucursal, &c.Activo, &c.UltimaVezAt, &c.Pendientes); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, filas.Err()
}

var codigoDeCaja = regexp.MustCompile(`^[A-Za-z0-9-]+$`)

// AltaDeCaja es lo que queda del formulario después del esquema.
type AltaDeCaja struct {
	Codigo   string
	Nombre   *string
	BranchID string
}

// LeerAltaDeCaja es altaSchema de app/admin/caja/actions.ts: el primer
// error (campo y mensaje) como lo daba zod.
func LeerAltaDeCaja(cuerpo any) (AltaDeCaja, error) {
	l := zodjs.Raiz(cuerpo)
	codigo := l.Requerido("codigo", zodjs.Texto{Recortar: true, Min: 2, MsjMin: "El código es muy corto.", Max: 20,
		Patron: codigoDeCaja, MsjPatron: "Usá solo letras, números y guiones."})
	nombre := l.Cadena("nombre", zodjs.Texto{Recortar: true, Max: 80, Opcional: true})
	branch := l.Requerido("branchId", zodjs.Texto{UUID: true, MsjUUID: "Elegí la sucursal."})
	if !l.Ok() {
		return AltaDeCaja{}, l.Problema()
	}
	a := AltaDeCaja{Codigo: codigo, BranchID: branch}
	if nombre != nil && *nombre != "" {
		a.Nombre = nombre
	}
	return a, nil
}

// CajaCreada es la caja recién dada de alta. El secreto se muestra una sola
// vez, al vincular la máquina.
type CajaCreada struct {
	ID      string `json:"id"`
	Codigo  string `json:"codigo"`
	Secreto string `json:"-"`
}

// MsjCodigoRepetido es el aviso del código que ya existe.
const MsjCodigoRepetido = "Ya existe una caja con ese código."

// CrearCaja es crearCaja + crearCajaFisica: el código en mayúsculas, el
// secreto al azar (24 bytes en base64url) y la bitácora. El código lo
// asigna el servidor y es único (pos_devices_codigo_idx): dos altas a la
// vez con el mismo código dan una caja y un aviso, no un error crudo.
func (p *Panel) CrearCaja(ctx context.Context, ses *auth.Sesion, cuerpo any) (CajaCreada, error) {
	a, err := LeerAltaDeCaja(cuerpo)
	if err != nil {
		return CajaCreada{}, err
	}
	codigo := strings.ToUpper(zodjs.TrimJS(a.Codigo))
	crudo := make([]byte, 24)
	if _, err := rand.Read(crudo); err != nil {
		return CajaCreada{}, err
	}
	c := CajaCreada{Codigo: codigo, Secreto: base64.RawURLEncoding.EncodeToString(crudo)}
	err = p.pool.QueryRow(ctx, `INSERT INTO pos_devices (codigo, nombre, branch_id, secreto) VALUES ($1, $2, $3, $4) RETURNING id`,
		codigo, a.Nombre, a.BranchID, c.Secreto).Scan(&c.ID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.ConstraintName == "pos_devices_codigo_idx" {
			return CajaCreada{}, plataforma.Invalido(map[string]string{"codigo": MsjCodigoRepetido})
		}
		return CajaCreada{}, err
	}
	bitacora.Anotar(ctx, p.q, p.log, ses, sqlc.AccionAuditoriaCrear, "caja", "", "Dio de alta la caja "+codigo, nil)
	return c, nil
}

func problema(m string) error { return plataforma.NuevoProblema(http.StatusUnprocessableEntity, m) }

// DarDeBajaCaja es darDeBajaCaja: no se borra (sus tickets viejos llevan el
// código), y no se da de baja con ventas sin subir.
func (p *Panel) DarDeBajaCaja(ctx context.Context, ses *auth.Sesion, id string) (string, error) {
	if !plataforma.UUIDValido(id) {
		return "", problema("Esa caja no existe.")
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var codigo string
	var pendientes int
	err = tx.QueryRow(ctx, `SELECT codigo, pendientes FROM pos_devices WHERE id = $1 FOR UPDATE`, id).Scan(&codigo, &pendientes)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", problema("Esa caja no existe.")
	}
	if err != nil {
		return "", err
	}
	if pendientes > 0 {
		ventas := "ventas cobradas"
		if pendientes == 1 {
			ventas = "venta cobrada"
		}
		return "", problema(fmt.Sprintf("%s tiene %d %s que todavía no subieron. Conectá la caja y esperá a que suban antes de darla de baja.", codigo, pendientes, ventas))
	}
	if _, err := tx.Exec(ctx, `UPDATE pos_devices SET activo = false WHERE id = $1`, id); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, p.q, p.log, ses, sqlc.AccionAuditoriaCambiarEstado, "caja", "", "Dio de baja la caja "+codigo, nil)
	return codigo + " quedó fuera de servicio.", nil
}

// VentaSuelta es una venta en efectivo que no cayó en ningún turno.
type VentaSuelta struct {
	ID               string  `json:"id"`
	Numero           string  `json:"numero"`
	NumeroProvisorio *string `json:"numeroProvisorio"`
	BranchID         string  `json:"branchId"`
	Sucursal         *string `json:"sucursal"`
	Cliente          string  `json:"cliente"`
	Total            float64 `json:"total"`
	// Efectivo es la parte que se cobró en efectivo: lo que entra al cajón.
	Efectivo  float64    `json:"efectivo"`
	CobradaAt *time.Time `json:"cobradaAt"`
	CreatedAt time.Time  `json:"createdAt"`
}

// parteEnEfectivo es la parte en efectivo de una venta (de `orders o`): la
// suma de sus pagos en efectivo (order_payments), o el total si es una venta
// vieja sin pagos partidos cuyo medio fue efectivo. Una venta mixta (tarjeta
// más efectivo) mete al cajón solo el efectivo, como al cobrarla.
const parteEnEfectivo = `coalesce(
		  (SELECT sum(pp.importe) FROM order_payments pp WHERE pp.order_id = o.id AND pp.medio = 'efectivo'),
		  CASE WHEN o.medio_pago = 'efectivo' AND NOT EXISTS (SELECT 1 FROM order_payments pp WHERE pp.order_id = o.id) THEN o.total END,
		  0)`

// VentasSinCaja es ventasSinCaja: las cobradas sin conexión mientras no
// había caja abierta (las 50 últimas). Toda venta con parte en efectivo,
// aunque el medio principal sea otro: el TS miraba solo medio_pago y una
// venta de débito con un poco en efectivo nunca aparecía.
func (p *Panel) VentasSinCaja(ctx context.Context) ([]VentaSuelta, error) {
	filas, err := p.pool.Query(ctx, `
		SELECT id, numero, numero_provisorio, branch_id, sucursal, contacto_nombre, total, efectivo, cobrada_at, created_at FROM (
		  SELECT o.id, o.numero, o.numero_provisorio, o.branch_id, b.name AS sucursal, o.contacto_nombre, o.total,
		         `+parteEnEfectivo+` AS efectivo, o.cobrada_at, o.created_at
		  FROM orders o
		  LEFT JOIN branches b ON b.id = o.branch_id
		  LEFT JOIN cash_movements m ON m.order_id = o.id
		  WHERE o.origen = 'mostrador' AND o.estado <> 'cancelado'
		    AND o.cobrada_at IS NOT NULL AND m.id IS NULL
		) v
		WHERE efectivo > 0
		ORDER BY cobrada_at DESC
		LIMIT 50`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []VentaSuelta{}
	for filas.Next() {
		var v VentaSuelta
		var branch *string
		var total, efectivo jsmath.Num
		if err := filas.Scan(&v.ID, &v.Numero, &v.NumeroProvisorio, &branch, &v.Sucursal, &v.Cliente, &total, &efectivo, &v.CobradaAt, &v.CreatedAt); err != nil {
			return nil, err
		}
		// Una de mostrador siempre tiene sucursal; el filtro deja el tipo limpio.
		if branch == nil {
			continue
		}
		v.BranchID, v.Total, v.Efectivo = *branch, total.F(), efectivo.F()
		out = append(out, v)
	}
	return out, filas.Err()
}

// TurnoParaAsignar es un turno al que se puede mandar una venta suelta.
type TurnoParaAsignar struct {
	ID        string     `json:"id"`
	AbiertaAt time.Time  `json:"abiertaAt"`
	CerradaAt *time.Time `json:"cerradaAt"`
	Estado    string     `json:"estado"`
	// Etiqueta: «5/3 08:04 a. m.», en hora argentina. El TS la armaba en la
	// página con la zona de Next (UTC): un turno de las 9 decía las 12.
	Etiqueta string `json:"etiqueta"`
}

// EtiquetaDeTurno es la del selector: el día y la hora de apertura como los
// escribe toLocaleDateString/toLocaleTimeString de es-AR, y «(abierto)».
func EtiquetaDeTurno(abierta time.Time, estado string) string {
	a := abierta.In(Argentina)
	h := a.Hour() % 12
	if h == 0 {
		h = 12
	}
	sufijo := "a. m."
	if a.Hour() >= 12 {
		sufijo = "p. m."
	}
	e := fmt.Sprintf("%d/%d %02d:%02d %s", a.Day(), int(a.Month()), h, a.Minute(), sufijo)
	if estado == "abierta" {
		e += " (abierto)"
	}
	return e
}

// TurnosParaAsignar son los últimos 10 turnos de la sucursal.
func (p *Panel) TurnosParaAsignar(ctx context.Context, sucursal string) ([]TurnoParaAsignar, error) {
	out := []TurnoParaAsignar{}
	if !plataforma.UUIDValido(sucursal) {
		return out, nil
	}
	filas, err := p.pool.Query(ctx, `
		SELECT id, abierta_at, cerrada_at, estado::text FROM cash_sessions
		WHERE branch_id = $1 ORDER BY abierta_at DESC LIMIT 10`, sucursal)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var t TurnoParaAsignar
		if err := filas.Scan(&t.ID, &t.AbiertaAt, &t.CerradaAt, &t.Estado); err != nil {
			return nil, err
		}
		t.Etiqueta = EtiquetaDeTurno(t.AbiertaAt, t.Estado)
		out = append(out, t)
	}
	return out, filas.Err()
}

// Emitido es una venta de mostrador con sus papeles, para reimprimirla
// desde cualquier equipo.
type Emitido struct {
	OrderID           string    `json:"orderId"`
	Numero            string    `json:"numero"`
	NumeroProvisorio  *string   `json:"numeroProvisorio"`
	Cliente           string    `json:"cliente"`
	Total             float64   `json:"total"`
	MedioPago         *string   `json:"medioPago"`
	CreatedAt         time.Time `json:"createdAt"`
	Sucursal          *string   `json:"sucursal"`
	Operadora         *string   `json:"operadora"`
	InvoiceID         *string   `json:"invoiceId"`
	InvoicePuntoVenta *int32    `json:"invoicePuntoVenta"`
	InvoiceNumero     *int64    `json:"invoiceNumero"`
	InvoiceTipo       *string   `json:"invoiceTipo"`
	// La anulación, si la hubo: quién, cuándo y por qué, del último paso a
	// «cancelado» del historial (mostrador.Anular). La Caja mostraba la venta
	// anulada como si fuera válida.
	Anulada    bool       `json:"anulada"`
	AnuladaPor *string    `json:"anuladaPor"`
	AnuladaAt  *time.Time `json:"anuladaAt"`
	Motivo     *string    `json:"motivo"`
	// FacturaViva: anulada y con la factura autorizada sin su nota de
	// crédito (fragmentos.FacturaViva).
	FacturaViva bool `json:"facturaViva"`
}

// notaDeAnulacion es el prefijo con que mostrador.Anular deja el motivo en
// el historial.
const notaDeAnulacion = "Anulada en el mostrador: "

// EmitidoPorCaja es emitidoPorCaja: lo emitido en el mostrador entre
// `desde` y `hasta` (incluido), lo más nuevo primero, hasta 200.
func (p *Panel) EmitidoPorCaja(ctx context.Context, desde, hasta time.Time) ([]Emitido, error) {
	filas, err := p.pool.Query(ctx, `
		SELECT o.id, o.numero, o.numero_provisorio, o.contacto_nombre, o.total, o.medio_pago::text, o.created_at,
		       b.name, u.name, i.id, i.punto_venta, i.numero::bigint, i.tipo::text,
		       o.estado = 'cancelado', anulacion.quien, anulacion.created_at, anulacion.nota,
		       o.estado = 'cancelado' AND `+fragmentos.FacturaViva+`
		FROM orders o
		LEFT JOIN branches b ON b.id = o.branch_id
		LEFT JOIN "user" u ON u.id = o.created_by_user_id
		-- La factura y no su nota de crédito: con las dos, la venta salía
		-- dos veces.
		LEFT JOIN LATERAL (SELECT f.id, f.punto_venta, f.numero, f.tipo FROM invoices f
		                   WHERE f.order_id = o.id ORDER BY f.tipo::text LIKE 'nota_credito%', f.created_at LIMIT 1) i ON true
		LEFT JOIN LATERAL (SELECT h.created_at, h.nota, hu.name AS quien FROM order_status_history h
		                   LEFT JOIN "user" hu ON hu.id = h.created_by_user_id
		                   WHERE h.order_id = o.id AND h.estado = 'cancelado'
		                   ORDER BY h.created_at DESC LIMIT 1) anulacion ON o.estado = 'cancelado'
		WHERE o.origen = 'mostrador' AND o.created_at >= $1 AND o.created_at <= $2
		ORDER BY o.created_at DESC
		LIMIT 200`, desde, hasta)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Emitido{}
	for filas.Next() {
		var e Emitido
		var total jsmath.Num
		if err := filas.Scan(&e.OrderID, &e.Numero, &e.NumeroProvisorio, &e.Cliente, &total, &e.MedioPago, &e.CreatedAt,
			&e.Sucursal, &e.Operadora, &e.InvoiceID, &e.InvoicePuntoVenta, &e.InvoiceNumero, &e.InvoiceTipo,
			&e.Anulada, &e.AnuladaPor, &e.AnuladaAt, &e.Motivo, &e.FacturaViva); err != nil {
			return nil, err
		}
		e.Total = total.F()
		if e.Motivo != nil {
			m := strings.TrimSpace(strings.TrimPrefix(*e.Motivo, notaDeAnulacion))
			e.Motivo = &m
			if m == "" {
				e.Motivo = nil
			}
		}
		out = append(out, e)
	}
	return out, filas.Err()
}

// AnulacionesDeUnaPersona son las ventas del mostrador que anuló alguien
// en el mes.
type AnulacionesDeUnaPersona struct {
	Quien    string  `json:"quien"`
	Cantidad int     `json:"cantidad"`
	Total    float64 `json:"total"`
	// Devuelto es el efectivo que salió del cajón por esas anulaciones (los
	// movimientos «devolucion»): lo que importa para el control. La parte
	// con tarjeta o a cuenta nunca entró al cajón.
	Devuelto float64 `json:"devuelto"`
}

// AnulacionesPorPersona cuenta las anulaciones del mostrador entre `desde` y
// `hasta` (incluido) por quien las hizo, la que más anuló primero.
//
// Va por la fecha de la anulación (el último paso a «cancelado» del
// historial, la misma regla que AnuladasDeLaSemana del Resumen) y sin tope.
// La pantalla las sumaba sobre lo emitido, que corta en las 200 ventas más
// nuevas y por la fecha de la venta: en un mes de más de 200 ventas las
// anulaciones de la primera quincena no contaban, y la venta del 30
// anulada el 2 no aparecía en ningún mes. Es el control para que no falte
// plata: no puede informar de menos sin avisar.
func (p *Panel) AnulacionesPorPersona(ctx context.Context, desde, hasta time.Time) ([]AnulacionesDeUnaPersona, error) {
	filas, err := p.pool.Query(ctx, `
		SELECT coalesce(a.quien, 'Sin nombre'), count(*)::int, coalesce(sum(o.total), 0),
		       coalesce(sum((SELECT -sum(m.monto) FROM cash_movements m WHERE m.order_id = o.id AND m.tipo = 'devolucion')), 0)
		FROM orders o
		JOIN LATERAL (SELECT h.created_at, hu.name AS quien FROM order_status_history h
		              LEFT JOIN "user" hu ON hu.id = h.created_by_user_id
		              WHERE h.order_id = o.id AND h.estado = 'cancelado'
		              ORDER BY h.created_at DESC LIMIT 1) a ON true
		WHERE o.origen = 'mostrador' AND o.estado = 'cancelado' AND a.created_at >= $1 AND a.created_at <= $2
		GROUP BY 1 ORDER BY 2 DESC, 3 DESC, 1`, desde, hasta)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []AnulacionesDeUnaPersona{}
	for filas.Next() {
		var a AnulacionesDeUnaPersona
		var total, devuelto jsmath.Num
		if err := filas.Scan(&a.Quien, &a.Cantidad, &total, &devuelto); err != nil {
			return nil, err
		}
		a.Total, a.Devuelto = total.F(), devuelto.F()
		out = append(out, a)
	}
	return out, filas.Err()
}

// AsignarVentaAlTurno es asignarVentaAlTurno: mete una venta suelta en un
// turno de su sucursal, con la hora en que se cobró.
//
// El TS leía «la venta sin movimiento» y lo anotaba en la misma transacción,
// pero sin bloquear nada: dos clics a la vez leían los dos que no estaba
// asignada y el efectivo entraba dos veces al turno (un sobrante
// inventado). Acá se bloquea la fila del pedido antes de mirar.
func (p *Panel) AsignarVentaAlTurno(ctx context.Context, ses *auth.Sesion, orderID, sessionID string) (string, error) {
	if !plataforma.UUIDValido(orderID) {
		return "", problema("Esa venta ya está asignada a un turno.")
	}
	if !plataforma.UUIDValido(sessionID) {
		return "", problema("Ese turno no existe.")
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if !sinCandadoDeAsignacion {
		if _, err := tx.Exec(ctx, `SELECT 1 FROM orders WHERE id = $1 FOR UPDATE`, orderID); err != nil {
			return "", err
		}
	}
	var numero string
	var efectivo jsmath.Num
	var branch *string
	var cobrada *time.Time
	err = tx.QueryRow(ctx, `
		SELECT o.numero, `+parteEnEfectivo+`, o.branch_id, o.cobrada_at FROM orders o
		LEFT JOIN cash_movements m ON m.order_id = o.id
		WHERE o.id = $1 AND m.id IS NULL LIMIT 1`, orderID).Scan(&numero, &efectivo, &branch, &cobrada)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", problema("Esa venta ya está asignada a un turno.")
	}
	if err != nil {
		return "", err
	}
	// Al cajón entra solo la parte en efectivo; una venta sin efectivo no
	// tiene nada que hacer en la caja.
	if !(efectivo.F() > 0) {
		return "", problema("Esa venta no se cobró en efectivo: no va a la caja.")
	}
	var turnoBranch string
	err = tx.QueryRow(ctx, `SELECT branch_id FROM cash_sessions WHERE id = $1`, sessionID).Scan(&turnoBranch)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", problema("Ese turno no existe.")
	}
	if err != nil {
		return "", err
	}
	if branch == nil || *branch != turnoBranch {
		return "", problema("Ese turno es de otra sucursal.")
	}
	momento := time.Now()
	if cobrada != nil {
		momento = *cobrada
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO cash_movements (session_id, tipo, monto, motivo, order_id, creado_por, created_at)
		VALUES ($1, 'venta', $2::numeric, $3, $4, $5, $6)`,
		sessionID, jsmath.Fijo2(efectivo.F()), numero, orderID, ses.UserID, momento); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, p.q, p.log, ses, sqlc.AccionAuditoriaEditar, "caja", "", "Asignó la venta "+numero+" a un turno de caja", nil)
	return numero + " quedó en el turno.", nil
}

// sinCandadoDeAsignacion: solo para ver fallar la prueba de concurrencia.
var sinCandadoDeAsignacion = false

// MesArgentino es leerPeriodoMensual («aaaa-mm», o el mes de `ahora`) en
// hora argentina: el primer instante del mes y el último milisegundo. El TS
// cortaba en la zona de Next (UTC): una venta del 31 a las 22 caía en el mes
// siguiente.
func MesArgentino(valor string, ahora time.Time) (time.Time, time.Time) {
	a := ahora.In(Argentina)
	anioTexto, resto, _ := strings.Cut(valor, "-")
	mesTexto, _, _ := strings.Cut(resto, "-")
	numeroONulo := func(t string) int {
		n := jsmath.Numero(t)
		if n != n {
			return 0
		}
		return int(n)
	}
	anio := numeroONulo(anioTexto)
	if anio == 0 {
		anio = a.Year()
	}
	mes := numeroONulo(mesTexto)
	if mes == 0 {
		mes = int(a.Month())
	}
	mes = min(max(mes, 1), 12)
	return time.Date(anio, time.Month(mes), 1, 0, 0, 0, 0, Argentina),
		time.Date(anio, time.Month(mes)+1, 0, 23, 59, 59, 999_000_000, Argentina)
}

// MsjFondoBaseInvalido es el único error del cambio fijo.
const MsjFondoBaseInvalido = "Revisá el monto: tiene que ser un número de cero para arriba."

// LeerFondoBase es el esquema de guardarFondoBase: branchId uuid y monto
// z.coerce.number().min(0).max(10_000_000). Cualquier error da el mismo
// mensaje.
func LeerFondoBase(branchID string, monto any) (float64, bool) {
	l := zodjs.Leer(map[string]any{"branchId": branchID, "monto": monto})
	l.Cadena("branchId", zodjs.Texto{UUID: true})
	n := l.Numero("monto", zodjs.Num{Coerce: true}, zodjs.Min(0), zodjs.Max(10_000_000))
	if !l.Ok() || n == nil {
		return 0, false
	}
	return *n, true
}

// GuardarFondoBase es guardarFondoBase: el cambio que tiene que quedar en el
// cajón de la sucursal (solo el admin: es quien no tiene la tentación de
// bajarlo para poder retirar).
func (p *Panel) GuardarFondoBase(ctx context.Context, ses *auth.Sesion, branchID string, monto any) (string, error) {
	n, ok := LeerFondoBase(branchID, monto)
	if !ok {
		return "", problema(MsjFondoBaseInvalido)
	}
	var nombre string
	err := p.pool.QueryRow(ctx, `UPDATE branches SET fondo_base = $2::numeric WHERE id = $1 RETURNING name`, branchID, jsmath.Fijo2(n)).Scan(&nombre)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", problema("Esa sucursal no existe.")
	}
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, p.q, p.log, ses, sqlc.AccionAuditoriaEditar, "caja", "", "Fijó el cambio fijo de "+nombre+" en $"+jsmath.Fijo2(n), nil)
	if n > 0 {
		return "Listo: el mostrador no va a poder retirar por debajo de ese monto.", nil
	}
	return "Listo: sin cambio fijo, no se controla el retiro.", nil
}
