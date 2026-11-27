package clientes

import (
	"context"
	"errors"
	"fmt"
	"mjbj/internal/busqueda"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
)

// ClienteListado es una fila de la cartera (lib/dal/admin/clientes.ts), con
// lo que deudaPorCliente sumaba aparte: lo vencido y la prioridad de
// cobranza, solo para quien debe.
type ClienteListado struct {
	ID              string          `json:"id"`
	Nombre          string          `json:"nombre"`
	RazonSocial     *string         `json:"razonSocial"`
	Cuit            *string         `json:"cuit"`
	Rubro           *string         `json:"rubro"`
	Tipo            string          `json:"tipo"`
	Estado          string          `json:"estado"`
	Asesor          *string         `json:"asesor"`
	Telefono        *string         `json:"telefono"`
	Email           *string         `json:"email"`
	Saldo           float64         `json:"saldo"`
	LimiteCredito   float64         `json:"limiteCredito"`
	DiasCredito     int32           `json:"diasCredito"`
	CuentaBloqueada bool            `json:"cuentaBloqueada"`
	MotivoBloqueo   *string         `json:"motivoBloqueo"`
	TotalComprado   float64         `json:"totalComprado"`
	UltimaCompra    *time.Time      `json:"ultimaCompra"`
	Deuda           *DeudaDeCliente `json:"deuda"`
}

// DeudaDeCliente es lo que daba deudaPorCliente.
type DeudaDeCliente struct {
	Vencido          float64          `json:"vencido"`
	DiasDeLaMasVieja *int             `json:"diasDeLaMasVieja"`
	Prioridad        cobros.Prioridad `json:"prioridad"`
}

// FiltrosDeClientes son los de la cartera. Pagina es la de «Al día» y
// PaginaDeudores la de «Por cobrar», las dos desde 1.
type FiltrosDeClientes struct {
	Busqueda, Tipo, Rubro, Vendedor string
	Pagina, PaginaDeudores          int
}

// Cuántos viajan de cada grupo por página. «Por cobrar» también va de a
// páginas: hubo un «ver todos» con el argumento de que es la razón por la
// que se abre la pantalla, y con el padrón de ISIS eran mil tarjetas en una
// respuesta (el caso que documenta components/admin/ver-mas.tsx).
const (
	DeudoresPorPagina = 30
	AlDiaPorPagina    = 30
)

// CarteraDeClientes es la cartera en sus dos grupos. Las cantidades y los
// totales son de todos los que pasan el filtro, no solo de los que viajan:
// el encabezado dice la magnitud real.
type CarteraDeClientes struct {
	PorCobrar        []ClienteListado `json:"porCobrar"`
	AlDia            []ClienteListado `json:"alDia"`
	TotalAlDia       int              `json:"totalAlDia"`
	CantidadDeudores int              `json:"cantidadDeudores"`
	DeudaTotal       float64          `json:"deudaTotal"`
	VencidoTotal     float64          `json:"vencidoTotal"`
}

func terminos(texto string) []string {
	t := strings.Fields(texto)
	if len(t) > 6 {
		t = t[:6]
	}
	return t
}

