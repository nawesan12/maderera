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
}

// SucursalesConCaja es sucursalesConCaja: las activas, en su orden.
func (p *Panel) SucursalesConCaja(ctx context.Context) ([]SucursalConCaja, error) {
	filas, err := p.pool.Query(ctx, `
		SELECT b.id, b.name, b.fondo_base, s.id, s.abierta_at
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
		if err := filas.Scan(&x.ID, &x.Nombre, &f, &x.TurnoID, &x.AbiertaAt); err != nil {
			return nil, err
		}
		x.FondoBase = f.F()
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
	// Tardios son los movimientos que entraron después del arqueo (ventas
	// sin conexión que llegaron tarde): se marcan, no se esconden.
	Tardios int                `json:"tardios"`
	Cierre  []RenglonDelCierre `json:"cierre"`
}

// TurnosCerrados es turnosCerrados con cierresDeTurnos: los últimos
// `limite` turnos cerrados, del más nuevo al más viejo.
func (p *Panel) TurnosCerrados(ctx context.Context, limite int) ([]TurnoCerrado, error) {
	filas, err := p.pool.Query(ctx, `
		SELECT s.id, b.name, s.abierta_at, s.cerrada_at, s.contado, s.notas, u.name,
		       coalesce(sum(m.monto), 0),
		       count(*) FILTER (WHERE m.created_at > s.cerrada_at)::int
		FROM cash_sessions s
		JOIN branches b ON b.id = s.branch_id
		JOIN "user" u ON u.id = s.abierta_por
		LEFT JOIN cash_movements m ON m.session_id = s.id
		WHERE s.estado = 'cerrada'
		GROUP BY s.id, b.name, s.abierta_at, s.cerrada_at, s.contado, s.notas, u.name
		ORDER BY s.cerrada_at DESC
		LIMIT $1`, limite)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []TurnoCerrado{}
	ids := []string{}
	for filas.Next() {
		var t TurnoCerrado
		var contado *jsmath.Num
		var esperado jsmath.Num
		if err := filas.Scan(&t.ID, &t.Sucursal, &t.AbiertaAt, &t.CerradaAt, &contado, &t.Notas, &t.AbiertaPor, &esperado, &t.Tardios); err != nil {
			return nil, err
		}
		t.Esperado = esperado.F()
		if contado != nil {
			c := contado.F()
			t.Contado = &c
		}
		out = append(out, t)
		ids = append(ids, t.ID)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	cierres, err := CierresDeTurnos(ctx, p.pool, ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Cierre = cierres[out[i].ID]
		if out[i].Cierre == nil {
			out[i].Cierre = []RenglonDelCierre{}
		}
	}
	return out, nil
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
	ID               string     `json:"id"`
	Numero           string     `json:"numero"`
	NumeroProvisorio *string    `json:"numeroProvisorio"`
	BranchID         string     `json:"branchId"`
	Sucursal         *string    `json:"sucursal"`
	Cliente          string     `json:"cliente"`
	Total            float64    `json:"total"`
	CobradaAt        *time.Time `json:"cobradaAt"`
	CreatedAt        time.Time  `json:"createdAt"`
}

// VentasSinCaja es ventasSinCaja: las cobradas sin conexión mientras no
// había caja abierta (las 50 últimas).
func (p *Panel) VentasSinCaja(ctx context.Context) ([]VentaSuelta, error) {
	filas, err := p.pool.Query(ctx, `
		SELECT o.id, o.numero, o.numero_provisorio, o.branch_id, b.name, o.contacto_nombre, o.total, o.cobrada_at, o.created_at
		FROM orders o
		LEFT JOIN branches b ON b.id = o.branch_id
		LEFT JOIN cash_movements m ON m.order_id = o.id
		WHERE o.medio_pago = 'efectivo' AND o.origen = 'mostrador' AND o.estado <> 'cancelado'
		  AND o.cobrada_at IS NOT NULL AND m.id IS NULL
		ORDER BY o.cobrada_at DESC
		LIMIT 50`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []VentaSuelta{}
	for filas.Next() {
		var v VentaSuelta
		var branch *string
		var total jsmath.Num
		if err := filas.Scan(&v.ID, &v.Numero, &v.NumeroProvisorio, &branch, &v.Sucursal, &v.Cliente, &total, &v.CobradaAt, &v.CreatedAt); err != nil {
			return nil, err
		}
		// Una de mostrador siempre tiene sucursal; el filtro deja el tipo limpio.
		if branch == nil {
			continue
		}
		v.BranchID, v.Total = *branch, total.F()
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
}

// EmitidoPorCaja es emitidoPorCaja: lo emitido en el mostrador entre
// `desde` y `hasta` (incluido), lo más nuevo primero, hasta 200.
func (p *Panel) EmitidoPorCaja(ctx context.Context, desde, hasta time.Time) ([]Emitido, error) {
	filas, err := p.pool.Query(ctx, `
		SELECT o.id, o.numero, o.numero_provisorio, o.contacto_nombre, o.total, o.medio_pago::text, o.created_at,
		       b.name, u.name, i.id, i.punto_venta, i.numero::bigint, i.tipo::text
		FROM orders o
		LEFT JOIN branches b ON b.id = o.branch_id
		LEFT JOIN "user" u ON u.id = o.created_by_user_id
		LEFT JOIN invoices i ON i.order_id = o.id
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
			&e.Sucursal, &e.Operadora, &e.InvoiceID, &e.InvoicePuntoVenta, &e.InvoiceNumero, &e.InvoiceTipo); err != nil {
			return nil, err
		}
		e.Total = total.F()
		out = append(out, e)
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
	var total jsmath.Num
	var branch *string
	var cobrada *time.Time
	err = tx.QueryRow(ctx, `
		SELECT o.numero, o.total, o.branch_id, o.cobrada_at FROM orders o
		LEFT JOIN cash_movements m ON m.order_id = o.id
		WHERE o.id = $1 AND m.id IS NULL LIMIT 1`, orderID).Scan(&numero, &total, &branch, &cobrada)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", problema("Esa venta ya está asignada a un turno.")
	}
	if err != nil {
		return "", err
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
		sessionID, jsmath.Fijo2(total.F()), numero, orderID, ses.UserID, momento); err != nil {
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
