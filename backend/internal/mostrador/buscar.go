package mostrador

import (
	"context"
	"errors"
	"fmt"
	"mjbj/internal/busqueda"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/ventas"
	"mjbj/internal/ventas/fragmentos"
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
	// Piso es el precio final que apenas cubre el costo (precios.PisoDeCosto);
	// nil sin costo cargado. El presupuesto marca un renglón por debajo.
	Piso *float64 `json:"piso"`
	// PrecioAnterior es el de antes de una oferta vigente, para tacharlo en
	// el buscador y en el renglón (M2S2-030); nil sin oferta.
	PrecioAnterior *float64 `json:"precioAnterior"`
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
		// «2x4» encuentra el tirante de 2" x 4" (M2S3-028): la medida se
		// escribe sin comillas ni espacios.
		if re, ok := busqueda.MedidaPorPor(t); ok {
			p := a.poner(re)
			var col []string
			for _, c := range columnas {
				col = append(col, "coalesce("+c+", '') ~* "+p)
			}
			por = append(por, "("+strings.Join(col, " OR ")+")")
			continue
		}
		p := a.poner("%" + t + "%")
		var col []string
		for _, c := range columnas {
			col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+p+")")
		}
		por = append(por, "("+strings.Join(col, " OR ")+")")
	}
	return "(" + strings.Join(por, " AND ") + ")"
}