// carteraFiltrada son los CTE que comparten las consultas de la cartera:
// los clientes que pasan el filtro y el saldo de cada uno, sumado una sola
// vez y solo para ellos (el índice por cliente de la 00168 lo lee sin tocar
// la tabla).
func carteraFiltrada(f FiltrosDeClientes) (string, []any) {
	cond := []string{"c.active"}
	var args []any
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	if f.Tipo != "" && f.Tipo != "todos" {
		cond = append(cond, "c.tipo::text = "+arg(f.Tipo))
	}
	switch {
	case f.Rubro == "sin-rubro":
		cond = append(cond, "(c.rubro IS NULL OR c.rubro = '')")
	case f.Rubro != "" && f.Rubro != "todos":
		cond = append(cond, "c.rubro = "+arg(f.Rubro))
	}
	if f.Vendedor != "" {
		cond = append(cond, "c.seller_id::text = "+arg(f.Vendedor))
	}
	// Un teléfono o un CUIT se compara por sus dígitos: «2235551234» no
	// encontraba «223 555-1234», y el teléfono ni se miraba.
	if d, ok := busqueda.Numero(f.Busqueda); ok {
		p := arg("%" + busqueda.SinPrefijos(d) + "%")
		cond = append(cond, "("+busqueda.Digitos("c.telefono")+" LIKE "+p+" OR "+busqueda.Digitos("c.cuit")+" LIKE "+p+")")
	} else {
		for _, t := range terminos(f.Busqueda) {
			p := arg("%" + t + "%")
			var col []string
			for _, c := range []string{"c.nombre", "c.razon_social", "c.cuit", "c.rubro", "c.email", "c.telefono"} {
				col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+p+")")
			}
			cond = append(cond, "("+strings.Join(col, " OR ")+")")
		}
	}
	return `WITH base AS (
		  SELECT c.id, c.nombre, c.razon_social, c.cuit, c.rubro, c.tipo::text AS tipo, c.estado::text AS estado, c.asesor,
		         c.telefono, c.email, c.limite_credito, c.dias_credito, c.cuenta_bloqueada, c.motivo_bloqueo
		  FROM customers c WHERE ` + strings.Join(cond, " AND ") + `
		), saldos AS (
		  SELECT m.customer_id, sum(m.monto) AS saldo FROM account_movements m
		  WHERE m.customer_id IN (SELECT id FROM base) GROUP BY m.customer_id
		)`, args
}

const columnasDeCartera = `b.id, b.nombre, b.razon_social, b.cuit, b.rubro, b.tipo, b.estado, b.asesor, b.telefono, b.email,
		  coalesce(s.saldo, 0)::float8, b.limite_credito::float8, b.dias_credito, b.cuenta_bloqueada, b.motivo_bloqueo`

func leerCliente(r pgx.CollectableRow, extra ...any) (ClienteListado, error) {
	var c ClienteListado
	err := r.Scan(append([]any{&c.ID, &c.Nombre, &c.RazonSocial, &c.Cuit, &c.Rubro, &c.Tipo, &c.Estado, &c.Asesor, &c.Telefono, &c.Email,
		&c.Saldo, &c.LimiteCredito, &c.DiasCredito, &c.CuentaBloqueada, &c.MotivoBloqueo}, extra...)...)
	return c, err
}

