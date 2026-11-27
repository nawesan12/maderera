// Package stock es el stock del panel: la grilla por sucursal, las alertas,
// los últimos movimientos, el ajuste rápido y la transferencia entre
// sucursales. Era app/admin/stock y lib/dal/admin/inventory.ts.
//
// Todo cambio de cantidad toma el candado de lib/inventario/locks.ts
// (hashtext(variante || sucursal)), el mismo de las reservas del TS, y deja
// su movimiento.
package stock

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/catalogo"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/listado"
	"mjbj/internal/pdf"
	"mjbj/internal/plataforma"
	"mjbj/internal/productos"
	"mjbj/internal/sqlc"
)

// Servicio es el stock.
type Servicio struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
	log  *slog.Logger
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log}
}

// --- ayudantes (lib/unidades.ts) ---

// Cantidad es cantidadDeStock: redondeada a 3 decimales.
func Cantidad(v float64) float64 { return jsmath.Round(v*1000) / 1000 }

var reCantidad = regexp.MustCompile(`^-?\d+(\.\d+)?$`)

// LeerCantidad es leerCantidad: «2,5», «2.5» y «2» son lo mismo; lo demás
// (incluido «1e3») es NaN.
func LeerCantidad(texto string) float64 {
	if texto == "" {
		return math.NaN()
	}
	limpio := strings.Replace(strings.TrimSpace(texto), ",", ".", 1)
	if !reCantidad.MatchString(limpio) {
		return math.NaN()
	}
	return jsmath.Numero(limpio)
}

var nombreLargo = map[string]string{
	"unidad": "unidad", "metro_lineal": "metro", "metro_cuadrado": "metro cuadrado", "tabla": "tabla",
	"placa": "placa", "rollo": "rollo", "par": "par", "juego": "juego", "kg": "kilo", "litro": "litro",
}

// UnidadLarga es formatearUnidadLarga: la unidad dicha en una oración.
func UnidadLarga(u string) string {
	if u == "" {
		return "unidad"
	}
	if n, ok := nombreLargo[u]; ok {
		return n
	}
	return strings.ReplaceAll(u, "_", " ")
}

// revisarCantidad es revisarCantidadDeStock: una cantidad con decimales solo
// para lo que se fracciona.
func (s *Servicio) revisarCantidad(ctx context.Context, variante string, cantidad float64) error {
	if math.IsNaN(cantidad) || math.IsInf(cantidad, 0) {
		return plataforma.Invalido(map[string]string{"cantidad": "La cantidad tiene que ser un número."})
	}
	unidad, err := s.q.UnidadDeVariante(ctx, variante)
	if errors.Is(err, pgx.ErrNoRows) {
		return plataforma.Invalido(map[string]string{"variantId": "No se encontró el producto."})
	}
	if err != nil {
		return err
	}
	if !productos.AdmiteDecimales(unidad) && cantidad != math.Trunc(cantidad) {
		return plataforma.Invalido(map[string]string{"cantidad": "Este producto se cuenta por " + UnidadLarga(unidad) + ": la cantidad va sin decimales."})
	}
	return nil
}

// --- la grilla ---

// Sucursal es una de las sucursales activas, en el orden de la base. La
// grilla tiene una columna por cada una: salen de `branches`, no de una lista
// escrita en el código.
type Sucursal struct {
	ID     string `json:"id"`
	Slug   string `json:"slug"`
	Nombre string `json:"nombre"`
}

// StockEnSucursal es el stock de una medida en una sucursal.
//
// Disponible es físico − reservado *con signo*: negativo es lo vendido de
// más, el faltante que hay que comprar (mes simulado, H218). La tarjeta
// mostraba «0 · Sin stock» con 135 placas vendidas y 70 en el galpón.
//
// EnReparto es lo que va en el camión (H166): lo de los remitos de envío
// sin firmar, que ya bajó del físico al despachar, más lo reservado de un
// pedido «en camino» de antes de que el despacho sacara remito, que sigue
// en el físico del sistema pero no en el estante. Galpon es lo que hay que
// encontrar al ir a contar: el físico menos eso último. La reserva de un
// pedido en camino con remito es lo que falta llevar, y está en el galpón:
// se leía como en reparto y se restaba dos veces (mes simulado, PED-1208).
// Llegando es lo que viene de otra sucursal en un traslado sin recibir.
type StockEnSucursal struct {
	Sucursal
	Qty        float64             `json:"qty"`
	Reservado  float64             `json:"reservado"`
	Disponible float64             `json:"disponible"`
	EnReparto  float64             `json:"enReparto"`
	Galpon     float64             `json:"galpon"`
	Llegando   float64             `json:"llegando"`
	Min        float64             `json:"min"`
	Nivel      catalogo.NivelStock `json:"nivel"`
}

