package mostrador

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/ventas"
	"mjbj/internal/zodjs"
)

// La búsqueda del mostrador (lib/mostrador/buscar.ts): variantes con su
// precio para el cliente elegido y lo que hay en la sucursal, de a 12.

const tope = 12

// ResultadoDeMostrador es una variante encontrada.
type ResultadoDeMostrador struct {
	VariantID      string  `json:"variantId"`
	Sku            string  `json:"sku"`
	Producto       string  `json:"producto"`
	Medida         string  `json:"medida"`
	Unidad         string  `json:"unidad"`
	Precio         float64 `json:"precio"`
	Stock          float64 `json:"stock"`
	LargoMm        *int    `json:"largoMm"`
	AnchoMm        *int    `json:"anchoMm"`
	Color          *string `json:"color"`
	Categoria      *string `json:"categoria"`
	FormaDeVenta   string  `json:"formaDeVenta"`
	PrecioMediaPct float64 `json:"precioMediaPct"`
}

// args junta los parámetros de una consulta armada a mano.
type args []any

func (a *args) poner(v any) string {
	*a = append(*a, v)
	return fmt.Sprintf("$%d", len(*a))
}

// coincide es coincideBusqueda (lib/busqueda.ts): cada palabra (hasta seis)
// en alguna de las columnas, sin tildes.
func (a *args) coincide(texto string, columnas ...string) string {
	terminos := strings.FieldsFunc(zodjs.TrimJS(texto), zodjs.EspacioJS)
	if len(terminos) > 6 {
		terminos = terminos[:6]
	}
	if len(terminos) == 0 {
		return ""
	}
	var por []string
	for _, t := range terminos {
		p := a.poner("%" + t + "%")
		var col []string
		for _, c := range columnas {
			col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+p+")")
		}
		por = append(por, "("+strings.Join(col, " OR ")+")")
	}
	return "(" + strings.Join(por, " AND ") + ")"
}

// joinDePrecios son los dos left join de la lista propia y la general.
func joinDePrecios(a *args, l Lista, propia, general string) string {
	on := func(alias string, lista *string) string {
		if lista == nil {
			return "false"
		}
		return alias + ".variant_id = v.id AND " + alias + ".price_list_id = " + a.poner(*lista)
	}
	return "LEFT JOIN price_list_items " + propia + " ON " + on(propia, l.ID) +
		" LEFT JOIN price_list_items " + general + " ON " + on(general, l.GeneralID)
}

// precio es coalesce(propio, round(general × factor, 2)).
func precio(a *args, l Lista, propia, general string) string {
	return "coalesce(" + propia + ".price, round((" + general + ".price * " + a.poner(jsmath.Texto(l.FactorDerivado)) + "::numeric)::numeric, 2))"
}