// Listar es la cartera: «Por cobrar» del más atrasado al menos y «Al día»
// por nombre, los dos de a páginas.
//
// Antes traía a todos los clientes con todo lo que compraron, y de cada
// deudor todos sus movimientos: con el padrón de ISIS eran miles de tarjetas
// por carga y años de cuenta corriente. Ahora:
//
//   - el aging se calcula para todos los deudores, porque el orden por
//     urgencia sale de la deuda vencida de cada uno, pero de cada uno viajan
//     solo los movimientos desde la última vez que quedó en cero (ver
//     movimientosAbiertos);
//   - de cada grupo viaja una página, con su total;
//   - lo comprado, la última compra y el saldo de «Al día» se buscan después
//     de cortar la página, solo para esas filas.
func (s *Servicio) Listar(ctx context.Context, f FiltrosDeClientes, hoy time.Time) (CarteraDeClientes, error) {
	cartera := CarteraDeClientes{PorCobrar: []ClienteListado{}, AlDia: []ClienteListado{}}
	cte, args := carteraFiltrada(f)

	// Los deudores, por nombre: es el orden en que se suman los totales
	// (como el reduce de la pantalla de antes) y el desempate de la urgencia.
	filas, err := s.pool.Query(ctx, cte+`
		SELECT `+columnasDeCartera+`
		FROM base b JOIN saldos s ON s.customer_id = b.id
		WHERE s.saldo > 0
		ORDER BY b.nombre, b.id`, args...)
	if err != nil {
		return cartera, err
	}
	deudores, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (ClienteListado, error) { return leerCliente(r) })
	if err != nil {
		return cartera, err
	}
	if err := s.deudaVencida(ctx, deudores, hoy); err != nil {
		return cartera, err
	}
	cartera.CantidadDeudores = len(deudores)
	idsDeudores := make([]string, len(deudores))
	for i, c := range deudores {
		cartera.DeudaTotal += c.Saldo
		cartera.VencidoTotal += c.Deuda.Vencido
		idsDeudores[i] = c.ID
	}
	// Quien debe va primero, y entre ellos manda el atraso (la clienta: «que
	// el sistema indique a quién darle prioridad»). Estable: a igual puntaje,
	// queda el orden por nombre.
	sort.SliceStable(deudores, func(i, j int) bool {
		return deudores[i].Deuda.Prioridad.Puntaje > deudores[j].Deuda.Prioridad.Puntaje
	})
	desde := min((max(f.PaginaDeudores, 1)-1)*DeudoresPorPagina, len(deudores))
	deudores = deudores[desde:min(desde+DeudoresPorPagina, len(deudores))]
	if err := s.compras(ctx, deudores); err != nil {
		return cartera, err
	}
	cartera.PorCobrar = deudores

	// Al día: los que pasan el filtro y no deben. Los deudores ya se
	// conocen, así que no se vuelve a sumar la cuenta corriente de todos:
	// se cortan la página por nombre y recién ahí se completan el saldo
	// (que puede ser a favor) y lo comprado de esas 30 filas. Antes un
	// LATERAL sobre orders quedaba debajo del orden y del count(*) OVER (),
	// y Postgres lo corría para cada cliente al día antes de cortar.
	pagina := max(f.Pagina, 1)
	n := len(args)
	filas, err = s.pool.Query(ctx, cte+`
		SELECT b.id, b.nombre, b.razon_social, b.cuit, b.rubro, b.tipo, b.estado, b.asesor, b.telefono, b.email,
		  0::float8, b.limite_credito::float8, b.dias_credito, b.cuenta_bloqueada, b.motivo_bloqueo, count(*) OVER ()
		FROM base b
		WHERE NOT EXISTS (SELECT 1 FROM unnest($`+fmt.Sprint(n+1)+`::uuid[]) d(id) WHERE d.id = b.id)
		ORDER BY b.nombre, b.id
		LIMIT $`+fmt.Sprint(n+2)+` OFFSET $`+fmt.Sprint(n+3), append(args, idsDeudores, AlDiaPorPagina, (pagina-1)*AlDiaPorPagina)...)
	if err != nil {
		return cartera, err
	}
	cartera.AlDia, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (ClienteListado, error) {
		return leerCliente(r, &cartera.TotalAlDia)
	})
	if err != nil {
		return cartera, err
	}
	// Una página que se pasó del final vuelve vacía, pero con el total: el
	// paginador necesita saber a dónde volver.
	if len(cartera.AlDia) == 0 && pagina > 1 {
		err = s.pool.QueryRow(ctx, cte+`SELECT count(*)::int FROM base b
			WHERE NOT EXISTS (SELECT 1 FROM unnest($`+fmt.Sprint(n+1)+`::uuid[]) d(id) WHERE d.id = b.id)`,
			append(args, idsDeudores)...).Scan(&cartera.TotalAlDia)
		return cartera, err
	}
	if err := s.saldos(ctx, cartera.AlDia); err != nil {
		return cartera, err
	}
	return cartera, s.compras(ctx, cartera.AlDia)
}

// saldos completa el saldo de unos pocos clientes.
func (s *Servicio) saldos(ctx context.Context, cs []ClienteListado) error {
	if len(cs) == 0 {
		return nil
	}
	ids := make([]string, len(cs))
	indice := map[string]int{}
	for i, c := range cs {
		ids[i] = c.ID
		indice[c.ID] = i
	}
	filas, err := s.pool.Query(ctx, `SELECT customer_id::text, sum(monto)::float8 FROM account_movements
		WHERE customer_id = ANY($1::uuid[]) GROUP BY customer_id`, ids)
	if err != nil {
		return err
	}
	var id string
	var saldo float64
	_, err = pgx.ForEachRow(filas, []any{&id, &saldo}, func() error {
		cs[indice[id]].Saldo = saldo
		return nil
	})
	return err
}