// FilaStock es una medida con su stock en cada sucursal activa.
type FilaStock struct {
	VariantID    string            `json:"variantId"`
	ProductID    string            `json:"productId"`
	ProductSlug  string            `json:"productSlug"`
	ProductName  string            `json:"productName"`
	Label        string            `json:"label"`
	SKU          string            `json:"sku"`
	CodigoBarras *string           `json:"codigoBarras"`
	CategoryName string            `json:"categoryName"`
	Unidad       string            `json:"unidad"`
	LargoMm      *int32            `json:"largoMm"`
	Imagen       *string           `json:"imagen"`
	Sucursales   []StockEnSucursal `json:"sucursales"`
	// Total es la suma de lo disponible de las sucursales que tienen: sumaba
	// el físico y «109 total» no cerraba con 65 + 30 (H198). Un negativo no
	// resta: «186 disponibles» con Casa Central en −14 tapaba el faltante
	// (M2S2-122), que va aparte en Faltante.
	Total float64 `json:"total"`
	// Faltante es lo vendido de más, sumado de las sucursales en negativo.
	Faltante float64 `json:"faltante"`
	// ParaReponer es catalogo.MedidaParaReponer, el mismo criterio que la
	// pestaña y el inicio.
	ParaReponer bool `json:"paraReponer"`
}

// ConteosDeStock son los totales de cada grupo con los mismos filtros.
// Reponer, SinStock y ConStock no se pisan: suman Todas.
type ConteosDeStock struct {
	Todas    int `json:"todas"`
	SinStock int `json:"sinStock"`
	Reponer  int `json:"reponer"`
	ConStock int `json:"conStock"`
}

// GrillaDeStock es una página de la grilla, con el total del filtro y las
// sucursales que forman las columnas.
type GrillaDeStock struct {
	Filas      []FilaStock    `json:"filas"`
	Total      int            `json:"total"`
	Conteos    ConteosDeStock `json:"conteos"`
	Sucursales []Sucursal     `json:"sucursales"`
}

// PorPaginaStock: dos columnas de tarjetas.
const PorPaginaStock = 30