// Buscar es buscarParaMostrador.
func (s *Servicio) Buscar(ctx context.Context, texto, sucursal string, cliente *string) ([]ResultadoDeMostrador, error) {
	consulta := zodjs.TrimJS(texto)
	out := []ResultadoDeMostrador{}
	if zodjs.LargoJS(consulta) < 2 {
		return out, nil
	}
	if !plataforma.UUIDValido(sucursal) {
		// El TS daba un 500 (Postgres rechaza el uuid); sin sucursal no hay stock.
		return out, nil
	}
	lista, err := ListaDelCliente(ctx, s.pool, cliente)
	if err != nil {
		return nil, err
	}
	var a args
	prefijo := a.poner(consulta + "%")
	exacto := a.poner(consulta)
	cond := "(v.sku = " + exacto + " OR v.sku ILIKE " + prefijo + ")"
	if t := a.coincide(consulta, "p.name", "v.label", "p.brand", "c.name"); t != "" {
		cond = "(" + cond + " OR " + t + ")"
	}
	joins := joinDePrecios(&a, lista, "propio", "general")
	pr := precio(&a, lista, "propio", "general")
	suc := a.poner(sucursal)
	sql := `
		SELECT v.id, v.sku, p.name, v.label, v.largo_mm, v.ancho_mm, v.color, c.name, p.unit::text,
		       p.forma_de_venta::text, p.precio_media_pct, ` + pr + `, coalesce(i.qty, 0)
		FROM product_variants v
		JOIN products p ON p.id = v.product_id
		JOIN categories c ON c.id = p.category_id
		` + joins + `
		LEFT JOIN inventory i ON i.variant_id = v.id AND i.branch_id = ` + suc + `::uuid
		WHERE v.active = true AND p.active = true AND ` + cond + `
		ORDER BY CASE WHEN v.sku ILIKE ` + prefijo + ` THEN 0 ELSE 1 END, p.name, v.sort_order
		LIMIT ` + fmt.Sprint(tope)
	// Plan a medida en cada búsqueda (QueryExecModeExec): con el plan genérico
	// que Postgres arma después de cinco ejecuciones de la misma sentencia,
	// los ILIKE con el patrón como parámetro barren todo (ver progreso.md).
	filas, err := s.pool.Query(ctx, sql, append([]any{pgx.QueryExecModeExec}, a...)...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var r ResultadoDeMostrador
		var cat string
		var pct, stock jsmath.Num
		var pre *jsmath.Num
		if err := filas.Scan(&r.VariantID, &r.Sku, &r.Producto, &r.Medida, &r.LargoMm, &r.AnchoMm, &r.Color, &cat, &r.Unidad,
			&r.FormaDeVenta, &pct, &pre, &stock); err != nil {
			return nil, err
		}
		r.Categoria = &cat
		r.PrecioMediaPct = pct.F()
		if pre != nil {
			r.Precio = pre.F()
		}
		r.Stock = stock.F()
		out = append(out, r)
	}
	return out, filas.Err()
}

// PreciosPara son los precios de unas variantes para un cliente (cuando se lo
// identifica con la venta empezada).
func (s *Servicio) PreciosPara(ctx context.Context, variantes []string, cliente *string) (map[string]float64, error) {
	out := map[string]float64{}
	var validas []string
	for _, v := range variantes {
		if plataforma.UUIDValido(v) {
			validas = append(validas, v)
		}
	}
	if len(validas) == 0 {
		return out, nil
	}
	lista, err := ListaDelCliente(ctx, s.pool, cliente)
	if err != nil {
		return nil, err
	}
	var a args
	joins := joinDePrecios(&a, lista, "propio", "general")
	pr := precio(&a, lista, "propio", "general")
	ids := a.poner(validas)
	filas, err := s.pool.Query(ctx, `SELECT v.id, `+pr+` FROM product_variants v `+joins+` WHERE v.id = ANY(`+ids+`::uuid[])`, a...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var id string
		var p *jsmath.Num
		if err := filas.Scan(&id, &p); err != nil {
			return nil, err
		}
		out[id] = 0
		if p != nil {
			out[id] = p.F()
		}
	}
	return out, filas.Err()
}

// ClienteDelMostrador es un cliente como lo usa la venta.
type ClienteDelMostrador struct {
	ID            string   `json:"id"`
	Nombre        string   `json:"nombre"`
	RazonSocial   *string  `json:"razonSocial"`
	Cuit          *string  `json:"cuit"`
	CondicionIva  string   `json:"condicionIva"`
	Direccion     *string  `json:"direccion"`
	Estado        string   `json:"estado"`
	LimiteCredito *float64 `json:"limiteCredito,omitempty"`
	PriceListID   *string  `json:"priceListId"`
}

const columnasCliente = `id, nombre, razon_social, cuit, condicion_iva::text, direccion, estado::text, limite_credito, price_list_id`