// compras completa lo comprado y la última compra de unos pocos clientes.
func (s *Servicio) compras(ctx context.Context, cs []ClienteListado) error {
	if len(cs) == 0 {
		return nil
	}
	ids := make([]string, len(cs))
	indice := map[string]int{}
	for i, c := range cs {
		ids[i] = c.ID
		indice[c.ID] = i
	}
	filas, err := s.pool.Query(ctx, `SELECT customer_id::text, sum(total)::float8, max(created_at) FROM orders
		WHERE customer_id = ANY($1::uuid[]) AND estado <> 'cancelado' GROUP BY customer_id`, ids)
	if err != nil {
		return err
	}
	var id string
	var total float64
	var ultima time.Time
	_, err = pgx.ForEachRow(filas, []any{&id, &total, &ultima}, func() error {
		c := &cs[indice[id]]
		c.TotalComprado = total
		u := ultima
		c.UltimaCompra = &u
		return nil
	})
	return err
}

// deudaVencida calcula lo vencido y la prioridad de cobranza de cada deudor.
func (s *Servicio) deudaVencida(ctx context.Context, deudores []ClienteListado, hoy time.Time) error {
	if len(deudores) == 0 {
		return nil
	}
	ids := make([]string, len(deudores))
	for i, c := range deudores {
		ids[i] = c.ID
	}
	porCliente, err := s.movimientosAbiertos(ctx, ids)
	if err != nil {
		return err
	}
	for i := range deudores {
		c := &deudores[i]
		a := cobros.CalcularAging(porCliente[c.ID], hoy)
		vencido := 0.0
		for _, t := range a.Tramos {
			if t.Desde > int(c.DiasCredito) {
				vencido += t.Monto
			}
		}
		c.Deuda = &DeudaDeCliente{Vencido: vencido, DiasDeLaMasVieja: a.DiasDeLaMasVieja,
			Prioridad: cobros.PrioridadDeCobranza(cobros.Deuda{Vencido: vencido, DiasDeLaMasVieja: a.DiasDeLaMasVieja,
				DiasCredito: int(c.DiasCredito), Bloqueada: c.CuentaBloqueada})}
	}
	return nil
}