// Sucursales son las activas, por orden.
func (s *Servicio) Sucursales(ctx context.Context) ([]Sucursal, error) {
	filas, err := s.pool.Query(ctx, `SELECT id, slug, name FROM branches WHERE active ORDER BY sort_order, name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Sucursal, error) {
		var x Sucursal
		return x, r.Scan(&x.ID, &x.Slug, &x.Nombre)
	})
}

// BajoElMinimo es, sobre la fila `v` de product_variants, el grupo «Hay
// que reponer» de Stock: la misma regla del inicio y de Sucursales
// (catalogo.MedidaParaReponer; simulación del mes, H062 y H004).
const BajoElMinimo = catalogo.MedidaParaReponer

// Los grupos de la pantalla, en SQL, sin pisarse: «reponer» es la regla de
// catalogo.MedidaParaReponer (la misma del inicio y de Sucursales); de lo
// demás, «sin stock» es lo que no tiene nada para vender en ninguna
// sucursal, y «con stock» el resto. Antes «reponer» excluía la sucursal en
// cero y «sin stock» miraba el total del físico: la chapa sin stock en el
// Aserradero, mínimo 50, no caía en ningún grupo para atender (H004).
var estadosDeStock = map[string]string{
	"reponer":   CondicionReponer,
	"sin-stock": CondicionSinStock,
	"con-stock": `NOT ` + catalogo.MedidaParaReponer + ` AND ` + catalogo.MedidaConDisponible,
}

// columnasDeBusqueda son las de la grilla y de los movimientos: nombre,
// código, medida, material, color y categoría.
var columnasDeBusqueda = []string{"p.name", "v.sku", "v.label", "v.material", "v.color", "c.name"}

// filtrar arma el WHERE común de la grilla y de los movimientos.
func filtrar(f listado.Filtros) *listado.Consulta {
	var c listado.Consulta
	c.Y("p.active")
	c.Y("v.active")
	c.Comunes(f, "v.id")
	// El lector de código de barras escribe el número entero.
	c.BusquedaFlexible(f.Busqueda, columnasDeBusqueda, "v.codigo_barras")
	return &c
}

// CondicionReponer y CondicionSinStock son los grupos «Hay que reponer» y
// «Sin stock» de la pantalla, sobre una medida (alias v). Los usa también el
// inicio del panel: contaba filas de inventario por sucursal (30) mientras
// Stock, a donde lleva, decía 5 medidas.
const (
	CondicionReponer  = catalogo.MedidaParaReponer
	CondicionSinStock = `NOT ` + catalogo.MedidaParaReponer + ` AND NOT ` + catalogo.MedidaConDisponible
)

// Listar es listarStock, de a páginas: las medidas activas, por nombre.
func (s *Servicio) Listar(ctx context.Context, f listado.Filtros) (GrillaDeStock, error) {
	return s.ListarEn(ctx, f, "")
}

// estadosEnSucursal son los grupos mirando una sola sucursal (por su slug,
// en el argumento `arg`): con el Aserradero en cero y mínimo 50, la chapa es
// «para reponer» en el Aserradero y está bien en Casa Central (M2S1-028).
func estadosEnSucursal(arg string) map[string]string {
	en := `i.variant_id = v.id AND i.branch_id = (SELECT id FROM branches WHERE slug = ` + arg + `)`
	reponer := `EXISTS (SELECT 1 FROM inventory i WHERE ` + en + ` AND ` + catalogo.ReponerEnFila + `)`
	con := `EXISTS (SELECT 1 FROM inventory i WHERE ` + en + ` AND i.qty - i.reservado > 0)`
	return map[string]string{
		"reponer":   reponer,
		"sin-stock": `NOT ` + reponer + ` AND NOT ` + con,
		"con-stock": `NOT ` + reponer + ` AND ` + con,
	}
}

// ListarEn es Listar con los grupos de una sola sucursal (su slug); vacía,
// de todas.
func (s *Servicio) ListarEn(ctx context.Context, f listado.Filtros, sucursal string) (GrillaDeStock, error) {
	out := GrillaDeStock{Filas: []FilaStock{}, Sucursales: []Sucursal{}}
	sucs, err := s.Sucursales(ctx)
	if err != nil {
		return out, err
	}
	out.Sucursales = append(out.Sucursales, sucs...)
	c := filtrar(f)
	desde := ` FROM product_variants v
		JOIN products p ON p.id = v.product_id
		JOIN categories c ON c.id = p.category_id `
	estados, paraReponer := estadosDeStock, catalogo.MedidaParaReponer
	if sucursal = strings.TrimSpace(sucursal); sucursal != "" {
		estados = estadosEnSucursal(c.Arg(sucursal))
		paraReponer = estados["reponer"]
	}
	k := &out.Conteos
	if err := s.pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE `+estados["sin-stock"]+`),
		count(*) FILTER (WHERE `+estados["reponer"]+`), count(*) FILTER (WHERE `+estados["con-stock"]+`)`+desde+c.Donde(),
		c.Args()...).Scan(&k.Todas, &k.SinStock, &k.Reponer, &k.ConStock); err != nil {
		return out, err
	}
	out.Total = map[string]int{"sin-stock": k.SinStock, "reponer": k.Reponer, "con-stock": k.ConStock}[f.Estado]
	if cond, ok := estados[f.Estado]; ok {
		c.Y(cond)
	} else {
		out.Total = k.Todas
	}
	limite, salto := f.Pagina(PorPaginaStock)
	// Lo que empieza una palabra va primero: buscando «laca» salían todas las
	// placas antes que la laca (H295).
	primero := c.PrimeroPalabrasEnteras(f.Busqueda, `concat_ws(' ', p.name, v.label, v.sku)`)
	filas, err := s.pool.Query(ctx, `
		SELECT v.id, p.id, p.slug, p.name, v.label, v.sku, v.codigo_barras, c.name, p.unit::text, v.largo_mm,
		  (SELECT i.url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order LIMIT 1),
		  `+paraReponer+`
		`+desde+c.Donde()+`
		ORDER BY `+primero+` DESC, p.name, v.sort_order, v.id
		LIMIT `+c.Arg(limite)+` OFFSET `+c.Arg(salto), c.Args()...)
	if err != nil {
		return out, err
	}
	pagina, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (FilaStock, error) {
		var x FilaStock
		err := r.Scan(&x.VariantID, &x.ProductID, &x.ProductSlug, &x.ProductName, &x.Label, &x.SKU, &x.CodigoBarras,
			&x.CategoryName, &x.Unidad, &x.LargoMm, &x.Imagen, &x.ParaReponer)
		return x, err
	})
	if err != nil || len(pagina) == 0 {
		return out, err
	}
	ids := make([]string, len(pagina))
	for i, x := range pagina {
		ids[i] = x.VariantID
	}
	type clave struct{ variante, sucursal string }
	type cantidades struct{ qty, res, min float64 }
	inv := map[clave]cantidades{}
	rs, err := s.pool.Query(ctx, `SELECT variant_id, branch_id, qty::float8, reservado::float8, min_qty::float8
		FROM inventory WHERE variant_id = ANY($1::uuid[])`, ids)
	if err != nil {
		return out, err
	}
	for rs.Next() {
		var k clave
		var c cantidades
		if err := rs.Scan(&k.variante, &k.sucursal, &c.qty, &c.res, &c.min); err != nil {
			rs.Close()
			return out, err
		}
		inv[k] = c
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return out, err
	}
	camion, err := s.sumasPorSucursal(ctx, consultaEnElCamion, ids)
	if err != nil {
		return out, err
	}
	sinRemito, err := s.sumasPorSucursal(ctx, consultaEnCaminoSinRemito, ids)
	if err != nil {
		return out, err
	}
	llegando, err := s.sumasPorSucursal(ctx, consultaLlegando, ids)
	if err != nil {
		return out, err
	}
	for i := range pagina {
		x := &pagina[i]
		x.Sucursales = make([]StockEnSucursal, len(sucs))
		suma, falta := 0.0, 0.0
		for j, b := range sucs {
			c := inv[clave{x.VariantID, b.ID}]
			disponible := Cantidad(c.qty - c.res)
			k := [2]string{x.VariantID, b.ID}
			x.Sucursales[j] = StockEnSucursal{Sucursal: b, Qty: c.qty, Reservado: c.res, Disponible: disponible,
				EnReparto: Cantidad(camion[k] + sinRemito[k]), Galpon: Cantidad(c.qty - sinRemito[k]), Llegando: llegando[[2]string{x.VariantID, b.ID}], Min: c.min,
				Nivel: catalogo.Nivel(catalogo.Disponible(c.qty, c.res), c.min)}
			if disponible > 0 {
				suma += disponible
			} else {
				falta -= disponible
			}
		}
		x.Total = Cantidad(suma)
		x.Faltante = Cantidad(falta)
	}
	out.Filas = pagina
	return out, nil
}

// Alerta es una medida en o debajo de su mínimo.
type Alerta struct {
	VariantID   string  `json:"variantId"`
	ProductName string  `json:"productName"`
	Label       string  `json:"label"`
	BranchName  string  `json:"branchName"`
	Qty         float64 `json:"qty"`
	Reservado   float64 `json:"reservado"`
	MinQty      float64 `json:"minQty"`
}