func leerClientes(filas pgx.Rows) ([]ClienteDelMostrador, error) {
	defer filas.Close()
	out := []ClienteDelMostrador{}
	for filas.Next() {
		var c ClienteDelMostrador
		var lim jsmath.Num
		if err := filas.Scan(&c.ID, &c.Nombre, &c.RazonSocial, &c.Cuit, &c.CondicionIva, &c.Direccion, &c.Estado, &lim, &c.PriceListID); err != nil {
			return nil, err
		}
		l := lim.F()
		c.LimiteCredito = &l
		out = append(out, c)
	}
	return out, filas.Err()
}

func ordenable(c ClienteDelMostrador) ventas.ClienteOrdenable {
	return ventas.ClienteOrdenable{ID: c.ID, Nombre: c.Nombre, RazonSocial: c.RazonSocial, Cuit: c.Cuit}
}

// BuscarClientes es buscarClienteEnMostrador: 30 por nombre y los 8 mejores
// según el orden del buscador.
func (s *Servicio) BuscarClientes(ctx context.Context, texto string) ([]ClienteDelMostrador, error) {
	consulta := zodjs.TrimJS(texto)
	if zodjs.LargoJS(consulta) < 2 {
		return []ClienteDelMostrador{}, nil
	}
	var a args
	cond := "active = true"
	if t := a.coincide(consulta, "nombre", "razon_social", "cuit"); t != "" {
		cond += " AND " + t
	}
	filas, err := s.pool.Query(ctx, `SELECT `+columnasCliente+` FROM customers WHERE `+cond+` ORDER BY nombre LIMIT 30`,
		append([]any{pgx.QueryExecModeExec}, a...)...)
	if err != nil {
		return nil, err
	}
	cs, err := leerClientes(filas)
	if err != nil {
		return nil, err
	}
	cs = ventas.OrdenarClientes(cs, ordenable, consulta, nil)
	if len(cs) > 8 {
		cs = cs[:8]
	}
	return cs, nil
}

// ClientesRecientes son los últimos seis atendidos en la sucursal.
func (s *Servicio) ClientesRecientes(ctx context.Context, sucursal string) ([]ClienteDelMostrador, error) {
	if !plataforma.UUIDValido(sucursal) {
		return []ClienteDelMostrador{}, nil
	}
	filas, err := s.pool.Query(ctx, `
		WITH ultimos AS (
		  SELECT customer_id, max(created_at) AS cuando FROM orders
		  WHERE branch_id = $1 AND customer_id IS NOT NULL
		  GROUP BY customer_id ORDER BY max(created_at) DESC LIMIT 6
		)
		SELECT `+prefijar("c.", columnasCliente)+` FROM ultimos u JOIN customers c ON c.id = u.customer_id
		WHERE c.active = true ORDER BY u.cuando DESC`, sucursal)
	if err != nil {
		return nil, err
	}
	return leerClientes(filas)
}

func prefijar(p, columnas string) string {
	partes := strings.Split(columnas, ", ")
	for i, c := range partes {
		partes[i] = p + c
	}
	return strings.Join(partes, ", ")
}

// ClientePorID es lo que necesita la venta de un cliente («usar el existente»).
func (s *Servicio) ClientePorID(ctx context.Context, id string) (*ClienteDelMostrador, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	filas, err := s.pool.Query(ctx, `SELECT `+columnasCliente+` FROM customers WHERE id = $1 LIMIT 1`, id)
	if err != nil {
		return nil, err
	}
	cs, err := leerClientes(filas)
	if err != nil || len(cs) == 0 {
		return nil, err
	}
	c := cs[0]
	c.LimiteCredito = nil // clientePorId no lo trae
	return &c, nil
}

// SaldoDeCuenta es lo que debe un cliente (positivo: debe).
func (s *Servicio) SaldoDeCuenta(ctx context.Context, cliente string) (float64, error) {
	if !plataforma.UUIDValido(cliente) {
		return 0, nil
	}
	var saldo float64
	err := s.pool.QueryRow(ctx, `SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = $1`, cliente).Scan(&saldo)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return saldo, err
}