// movimientosAbiertos son, de cada cliente, los movimientos posteriores a la
// última vez que su saldo quedó exactamente en cero, en orden.
//
// Lo de antes de ese cero no cambia el aging: en ese punto cada pago ya
// canceló sus deudas (FIFO) y no queda nada a favor, así que CalcularAging
// llega al mismo resultado empezando desde ahí. Un cliente con diez años de
// cuenta al día y una factura de este mes manda una fila, no diez años.
//
// El cero está guardado en la ficha (customers.cuenta_en_cero_at y _id, que
// mantiene un trigger sobre account_movements: la 00201), con el saldo
// corrido sumado en numeric, exacto. Antes se buscaba acá con una ventana
// que leía la cuenta entera de cada deudor; ahora se lee solo lo posterior
// con el índice (customer_id, created_at, id) de la 00168. El orden es el
// mismo de CalcularAging (fecha, y el id para que dos movimientos del mismo
// instante salgan siempre igual).
//
// LATERAL y no un JOIN: con el JOIN, Postgres no sabe cuántas filas deja la
// comparación de filas y prefiere recorrer account_movements entera con un
// hash (167 ms con 300.000 movimientos); así es un recorrido del índice por
// deudor, sin tocar la tabla (32 ms, docs/go/progreso.md).
func (s *Servicio) movimientosAbiertos(ctx context.Context, ids []string) (map[string][]cobros.Movimiento, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT c.id::text, m.monto::float8, m.created_at
		FROM customers c
		CROSS JOIN LATERAL (
		  SELECT m.monto, m.created_at, m.id FROM account_movements m
		  WHERE m.customer_id = c.id
		    AND (m.created_at, m.id) > (coalesce(c.cuenta_en_cero_at, '-infinity'),
		                                coalesce(c.cuenta_en_cero_id, '00000000-0000-0000-0000-000000000000'))
		) m
		WHERE c.id = ANY($1::uuid[])
		ORDER BY c.id, m.created_at, m.id`, ids)
	if err != nil {
		return nil, err
	}
	porCliente := map[string][]cobros.Movimiento{}
	var id string
	var m cobros.Movimiento
	if _, err := pgx.ForEachRow(filas, []any{&id, &m.Monto, &m.Fecha}, func() error {
		porCliente[id] = append(porCliente[id], m)
		return nil
	}); err != nil {
		return nil, err
	}
	return porCliente, nil
}

// Ficha es obtenerCliente: la fila entera de customers (como la daba
// drizzle: los importes como texto), el vendedor, la cuenta web que se
// podría vincular, el saldo y los últimos pedidos y presupuestos.
type Ficha struct {
	ID                   string        `json:"id"`
	UserID               *string       `json:"userId"`
	Nombre               string        `json:"nombre"`
	RazonSocial          *string       `json:"razonSocial"`
	Cuit                 *string       `json:"cuit"`
	CondicionIva         string        `json:"condicionIva"`
	Email                *string       `json:"email"`
	Telefono             *string       `json:"telefono"`
	Direccion            *string       `json:"direccion"`
	Rubro                *string       `json:"rubro"`
	Tipo                 string        `json:"tipo"`
	Estado               string        `json:"estado"`
	PriceListID          *string       `json:"priceListId"`
	LimiteCredito        string        `json:"limiteCredito"`
	Asesor               *string       `json:"asesor"`
	Notas                *string       `json:"notas"`
	Active               bool          `json:"active"`
	CreatedAt            time.Time     `json:"createdAt"`
	UpdatedAt            time.Time     `json:"updatedAt"`
	CodigoLegacy         *string       `json:"codigoLegacy"`
	SellerID             *string       `json:"sellerId"`
	DiasCredito          int32         `json:"diasCredito"`
	CuentaBloqueada      bool          `json:"cuentaBloqueada"`
	MotivoBloqueo        *string       `json:"motivoBloqueo"`
	Vendedor             *string       `json:"vendedor"`
	CuentaWebSinVincular *CuentaWeb    `json:"cuentaWebSinVincular"`
	Saldo                float64       `json:"saldo"`
	Pedidos              []Comprobante `json:"pedidos"`
	Presupuestos         []Comprobante `json:"presupuestos"`
	// Sus cortes y sus facturas, para no tener que buscarlos en otra
	// pantalla cuando el cliente pregunta por el suyo.
	Cortes   []Comprobante `json:"cortes"`
	Facturas []Comprobante `json:"facturas"`
	Anterior Anterior      `json:"anterior"`
}

// Anterior es lo que la migración trajo del sistema anterior (ISIS): antes
// solo lo escribía la migración y no había dónde verlo.
type Anterior struct {
	CantidadVentas       int                   `json:"cantidadVentas"`
	TotalVentas          string                `json:"totalVentas"`
	CantidadComprobantes int                   `json:"cantidadComprobantes"`
	TotalComprobantes    string                `json:"totalComprobantes"`
	Ventas               []VentaAnterior       `json:"ventas"`
	Comprobantes         []ComprobanteAnterior `json:"comprobantes"`
}

type VentaAnterior struct {
	ID          string    `json:"id"`
	Comprobante string    `json:"comprobante"`
	Fecha       time.Time `json:"fecha"`
	Total       string    `json:"total"`
	Detalle     string    `json:"detalle"`
	Sucursal    *string   `json:"sucursal"`
}

type ComprobanteAnterior struct {
	ID         string    `json:"id"`
	Tipo       string    `json:"tipo"`
	PuntoVenta int32     `json:"puntoVenta"`
	Numero     int32     `json:"numero"`
	Fecha      time.Time `json:"fecha"`
	Total      string    `json:"total"`
	Cae        *string   `json:"cae"`
}

func (s *Servicio) anterior(ctx context.Context, id string) (Anterior, error) {
	var a Anterior
	err := s.pool.QueryRow(ctx, `
		SELECT (SELECT count(*)::int FROM historical_sales WHERE customer_id = $1),
		  (SELECT coalesce(sum(total), 0)::text FROM historical_sales WHERE customer_id = $1),
		  (SELECT count(*)::int FROM historical_invoices WHERE customer_id = $1),
		  (SELECT coalesce(sum(total), 0)::text FROM historical_invoices WHERE customer_id = $1)`, id).
		Scan(&a.CantidadVentas, &a.TotalVentas, &a.CantidadComprobantes, &a.TotalComprobantes)
	if err != nil {
		return a, err
	}
	filas, err := s.pool.Query(ctx, `SELECT id, comprobante_legacy, fecha, total::text, detalle, sucursal
		FROM historical_sales WHERE customer_id = $1 ORDER BY fecha DESC, comprobante_legacy DESC LIMIT 20`, id)
	if err != nil {
		return a, err
	}
	if a.Ventas, err = pgx.CollectRows(filas, pgx.RowToStructByPos[VentaAnterior]); err != nil {
		return a, err
	}
	filas, err = s.pool.Query(ctx, `SELECT id, tipo, punto_venta, numero, fecha, total::text, cae
		FROM historical_invoices WHERE customer_id = $1 ORDER BY fecha DESC, numero DESC LIMIT 20`, id)
	if err != nil {
		return a, err
	}
	a.Comprobantes, err = pgx.CollectRows(filas, pgx.RowToStructByPos[ComprobanteAnterior])
	return a, err
}

// CuentaWeb es una ficha creada desde el sitio con el mismo correo.
type CuentaWeb struct {
	ID        string    `json:"id"`
	Nombre    string    `json:"nombre"`
	CreatedAt time.Time `json:"createdAt"`
}

// Comprobante es un pedido o un presupuesto de la ficha.
type Comprobante struct {
	ID        string    `json:"id"`
	Numero    string    `json:"numero"`
	Estado    string    `json:"estado"`
	Total     string    `json:"total"`
	CreatedAt time.Time `json:"createdAt"`
}

// ErrNoEsta es una ficha que no existe.
var ErrNoEsta = errors.New("no está")

func comprobantes(ctx context.Context, s *Servicio, sql, id string) ([]Comprobante, error) {
	filas, err := s.pool.Query(ctx, sql, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Comprobante, error) {
		var c Comprobante
		return c, r.Scan(&c.ID, &c.Numero, &c.Estado, &c.Total, &c.CreatedAt)
	})
}

// Obtener es obtenerCliente; ErrNoEsta si no hay ficha.
func (s *Servicio) Obtener(ctx context.Context, id string) (*Ficha, error) {
	var c Ficha
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, c.user_id, c.nombre, c.razon_social, c.cuit, c.condicion_iva::text, c.email, c.telefono, c.direccion, c.rubro,
		  c.tipo::text, c.estado::text, c.price_list_id, c.limite_credito::text, c.asesor, c.notas, c.active, c.created_at, c.updated_at,
		  c.codigo_legacy, c.seller_id, c.dias_credito, c.cuenta_bloqueada, c.motivo_bloqueo, s.nombre,
		  (SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = c.id)
		FROM customers c LEFT JOIN sellers s ON s.id = c.seller_id
		WHERE c.id = $1`, id).Scan(&c.ID, &c.UserID, &c.Nombre, &c.RazonSocial, &c.Cuit, &c.CondicionIva, &c.Email, &c.Telefono,
		&c.Direccion, &c.Rubro, &c.Tipo, &c.Estado, &c.PriceListID, &c.LimiteCredito, &c.Asesor, &c.Notas, &c.Active, &c.CreatedAt,
		&c.UpdatedAt, &c.CodigoLegacy, &c.SellerID, &c.DiasCredito, &c.CuentaBloqueada, &c.MotivoBloqueo, &c.Vendedor, &c.Saldo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	if c.UserID == nil && c.Email != nil && *c.Email != "" {
		var w CuentaWeb
		err := s.pool.QueryRow(ctx, `SELECT id, nombre, created_at FROM customers
			WHERE email = $1 AND active AND user_id IS NOT NULL AND id <> $2 LIMIT 1`, *c.Email, c.ID).Scan(&w.ID, &w.Nombre, &w.CreatedAt)
		if err == nil {
			c.CuentaWebSinVincular = &w
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	if c.Pedidos, err = comprobantes(ctx, s, `SELECT id, numero, estado::text, total::text, created_at FROM orders
		WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10`, id); err != nil {
		return nil, err
	}
	if c.Presupuestos, err = comprobantes(ctx, s, `SELECT id, numero, estado::text, total::text, created_at FROM quotes
		WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10`, id); err != nil {
		return nil, err
	}
	if c.Cortes, err = comprobantes(ctx, s, `SELECT id, numero, estado::text, placas::text, created_at FROM cutting_orders
		WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10`, id); err != nil {
		return nil, err
	}
	if c.Facturas, err = comprobantes(ctx, s, `
		SELECT id,
		  CASE split_part(tipo::text, '_', 1) WHEN 'factura' THEN 'Factura ' WHEN 'nota' THEN
		    CASE WHEN tipo::text LIKE 'nota_credito%' THEN 'N. crédito ' ELSE 'N. débito ' END END
		  || upper(right(tipo::text, 1)) || ' ' || lpad(punto_venta::text, 4, '0') || '-' || lpad(numero::text, 8, '0'),
		  estado::text, total::text, fecha_emision
		FROM invoices WHERE customer_id = $1 ORDER BY fecha_emision DESC LIMIT 10`, id); err != nil {
		return nil, err
	}
	if c.Anterior, err = s.anterior(ctx, id); err != nil {
		return nil, err
	}
	return &c, nil
}

// Vendedor es un vendedor con la cantidad de clientes en su cartera.
type Vendedor struct {
	ID       string `json:"id"`
	Nombre   string `json:"nombre"`
	Tipo     string `json:"tipo"`
	Activo   bool   `json:"activo"`
	Clientes int    `json:"clientes"`
}

// Vendedores es listarVendedores (o vendedoresActivos, con soloActivos).
func (s *Servicio) Vendedores(ctx context.Context, soloActivos bool) ([]Vendedor, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT s.id, s.nombre, s.tipo::text, s.activo, count(c.id)::int
		FROM sellers s LEFT JOIN customers c ON c.seller_id = s.id
		WHERE $1 = false OR s.activo
		GROUP BY s.id ORDER BY s.nombre`, soloActivos)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Vendedor, error) {
		var v Vendedor
		return v, r.Scan(&v.ID, &v.Nombre, &v.Tipo, &v.Activo, &v.Clientes)
	})
}

// Gestion es un seguimiento de la lista.
type Gestion struct {
	ID              string     `json:"id"`
	CustomerID      string     `json:"customerId"`
	Cliente         string     `json:"cliente"`
	Etapa           string     `json:"etapa"`
	Asunto          string     `json:"asunto"`
	Notas           *string    `json:"notas"`
	ProximaAccionAt *time.Time `json:"proximaAccionAt"`
	Vencida         bool       `json:"vencida"`
	CreatedAt       time.Time  `json:"createdAt"`
	// Saldo es lo que debe el cliente en la cuenta (positivo, debe): la
	// tarjeta no lo decía y había que escribirlo en el asunto (mes simulado 2).
	Saldo float64 `json:"saldo"`
}

// Gestiones es listarGestiones (y gestionesDelCliente, con un cliente): las
// abiertas, o todas; la próxima acción más cercana primero.
func (s *Servicio) Gestiones(ctx context.Context, incluirCerradas bool, cliente string, hoy time.Time) ([]Gestion, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT g.id, g.customer_id, coalesce(c.razon_social, c.nombre), g.etapa::text, g.asunto, g.notas, g.proxima_accion_at, g.created_at,
		       c.cuenta_saldo::float8
		FROM customer_follow_ups g JOIN customers c ON c.id = g.customer_id
		WHERE ($1 OR g.etapa <> 'cerrado') AND ($2 = '' OR g.customer_id::text = $2)
		ORDER BY g.proxima_accion_at ASC NULLS LAST, g.created_at DESC`, incluirCerradas, cliente)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Gestion, error) {
		var g Gestion
		err := r.Scan(&g.ID, &g.CustomerID, &g.Cliente, &g.Etapa, &g.Asunto, &g.Notas, &g.ProximaAccionAt, &g.CreatedAt, &g.Saldo)
		g.Vencida = g.ProximaAccionAt != nil && !g.ProximaAccionAt.After(hoy)
		return g, err
	})
}

// GestionesVencidas es cuántas abiertas tienen la próxima acción vencida.
func (s *Servicio) GestionesVencidas(ctx context.Context, hoy time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*)::int FROM customer_follow_ups
		WHERE etapa <> 'cerrado' AND proxima_accion_at IS NOT NULL AND proxima_accion_at <= $1`, hoy).Scan(&n)
	return n, err
}