// Alertas son las medidas cuyo disponible llegó al mínimo, las más justas primero.
func (s *Servicio) Alertas(ctx context.Context, limite int) ([]Alerta, error) {
	filas, err := s.q.AlertasDeStock(ctx, int32(limite))
	if err != nil {
		return nil, err
	}
	out := make([]Alerta, len(filas))
	for i, f := range filas {
		out[i] = Alerta{f.VariantID, f.ProductName, f.Label, f.BranchName, float64(f.Qty), float64(f.Reservado), float64(f.MinQty)}
	}
	return out, nil
}

// Lo que va en el camión y lo que viene en un traslado, por medida y
// sucursal (ver StockEnSucursal).
const (
	// Lo que salió con un remito de envío que nadie firmó todavía: el
	// despacho ya lo bajó del físico. Anulado no cuenta: volvió al stock.
	consultaEnElCamion = `SELECT m.variant_id, m.branch_id, (-sum(m.qty))::float8
		FROM deliveries d JOIN inventory_movements m ON m.type = 'venta' AND m.note = 'Remito ' || d.numero
		WHERE d.tipo = 'envio' AND d.estado = 'preparada' AND m.variant_id = ANY($1::uuid[])
		GROUP BY m.variant_id, m.branch_id`
	// Un pedido en camino sin ningún remito de envío vivo salió antes de que
	// el despacho sacara remito: lo reservado va en el camión y sigue en el
	// físico. Con remito, lo reservado es lo que falta llevar.
	consultaEnCaminoSinRemito = `SELECT r.variant_id, r.branch_id, sum(r.cantidad)::float8
		FROM stock_reservations r JOIN orders o ON o.id = r.order_id
		WHERE r.estado = 'activa' AND o.estado = 'en-camino' AND r.variant_id = ANY($1::uuid[])
		  AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.tipo = 'envio' AND d.estado <> 'anulada')
		GROUP BY r.variant_id, r.branch_id`
	consultaLlegando = `SELECT it.variant_id, t.destino_id, sum(it.cantidad)::float8
		FROM stock_traslado_items it JOIN stock_traslados t ON t.id = it.traslado_id
		WHERE t.estado = 'en-camino' AND it.variant_id = ANY($1::uuid[])
		GROUP BY it.variant_id, t.destino_id`
)

func (s *Servicio) sumasPorSucursal(ctx context.Context, consulta string, ids []string) (map[[2]string]float64, error) {
	out := map[[2]string]float64{}
	rs, err := s.pool.Query(ctx, consulta, ids)
	if err != nil {
		return nil, err
	}
	var v, b string
	var n float64
	_, err = pgx.ForEachRow(rs, []any{&v, &b, &n}, func() error {
		out[[2]string{v, b}] = Cantidad(n)
		return nil
	})
	return out, err
}

// Movimiento es uno de los últimos.
//
// Concepto y Referencia dicen qué fue: el libro decía «Egreso» para una
// rotura, un faltante y una devolución al proveedor (H106), y «Venta» para el
// retiro de un acopio vendido hace semanas (H326). Salen del tipo, del
// documento y de la nota, que escribe siempre el sistema.
type Movimiento struct {
	ID          string    `json:"id"`
	VariantID   string    `json:"variantId"`
	ProductID   string    `json:"productId"`
	ProductName string    `json:"productName"`
	Label       string    `json:"label"`
	BranchName  string    `json:"branchName"`
	Type        string    `json:"type"`
	Concepto    string    `json:"concepto"`
	Referencia  *string   `json:"referencia"`
	Qty         float64   `json:"qty"`
	Note        *string   `json:"note"`
	CreatedAt   time.Time `json:"createdAt"`
	// Usuario es quién lo hizo; Antes y Despues, el stock de la sucursal en
	// un ajuste o un conteo: «Conteo · 28 → 27 · Sim Depósito» (M2S1-169).
	Usuario *string  `json:"usuario"`
	Antes   *float64 `json:"antes"`
	Despues *float64 `json:"despues"`
}

var reAntesDespues = regexp.MustCompile(`\((-?[\d.]+(?:,\d+)?) → (-?[\d.]+(?:,\d+)?)\)`)

// AntesYDespues lee el «(28 → 27)» que el sistema escribe en la nota de un
// ajuste, en el formato de formato.Cantidad («1.234,5»).
func AntesYDespues(nota string) (*float64, *float64) {
	m := reAntesDespues.FindStringSubmatch(nota)
	if m == nil {
		return nil, nil
	}
	leer := func(t string) *float64 {
		n := LeerCantidad(strings.ReplaceAll(t, ".", ""))
		if math.IsNaN(n) {
			return nil
		}
		return &n
	}
	a, d := leer(m[1]), leer(m[2])
	if a == nil || d == nil {
		return nil, nil
	}
	return a, d
}