// coincidePalabra es coincide con cada palabra al principio de una palabra
// de la columna: «laca» no trae las «placas» (mes simulado, M2S1-187).
func (a *args) coincidePalabra(texto string, columnas ...string) string {
	terminos := strings.FieldsFunc(zodjs.TrimJS(texto), zodjs.EspacioJS)
	if len(terminos) > 6 {
		terminos = terminos[:6]
	}
	if len(terminos) == 0 {
		return ""
	}
	var por []string
	for _, t := range terminos {
		p := a.poner("(^|[^[:alnum:]])" + regexp.QuoteMeta(t))
		var col []string
		for _, c := range columnas {
			col = append(col, "f_unaccent("+c+") ~* f_unaccent("+p+")")
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

// anterior es el precio de antes de la oferta vigente de la lista que da el
// precio: la propia si tiene la medida, si no la general por el factor.
func anterior(a *args, l Lista, propia, general string) string {
	return "(CASE WHEN " + propia + ".price IS NOT NULL THEN CASE WHEN " + propia + ".oferta_hasta > now() THEN " + propia + ".precio_anterior END" +
		" WHEN " + general + ".oferta_hasta > now() THEN round((" + general + ".precio_anterior * " + a.poner(jsmath.Texto(l.FactorDerivado)) + "::numeric)::numeric, 2) END)"
}

// numerosSueltos cuenta los números tipeados que no aparecen enteros en el
// nombre y la medida: «mdf 18» pone primero el de «18 mm» y no el de «1830 x
// 2600mm» (mes simulado, H017). Cero si no se tipeó ningún número.
func numerosSueltos(a *args, consulta string) string {
	var partes []string
	for _, t := range strings.FieldsFunc(zodjs.TrimJS(consulta), zodjs.EspacioJS) {
		if !soloDigitos(t) {
			continue
		}
		p := a.poner("(^|[^0-9])" + t + "([^0-9]|$)")
		partes = append(partes, "CASE WHEN (p.name || ' ' || coalesce(v.label, '')) ~ "+p+" THEN 0 ELSE 1 END")
		if len(partes) == 6 {
			break
		}
	}
	if len(partes) == 0 {
		// Una expresión y no «0»: un entero suelto en el ORDER BY es el
		// número de columna.
		return "0::int"
	}
	return "(" + strings.Join(partes, " + ") + ")"
}

func soloDigitos(t string) bool {
	for _, r := range t {
		if r < '0' || r > '9' {
			return false
		}
	}
	return t != ""
}

// Buscar es buscarParaMostrador. Primero lo que tiene una palabra que empieza
// con cada término; si no hay nada, lo que lo contiene en cualquier lado.
func (s *Servicio) Buscar(ctx context.Context, texto, sucursal string, cliente *string) ([]ResultadoDeMostrador, error) {
	out, err := s.buscar(ctx, texto, sucursal, cliente, true)
	if err != nil || len(out) > 0 {
		return out, err
	}
	return s.buscar(ctx, texto, sucursal, cliente, false)
}

func (s *Servicio) buscar(ctx context.Context, texto, sucursal string, cliente *string, porPalabra bool) ([]ResultadoDeMostrador, error) {
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
	// El lector de código de barras escribe el número entero y un Enter.
	// Y el código sin su familia: «MEL-BLA-18» encuentra «PLA-MEL-BLA-18»
	// (mes simulado, M3S1-067: el armador de cortes no la encontraba).
	tramo := a.poner("%-" + consulta + "%")
	cond := "(v.sku = " + exacto + " OR v.codigo_barras = " + exacto + " OR v.sku ILIKE " + prefijo + " OR v.sku ILIKE " + tramo + ")"
	coincide := a.coincide
	if porPalabra {
		coincide = a.coincidePalabra
	}
	if t := coincide(consulta, "p.name", "v.label", "p.brand", "c.name"); t != "" {
		cond = "(" + cond + " OR " + t + ")"
	}

	joins := joinDePrecios(&a, lista, "propio", "general")
	pr := precio(&a, lista, "propio", "general")
	ant := anterior(&a, lista, "propio", "general")
	suc := a.poner(sucursal)
	sueltos := numerosSueltos(&a, consulta)
	// Lo que coincide por el nombre va antes que lo que coincide por la
	// categoría o un pedazo de palabra (mes simulado: «laca» traía primero
	// los fenólicos, porque «placa» contiene «laca», y «escalera», los
	// decks). Primero el nombre que empieza con lo buscado, después el que
	// tiene una palabra que empieza así, después el resto.
	nombre := "f_unaccent(p.name || ' ' || coalesce(v.label, ''))"
	primera := ""
	if t := strings.FieldsFunc(consulta, zodjs.EspacioJS); len(t) > 0 {
		primera = t[0]
	}
	empieza := a.poner(primera + "%")
	palabra := a.poner("% " + primera + "%")
	porNombre := "CASE WHEN " + nombre + " ILIKE f_unaccent(" + empieza + ") THEN 0 WHEN ' ' || " + nombre + " ILIKE f_unaccent(" + palabra + ") THEN 1 ELSE 2 END"
	sql := `
		SELECT v.id, v.sku, p.name, v.label, v.largo_mm, v.ancho_mm, v.color, c.name, p.unit::text,
		       p.forma_de_venta::text, p.precio_media_pct, ` + pr + `, ` + ant + `,
		       -- Lo disponible y no el físico: lo reservado para un acopio
		       -- aparecía libre y se volvía a vender (mes simulado, H023).
		       greatest(coalesce(i.qty, 0) - coalesce((SELECT sum(r.cantidad) FROM stock_reservations r
		         WHERE r.variant_id = v.id AND r.branch_id = ` + suc + `::uuid AND r.estado = 'activa'), 0), 0)
		FROM product_variants v
		JOIN products p ON p.id = v.product_id
		JOIN categories c ON c.id = p.category_id
		` + joins + `
		LEFT JOIN inventory i ON i.variant_id = v.id AND i.branch_id = ` + suc + `::uuid
		WHERE v.active = true AND p.active = true AND ` + cond + `
		ORDER BY CASE WHEN v.codigo_barras = ` + exacto + ` THEN 0 WHEN v.sku ILIKE ` + prefijo + ` THEN 1 ELSE 2 END, ` + sueltos + `, ` + porNombre + `, p.name, v.sort_order
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
		var pre, ant *jsmath.Num
		if err := filas.Scan(&r.VariantID, &r.Sku, &r.Producto, &r.Medida, &r.LargoMm, &r.AnchoMm, &r.Color, &cat, &r.Unidad,
			&r.FormaDeVenta, &pct, &pre, &ant, &stock); err != nil {
			return nil, err
		}
		if ant != nil && pre != nil && ant.F() > pre.F() {
			v := ant.F()
			r.PrecioAnterior = &v
		}
		r.Categoria = &cat
		r.PrecioMediaPct = pct.F()
		if pre != nil {
			r.Precio = pre.F()
		}
		r.Stock = stock.F()
		out = append(out, r)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	filas.Close()
	ids := make([]string, len(out))
	for i, r := range out {
		ids[i] = r.VariantID
	}
	pisos, err := precios.PisosDeCosto(ctx, s.pool, ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if p, ok := pisos[out[i].VariantID]; ok {
			out[i].Piso = &p
		}
	}
	return out, nil
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
	// CuentaBloqueada: la pantalla apaga «Cuenta corriente» apenas se elige
	// al cliente, y no recién al cobrar (mes simulado, M3S3-050).
	CuentaBloqueada bool    `json:"cuentaBloqueada"`
	PriceListID     *string `json:"priceListId"`
	// Para completar el presupuesto al elegir al cliente.
	Telefono *string `json:"telefono"`
	Email    *string `json:"email"`
}

const columnasCliente = `id, nombre, razon_social, cuit, condicion_iva::text, direccion, estado::text, limite_credito, price_list_id, telefono, email, cuenta_bloqueada`

func leerClientes(filas pgx.Rows) ([]ClienteDelMostrador, error) {
	defer filas.Close()
	out := []ClienteDelMostrador{}
	for filas.Next() {
		var c ClienteDelMostrador
		var lim jsmath.Num
		if err := filas.Scan(&c.ID, &c.Nombre, &c.RazonSocial, &c.Cuit, &c.CondicionIva, &c.Direccion, &c.Estado, &lim, &c.PriceListID,
			&c.Telefono, &c.Email, &c.CuentaBloqueada); err != nil {
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
	if d, ok := busqueda.Numero(consulta); ok {
		// Por teléfono o CUIT, escrito como sea: se comparan los dígitos.
		p := a.poner("%" + busqueda.SinPrefijos(d) + "%")
		cond += " AND (" + busqueda.Digitos("telefono") + " LIKE " + p + " OR " + busqueda.Digitos("cuit") + " LIKE " + p + ")"
	} else if t := a.coincide(consulta, "nombre", "razon_social", "cuit", "telefono"); t != "" {
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
	// Con el límite: la pantalla apaga «Cuenta corriente» a quien no tiene
	// (M2S4-061). clientePorId no lo traía.
	c := cs[0]
	return &c, nil

}

// PedidoSinCobrar es un pedido del cliente con mercadería que salió y algo
// sin cobrar (la cifra de «Me deben»).
type PedidoSinCobrar struct {
	ID     string  `json:"id"`
	Numero string  `json:"numero"`
	Monto  float64 `json:"monto"`
}

// PedidosSinCobrar son los del cliente, del más viejo al más nuevo (hasta
// diez): el mostrador los muestra junto al «Debe» para cobrarlos donde se
// cobra la cuenta (mes simulado, H367).
func (s *Servicio) PedidosSinCobrar(ctx context.Context, cliente string) ([]PedidoSinCobrar, error) {
	out := []PedidoSinCobrar{}
	if !plataforma.UUIDValido(cliente) {
		return out, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT id, numero, monto FROM (
		  SELECT o.id::text AS id, o.numero, `+fragmentos.SinCobrarDeLoQueSalio+` AS monto, o.created_at
		  FROM orders o WHERE o.customer_id = $1 AND `+fragmentos.SalioMercaderia+`
		) x WHERE monto > 0.009 ORDER BY created_at LIMIT 10`, cliente)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var p PedidoSinCobrar
		var m jsmath.Num
		if err := filas.Scan(&p.ID, &p.Numero, &m); err != nil {
			return nil, err
		}
		p.Monto = m.F()
		out = append(out, p)
	}
	return out, filas.Err()
}

// SaldoDeCuenta es lo que debe un cliente (positivo: debe).
// ChequesInformados son los cheques que el cliente informó desde el portal
// y nadie aceptó todavía: el cobro de cuenta del mostrador los muestra, como
// el del panel (M4-065). Sin eso se cobraba en efectivo la misma deuda que el
// cheque ya pagaba (recorrido 2).
type ChequesInformados struct {
	Cantidad int     `json:"cantidad"`
	Total    float64 `json:"total"`
}

// InformadosDe es ChequesInformados del cliente.
func (s *Servicio) InformadosDe(ctx context.Context, cliente string) (ChequesInformados, error) {
	var c ChequesInformados
	if !plataforma.UUIDValido(cliente) {
		return c, nil
	}
	err := s.pool.QueryRow(ctx, `SELECT count(*)::int, coalesce(sum(importe), 0)::float8 FROM cheques
		WHERE customer_id = $1 AND sentido = 'recibido' AND estado = 'informado'`, cliente).Scan(&c.Cantidad, &c.Total)
	return c, err
}

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