// Movimientos son los últimos de las medidas que pasan el filtro de la
// grilla: buscando un tirante, los de ese tirante y no los de todo el
// negocio (H206). Con el filtro vacío, los de todo.
func (s *Servicio) Movimientos(ctx context.Context, f listado.Filtros, limite int) ([]Movimiento, error) {
	c := filtrar(f)
	filas, err := s.pool.Query(ctx, `
		SELECT m.id, v.id, p.id, p.name, v.label, b.name, m.type::text, m.qty::float8, m.note, m.documento_tipo, m.created_at, u.name
		FROM inventory_movements m
		LEFT JOIN "user" u ON u.id = m.created_by_user_id
		JOIN product_variants v ON v.id = m.variant_id
		JOIN products p ON p.id = v.product_id
		JOIN categories c ON c.id = p.category_id
		JOIN branches b ON b.id = m.branch_id
		`+c.Donde()+`
		ORDER BY m.created_at DESC, m.id
		LIMIT `+c.Arg(limite), c.Args()...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Movimiento, error) {
		var x Movimiento
		var documento *string
		if err := r.Scan(&x.ID, &x.VariantID, &x.ProductID, &x.ProductName, &x.Label, &x.BranchName, &x.Type, &x.Qty, &x.Note, &documento, &x.CreatedAt, &x.Usuario); err != nil {
			return x, err
		}
		x.Antes, x.Despues = AntesYDespues(deref(x.Note))
		concepto, ref := ConceptoDe(x.Type, deref(x.Note), deref(documento))
		x.Concepto = concepto
		if ref != "" {
			x.Referencia = &ref
		}
		return x, nil
	})
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

var etiquetaDeTipo = map[string]string{
	"ingreso": "Ingreso", "egreso": "Egreso", "ajuste": "Ajuste", "transferencia_salida": "Traslado",
	"transferencia_entrada": "Traslado", "venta": "Venta", "devolucion": "Devolución",
}

// Lo que AjustarCon escribe antes de « desde Stock», dicho corto.
var conceptoDeAjuste = map[string]string{
	"Ajuste rápido": "Ajuste", "Devolución de cliente": "Devolución", "Devolución al proveedor": "Al proveedor",
}

var reReferencia = regexp.MustCompile(`\b((?:PED|REM|TRA|OC|CRT)-\d+)\b`)

// ConceptoDe es qué fue un movimiento y de qué comprobante, a partir del
// tipo, la nota y el documento que lo generó.
func ConceptoDe(tipo, nota, documento string) (concepto, referencia string) {
	ref := ""
	if m := reReferencia.FindStringSubmatch(nota); m != nil {
		ref = m[1]
	}
	switch {
	case documento == "recepcion":
		if tipo == "ingreso" {
			return "Recepción", strings.TrimPrefix(strings.TrimPrefix(nota, "Recepción de mercadería"), "Remito ")
		}
		return "Recepción corregida", ""
	case documento == "devolucion":
		return "Devolución", ref
	case tipo == "venta" && strings.HasPrefix(nota, "Remito "):
		// El retiro de lo vendido (un acopio, un envío): sale con su remito.
		return "Entrega", strings.TrimPrefix(nota, "Remito ")
	case tipo == "venta":
		return "Venta", ref
	case tipo == "devolucion" && strings.HasPrefix(nota, "Anulación"):
		return "Anulación", ref
	case strings.HasPrefix(nota, "Ajuste manual desde la ficha"):
		return "Ajuste en la ficha", ""
	case strings.HasPrefix(nota, "Existencia inicial"):
		return "Existencia inicial", ""
	}
	if antes, _, ok := strings.Cut(nota, " desde Stock"); ok && (tipo == "ingreso" || tipo == "egreso") {
		// La reposición dice a quién: la nota termina en «· PED-1098 ·
		// Ferreyra» (decía solo el pedido, tercera prueba).
		if documento == "pedido" && ref != "" {
			if _, cliente, ok := strings.Cut(nota, ref+" · "); ok && strings.TrimSpace(cliente) != "" {
				return "Reposición a " + strings.TrimSpace(cliente), ref
			}
		}
		if c, ok := conceptoDeAjuste[antes]; ok {
			return c, ref
		}
		return antes, ref
	}
	if e, ok := etiquetaDeTipo[tipo]; ok {
		return e, ref
	}
	return tipo, ref
}

// --- el ajuste rápido ---

// Ajustar suma (o resta) una cantidad al stock de una sucursal: el ajuste
// rápido de la grilla. Devuelve el mensaje («Casa Central: 3 → 5»), o "" si
// la cantidad es cero (no hace nada).
func (s *Servicio) Ajustar(ctx context.Context, ses *auth.Sesion, variante, sucursal string, delta float64) (string, error) {
	return s.AjustarCon(ctx, ses, Ajuste{Variante: variante, Sucursal: sucursal, Delta: delta})
}

// MotivosDeAjuste es por qué se tocó el stock a mano, para el libro de
// movimientos: un faltante por rotura no es lo mismo que uno por conteo.
//
// «correccion» es el «Deshacer» del ajuste rápido: el movimiento inverso de
// uno que se cargó mal. Queda en el libro con su nombre, y no como «otro»: un
// libro lleno de «otro» no le dice nada a nadie (T4, hallazgo 21).
//
// «taller» es lo que gasta la seccionadora sin una venta que lo descuente
// (mes simulado, H220): el depósito lo conciliaba como «Egreso». «reposicion»
// es lo que se le da a un cliente que reclamó un faltante de su pedido, y va
// atado a ese pedido (H275).
var MotivosDeAjuste = map[string]string{
	"ingreso": "Ingreso", "rotura": "Rotura", "conteo": "Conteo", "devolucion": "Devolución",
	"faltante": "Faltante", "correccion": "Corrección", "otro": "Ajuste", "taller": "Consumo del taller",
	"reposicion": "Reposición a cliente",
}

// Los motivos que solo restan.
var motivosQueRestan = map[string]bool{"rotura": true, "faltante": true, "taller": true, "reposicion": true}

// revisarDireccion: el motivo dice para qué lado va el stock. Un ingreso que
// resta o una rotura que suma dejan el libro diciendo lo contrario de lo que
// pasó; la pantalla convertía en silencio una «rotura» que sumaba en «otro»
// (T4, hallazgo 21). La devolución va para los dos lados —la del cliente
// entra, la al proveedor sale—, y la corrección y «otro» también: deshacer
// una rotura es sumar. El conteo va para el lado que dé la diferencia.
func revisarDireccion(motivo string, delta float64) error {
	mal := func(m string) error { return plataforma.Invalido(map[string]string{"motivo": m}) }
	switch {
	case motivo == "ingreso" && delta < 0:
		return mal("Un ingreso suma: para sacar, elegí otro motivo.")
	case motivosQueRestan[motivo] && delta > 0:
		return mal("«" + MotivosDeAjuste[motivo] + "» resta: para sumar, elegí otro motivo.")
	}
	return nil
}

// Ajuste es lo que pide la pantalla: sumar o restar Delta, o, con Contado,
// dejar en el galpón lo que se contó. Pedido es el número (PED-…) de la
// reposición a un cliente.
type Ajuste struct {
	Variante, Sucursal string
	Delta              float64
	Contado            *float64
	Motivo, Pedido     string
}

// pedidoDeLaReposicion es el pedido al que va atada una reposición.
type pedidoDeLaReposicion struct{ id, numero, cliente, estado string }

// AjustarCon es Ajustar con el motivo y, si viene `contado`, fijando el stock
// en lo que se contó. La diferencia se calcula adentro, con el candado: si
// se vendió algo mientras se contaba, el conteo no lo pisa con un número
// viejo de la pantalla.
//
// Lo contado es lo del galpón: lo que salió en el camión de un pedido «en
// camino» sigue en el físico del sistema hasta su remito, y contarlo como
// faltante lo descontaría dos veces (H166). El conteo puede dejar lo
// disponible por debajo de lo reservado: es lo que hay, y el faltante queda a
// la vista para reponerlo (H218); un ajuste con motivo, en cambio, no.
func (s *Servicio) AjustarCon(ctx context.Context, ses *auth.Sesion, a Ajuste) (string, error) {
	variante, sucursal, motivo, contado := a.Variante, a.Sucursal, a.Motivo, a.Contado
	cantidad := Cantidad(a.Delta)
	if contado != nil {
		c := Cantidad(*contado)
		contado = &c
		cantidad = 0
	}
	// La sucursal la busca SucursalPorSlug más abajo: estaban las dos escritas
	// acá y una tercera no se podía ajustar desde la grilla.
	if !plataforma.UUIDValido(variante) || strings.TrimSpace(sucursal) == "" || math.IsNaN(cantidad) || math.IsInf(cantidad, 0) ||
		contado != nil && (math.IsNaN(*contado) || math.IsInf(*contado, 0) || *contado < 0) {
		return "", plataforma.Invalido(map[string]string{"cantidad": "La cantidad tiene que ser un número, sin letras."})
	}
	if _, ok := MotivosDeAjuste[motivo]; motivo != "" && !ok {
		return "", plataforma.Invalido(map[string]string{"motivo": "Ese motivo no existe."})
	}
	switch {
	case contado == nil && motivo == "conteo":
		return "", plataforma.Invalido(map[string]string{"motivo": "Para contar hay que decir cuánto hay."})
	case contado != nil && (motivo == "correccion" || motivo == "otro" || motivo == "reposicion"):
		return "", plataforma.Invalido(map[string]string{"motivo": "Lo contado va con «Conteo» o con lo que explica la diferencia."})
	}
	if err := revisarDireccion(motivo, cantidad); err != nil {
		return "", err
	}
	if cantidad == 0 && contado == nil {
		return "", nil
	}
	revisar := cantidad
	if contado != nil {
		revisar = *contado
	}
	if err := s.revisarCantidad(ctx, variante, revisar); err != nil {
		return "", err
	}
	suc, err := s.q.SucursalPorSlug(ctx, sucursal)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.Invalido(map[string]string{"branchSlug": "No se encontró la sucursal."})
	}
	if err != nil {
		return "", err
	}
	var pedido *pedidoDeLaReposicion
	if motivo == "reposicion" {
		numero := strings.ToUpper(strings.TrimSpace(a.Pedido))
		if numero == "" {
			return "", plataforma.Invalido(map[string]string{"pedido": "Poné el número del pedido del cliente."})
		}
		if !strings.HasPrefix(numero, "PED-") {
			numero = "PED-" + numero
		}
		p := pedidoDeLaReposicion{}
		err := s.pool.QueryRow(ctx, `SELECT o.id, o.numero, coalesce(c.nombre, o.contacto_nombre, ''), o.estado::text
			FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.numero = $1`, numero).Scan(&p.id, &p.numero, &p.cliente, &p.estado)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", plataforma.Invalido(map[string]string{"pedido": "No hay ningún pedido " + numero + "."})
		}
		if err != nil {
			return "", err
		}
		if p.estado == "cancelado" {
			return "", plataforma.Invalido(map[string]string{"pedido": p.numero + " está anulado."})
		}
		pedido = &p
	}
	var ok, anotado string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		anotado = ""
		q := s.q.WithTx(tx)
		if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: variante, Sucursal: suc.ID}); err != nil {
			return err
		}
		previo, reservado := 0.0, 0.0
		if a, err := q.StockYReservado(ctx, sqlc.StockYReservadoParams{VariantID: variante, BranchID: suc.ID}); err == nil {
			previo, reservado = float64(a.Qty), float64(a.Reservado)
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if contado != nil {
			var reparto float64
			if err := tx.QueryRow(ctx, `SELECT coalesce(sum(r.cantidad), 0)::float8 FROM stock_reservations r JOIN orders o ON o.id = r.order_id
				WHERE r.estado = 'activa' AND o.estado = 'en-camino' AND r.variant_id = $1 AND r.branch_id = $2
				  AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.tipo = 'envio' AND d.estado <> 'anulada')`, variante, suc.ID).Scan(&reparto); err != nil {
				return err
			}
			galpon := Cantidad(previo - reparto)
			cantidad = Cantidad(*contado - galpon)
			if cantidad == 0 {
				ok = suc.Name + ": el conteo coincide, " + formato.Cantidad(galpon)
				return nil
			}
			if err := revisarDireccion(motivo, cantidad); err != nil {
				return err
			}
			if motivo == "" {
				motivo = "conteo"
			}
		}
		nuevo := Cantidad(previo + cantidad)
		if nuevo < 0 {
			return plataforma.Invalido(map[string]string{"cantidad": "Solo hay " + formato.Cantidad(previo) + " en " + suc.Name + "."})
		}
		// Lo reservado es de clientes que ya pagaron: un ajuste que baja el
		// físico no puede dejar lo disponible en negativo (el TS miraba solo
		// el físico, como la transferencia). Sumar siempre se puede, y lo
		// contado también (ver arriba).
		if contado == nil && cantidad < 0 && nuevo < reservado {
			libre := catalogo.Disponible(previo, reservado)
			m := "En " + suc.Name + " hay " + formato.Cantidad(previo) + " y " + formato.Cantidad(reservado) +
				" está" + pluralN(reservado) + " reservado" + plural(reservado) + " para clientes"
			if libre > 0 {
				m += ": se pueden sacar hasta " + formato.Cantidad(libre) + "."
			} else {
				m += ": no se puede sacar nada sin antes liberar o entregar esas reservas."
			}
			return plataforma.Invalido(map[string]string{"cantidad": m})
		}
		if err := q.FijarCantidad(ctx, sqlc.FijarCantidadParams{VariantID: variante, BranchID: suc.ID, Qty: jsmath.Num(nuevo)}); err != nil {
			return err
		}
		tipo := sqlc.MovementTypeEgreso
		if cantidad > 0 {
			tipo = sqlc.MovementTypeIngreso
		}
		que := "Ajuste rápido desde Stock"
		if m, ok := MotivosDeAjuste[motivo]; ok && motivo != "otro" {
			que = m + " desde Stock"
		}
		// La devolución va para los dos lados, y el libro dice cuál: la que
		// entra es de un cliente y la que sale, a un proveedor (comité de T4:
		// la pantalla solo la ofrecía sumando, y la del proveedor quedaba
		// como «Faltante»).
		if motivo == "devolucion" {
			que = "Devolución de cliente desde Stock"
			if cantidad < 0 {
				que = "Devolución al proveedor desde Stock"
			}
		}
		nota := que + " (" + formato.Cantidad(previo) + " → " + formato.Cantidad(nuevo) + ")"
		var docTipo, docID *string
		if pedido != nil {
			nota += " · " + pedido.numero
			if pedido.cliente != "" {
				nota += " · " + pedido.cliente
			}
			t := "pedido"
			docTipo, docID = &t, &pedido.id
			// Queda en el historial del pedido: ahí se mira qué se le dio.
			// Con su unidad, como el remito: «1 par · Corredera…» (decía «1
			// Corredera», mes simulado).
			var producto, unidad string
			if err := tx.QueryRow(ctx, `SELECT p.name || ' ' || v.label, p.unit::text FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
				variante).Scan(&producto, &unidad); err != nil {
				return err
			}
			cuanto := formato.Cantidad(-cantidad) + " " + pdf.UnidadPara(unidad, -cantidad, producto)
			if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, $2::estado_pedido, $3, $4)`,
				pedido.id, pedido.estado, "Reposición sin cargo: "+cuanto+" · "+producto+", de "+suc.Name, ses.UserID); err != nil {
				return err
			}
		}
		ok = suc.Name + ": " + formato.Cantidad(previo) + " → " + formato.Cantidad(nuevo)
		anotado = nota
		// El costo promedio de hoy (o el de la lista del proveedor) queda
		// congelado en el movimiento: es el que asienta la baja (o el alta)
		// contra Mercaderías (M3S3-013).
		_, err := tx.Exec(ctx, `INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id, documento_tipo, documento_id, costo_unitario)
			VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, `+catalogo.CostoDeAjuste("$1")+`)`,
			variante, suc.ID, tipo, jsmath.Texto(cantidad), nota, ses.UserID, docTipo, docID)
		return err
	})
	// Toda baja o alta a mano (rotura, faltante, conteo) queda en la
	// bitácora con quién, cuánto y por qué: es lo que pide el estudio para
	// justificar el costo de lo perdido (mes simulado, M2S4-019).
	if err == nil && anotado != "" {
		var producto string
		_ = s.pool.QueryRow(ctx, `SELECT p.name || ' ' || v.label FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`, variante).Scan(&producto)
		bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "stock", variante, producto+" en "+suc.Name+": "+anotado, nil)
	}
	return ok, err
}

// --- la transferencia ---

// FormTransferencia es el formulario, como texto.
type FormTransferencia struct{ VariantID, OrigenID, DestinoID, Cantidad, Nota string }

func validarTransferencia(f FormTransferencia) (float64, string, error) {
	mal := func(campo, m string) (float64, string, error) {
		return 0, "", plataforma.Invalido(map[string]string{campo: m})
	}
	if !plataforma.UUIDValido(f.VariantID) {
		return mal("variantId", "Elegí un producto.")
	}
	if !plataforma.UUIDValido(f.OrigenID) {
		return mal("origenId", "Elegí la sucursal de origen.")
	}
	if !plataforma.UUIDValido(f.DestinoID) {
		return mal("destinoId", "Elegí la sucursal de destino.")
	}
	c := Cantidad(LeerCantidad(f.Cantidad))
	switch {
	case math.IsNaN(c):
		return mal("cantidad", "Invalid input: expected number, received NaN")
	case math.IsInf(c, 0):
		return mal("cantidad", "La cantidad tiene que ser un número.")
	case c <= 0:
		return mal("cantidad", "La cantidad tiene que ser mayor a cero.")
	}
	nota := strings.TrimSpace(f.Nota)
	if plataforma.LargoJS(nota) > 300 {
		return mal("nota", "Too big: expected string to have <=300 characters")
	}
	return c, nota, nil
}

// Transferir mueve stock de una sucursal a otra: un movimiento de salida y
// uno de entrada con el mismo grupo.
//
// Dos diferencias con el TS, a propósito: toma el candado de las dos
// sucursales (el TS no tomaba ninguno y podía pisarse con una venta), en un
// orden fijo para que dos transferencias cruzadas no se traben, y controla
// contra lo disponible (físico − reservado), no contra el físico: el TS
// dejaba mover mercadería ya reservada para un cliente.
func (s *Servicio) Transferir(ctx context.Context, ses *auth.Sesion, f FormTransferencia) error {
	cantidad, nota, err := validarTransferencia(f)
	if err != nil {
		return err
	}
	if f.OrigenID == f.DestinoID {
		return plataforma.Invalido(map[string]string{"destinoId": "El origen y el destino tienen que ser distintos."})
	}
	if err := s.revisarCantidad(ctx, f.VariantID, cantidad); err != nil {
		return err
	}
	var notaP *string
	if nota != "" {
		notaP = &nota
	}
	grupo := uuid()
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		sucursales := []string{f.OrigenID, f.DestinoID}
		sort.Strings(sucursales)
		for _, suc := range sucursales {
			if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: f.VariantID, Sucursal: suc}); err != nil {
				return err
			}
		}
		fisico, reservado := 0.0, 0.0
		if a, err := q.StockYReservado(ctx, sqlc.StockYReservadoParams{VariantID: f.VariantID, BranchID: f.OrigenID}); err == nil {
			fisico, reservado = float64(a.Qty), float64(a.Reservado)
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if disponible := catalogo.Disponible(fisico, reservado); disponible < cantidad {
			m := "En la sucursal de origen hay " + formato.Cantidad(fisico)
			if reservado > 0 {
				m += " (" + formato.Cantidad(reservado) + " reservado" + plural(reservado) + " para clientes)"
			}
			return plataforma.Invalido(map[string]string{"cantidad": m + ". No se pueden mover " + formato.Cantidad(cantidad) + "."})
		}
		if err := q.FijarCantidad(ctx, sqlc.FijarCantidadParams{VariantID: f.VariantID, BranchID: f.OrigenID, Qty: jsmath.Num(Cantidad(fisico - cantidad))}); err != nil {
			return err
		}
		if err := q.SumarCantidad(ctx, sqlc.SumarCantidadParams{VariantID: f.VariantID, BranchID: f.DestinoID, Qty: jsmath.Num(cantidad)}); err != nil {
			return err
		}
		for _, m := range []struct {
			suc  string
			tipo sqlc.MovementType
			qty  float64
		}{{f.OrigenID, sqlc.MovementTypeTransferenciaSalida, -cantidad}, {f.DestinoID, sqlc.MovementTypeTransferenciaEntrada, cantidad}} {
			if err := q.RegistrarMovimiento(ctx, sqlc.RegistrarMovimientoParams{VariantID: f.VariantID, BranchID: m.suc, Type: m.tipo,
				Qty: jsmath.Num(m.qty), Note: notaP, CreatedByUserID: &ses.UserID, TransferGroup: &grupo}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	desc := "Transfirió " + jsmath.Texto(cantidad) + " entre sucursales"
	if nota != "" {
		desc += ": " + nota
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "stock", f.VariantID, desc,
		map[string]any{"variantId": f.VariantID, "origenId": f.OrigenID, "destinoId": f.DestinoID, "cantidad": cantidad})
	return nil
}

func plural(n float64) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// pluralN es la n del verbo: «está» o «están».
func pluralN(n float64) string {
	if n == 1 {
		return ""
	}
	return "n"
}

func uuid() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
