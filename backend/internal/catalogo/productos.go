package catalogo

import (
	"context"
	"errors"
	"fmt"
	"golang.org/x/sync/errgroup"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"

	"mjbj/internal/jsmath"
	"mjbj/internal/sqlc"
)

// NivelStock es StockLevel (lib/stock-level.ts).
type NivelStock string

const (
	Alto     NivelStock = "alto"
	Medio    NivelStock = "medio"
	Bajo     NivelStock = "bajo"
	SinStock NivelStock = "sin-stock"
)

// Disponible es lo que se puede vender: lo físico menos lo reservado.
func Disponible(qty, reservado float64) float64 { return math.Max(qty-reservado, 0) }

// Nivel es stockLevel del TS.
func Nivel(qty, minQty float64) NivelStock {
	switch {
	case qty <= 0:
		return SinStock
	case minQty <= 0:
		return Alto
	case qty <= minQty:
		return Bajo
	case qty <= minQty*3:
		return Medio
	}
	return Alto
}

// Combinado es combinedStockLevel: el mejor nivel entre las variantes.
func Combinado(niveles []NivelStock) NivelStock {
	for _, n := range []NivelStock{Alto, Medio, Bajo, SinStock} {
		for _, x := range niveles {
			if x == n {
				return n
			}
		}
	}
	return SinStock
}

// ProductoListado es la tarjeta del catálogo (mismos campos que el TS).
type ProductoListado struct {
	ID              string   `json:"id"`
	Slug            string   `json:"slug"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	Subcategory     *string  `json:"subcategory"`
	SubcategorySlug *string  `json:"subcategorySlug"`
	SubcategoryName *string  `json:"subcategoryName"`
	Brand           *string  `json:"brand"`
	Unit            string   `json:"unit"`
	AlicuotaIva     string   `json:"alicuotaIva"`
	APedido         bool     `json:"aPedido"`
	FormaDeVenta    string   `json:"formaDeVenta"`
	PrecioMediaPct  float64  `json:"precioMediaPct"`
	Featured        bool     `json:"featured"`
	CategorySlug    string   `json:"categorySlug"`
	CategoryName    string   `json:"categoryName"`
	Image           *string  `json:"image"`
	PrecioDesde     *string  `json:"precioDesde"`
	PrecioAnterior  *string  `json:"precioAnterior"`
	Descuento       *float64 `json:"descuento"`
	Labels          []string `json:"labels"`
	// Stock es el nivel en cada sucursal activa, en el orden de branches
	// (sort_order): una sucursal nueva aparece sin tocar código (hallazgo
	// 35). StockCentral y StockAserradero son las dos de antes, leídas de
	// esta lista por slug, mientras quede quien las lea.
	Stock           []StockDeSucursal `json:"stock"`
	StockCentral    NivelStock        `json:"stockCentral"`
	StockAserradero NivelStock        `json:"stockAserradero"`
	HayStock        bool              `json:"hayStock"`
}

// StockDeSucursal es el nivel de stock de una sucursal activa.
type StockDeSucursal struct {
	Sucursal string     `json:"sucursal"`
	Nombre   string     `json:"nombre"`
	Nivel    NivelStock `json:"nivel"`
}

// Las dos sucursales de los campos viejos.
const (
	slugCentral    = "casa-central"
	slugAserradero = "aserradero"
)

// sucursalActiva es una fila de branches que el sitio muestra.
type sucursalActiva struct{ slug, nombre string }

// sucursalesActivas son las de branches con active, por sort_order, como la
// grilla de stock del panel.
func (s *Servicio) sucursalesActivas(ctx context.Context) ([]sucursalActiva, error) {
	filas, err := s.pool.Query(ctx, `SELECT slug, name FROM branches WHERE active ORDER BY sort_order, name, id`)
	if err != nil {
		return nil, err
	}
	var out []sucursalActiva
	var b sucursalActiva
	_, err = pgx.ForEachRow(filas, []any{&b.slug, &b.nombre}, func() error {
		out = append(out, b)
		return nil
	})
	return out, err
}

// stockPorSucursal arma la lista en el orden de las sucursales, con lo que
// no tiene fila en sin stock.
func stockPorSucursal(sucursales []sucursalActiva, nivel func(slug string) NivelStock) []StockDeSucursal {
	out := make([]StockDeSucursal, len(sucursales))
	for i, b := range sucursales {
		out[i] = StockDeSucursal{Sucursal: b.slug, Nombre: b.nombre, Nivel: nivel(b.slug)}
	}
	return out
}

// NivelEn es el nivel de una sucursal de la lista; si no está, sin stock.
func NivelEn(stock []StockDeSucursal, slug string) NivelStock {
	for _, x := range stock {
		if x.Sucursal == slug {
			return x.Nivel
		}
	}
	return SinStock
}

// HayEnAlguna dice si alguna sucursal de la lista tiene.
func HayEnAlguna(stock []StockDeSucursal) bool {
	for _, x := range stock {
		if x.Nivel != SinStock {
			return true
		}
	}
	return false
}

// Filtros son los del catálogo (FiltrosCatalogo del TS).
type Filtros struct {
	Categoria    string
	Subcategoria string
	Busqueda     string
	Stock        string // todos | en-stock | casa-central | aserradero
	Orden        string // relevancia | precio-asc | precio-desc | nombre
	SoloOfertas  bool
	Marca        string
	// IDs: nil es «sin filtro»; un slice vacío es «ninguno».
	IDs []string
	// Limite corta el listado ya ordenado (cero es «todos»): las fotos y la
	// descripción se buscan solo para lo que queda (ver Claves). El bot pide
	// seis; por la API llega como `limite`, para el asistente del sitio.
	Limite int
	// Con la tienda apagada o el stock oculto, el orden no puede delatar lo
	// que no se muestra (revisión del 10/11/2026): ordenar por precio
	// devolvía el orden de los precios ocultos, y la relevancia subía las
	// ofertas y lo que tiene stock. Los pone ocultarDelPublico.
	sinPrecios, sinStock bool
}

// NormalizarBusqueda es normalizarBusqueda (lib/busqueda.ts): sin tildes, en
// minúscula, hasta 6 palabras y 60 caracteres. Es la forma canónica para la
// clave del caché de Next.
func NormalizarBusqueda(texto string) string {
	palabras := strings.Fields(strings.ToLower(quitarTildes(texto)))
	if len(palabras) > 6 {
		palabras = palabras[:6]
	}
	limpio := strings.Join(palabras, " ")
	if r := []rune(limpio); len(r) > 60 {
		limpio = string(r[:60])
	}
	return strings.TrimSpace(limpio)
}

// terminosDeBusqueda es lo que hace coincideBusqueda con el texto: partir en
// palabras y quedarse con 6.
func terminosDeBusqueda(texto string) []string {
	t := strings.Fields(texto)
	if len(t) > 6 {
		t = t[:6]
	}
	return t
}

// listaParaConsulta son los tres datos de la lista que cambian la consulta.
type listaParaConsulta struct {
	id, generalID *string
	factor        float64
}

func (l Lista) paraConsulta() listaParaConsulta {
	f := l.FactorDerivado
	if f == 0 {
		f = 1
	}
	return listaParaConsulta{l.ID, l.GeneralID, f}
}

type varianteListado struct {
	productID      string
	label          string
	precio         *string
	precioAnterior *string
	// stock es el nivel por slug de sucursal; la que no está, sin stock.
	stock map[string]NivelStock
}

// variantesConStockYPrecio es la del TS: una fila por variante y sucursal, que
// se colapsan. El precio sale de la lista de quien mira y cae a la general
// (por el factor) cuando la lista no tiene ese producto.
func (s *Servicio) variantesConStockYPrecio(ctx context.Context, ids []string, l listaParaConsulta) ([]*varianteListado, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT v.product_id, v.id, v.label,
		       coalesce(pr.price, round((g.price * $3::numeric)::numeric, 2))::text,
		       coalesce(pr.precio_anterior, round((g.precio_anterior * $3::numeric)::numeric, 2))::text,
		       coalesce(pr.oferta_hasta, g.oferta_hasta),
		       b.slug, i.qty, i.reservado, i.min_qty
		FROM product_variants v
		LEFT JOIN price_list_items pr ON pr.variant_id = v.id AND pr.price_list_id = $1::uuid
		LEFT JOIN price_list_items g ON g.variant_id = v.id AND g.price_list_id = $2::uuid
		LEFT JOIN inventory i ON i.variant_id = v.id
		LEFT JOIN branches b ON b.id = i.branch_id
		WHERE v.product_id = ANY($4::uuid[]) AND v.active
		ORDER BY v.sort_order, v.sku, v.id`,
		l.id, l.generalID, jsmath.Num(l.factor), ids)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	ahora := time.Now()
	var orden []*varianteListado
	porVariante := map[string]*varianteListado{}
	for filas.Next() {
		var productID, variantID, label string
		var precio, anterior, sucursal *string
		var hasta *time.Time
		var qty, reservado, minQty *jsmath.Num
		if err := filas.Scan(&productID, &variantID, &label, &precio, &anterior, &hasta, &sucursal, &qty, &reservado, &minQty); err != nil {
			return nil, err
		}
		v, ok := porVariante[variantID]
		if !ok {
			v = &varianteListado{productID: productID, label: label, precio: precio, stock: map[string]NivelStock{}}
			porVariante[variantID] = v
			orden = append(orden, v)
		}
		if precio != nil {
			v.precio = precio
		}
		// La oferta vale solo si no venció.
		if anterior != nil && (hasta == nil || hasta.After(ahora)) {
			v.precioAnterior = anterior
		}
		if sucursal != nil && qty != nil && minQty != nil {
			res := 0.0
			if reservado != nil {
				res = float64(*reservado)
			}
			v.stock[*sucursal] = Nivel(Disponible(float64(*qty), res), float64(*minQty))
		}
	}
	return orden, filas.Err()
}

// claves es la primera fase de consultarProductos (la del TS): filtra en la
// base lo que se puede, y en Go lo que depende del precio y del stock ya
// armados (disponibilidad, ofertas, marca), y ordena. Trae todo lo que el
// filtro y el orden necesitan —variantes, precio, oferta y stock— y nada
// más: ni las fotos ni la descripción, que son lo que pesa y solo hacen
// falta para las tarjetas que se muestran (hidratar).
//
// Por qué no un LIMIT en la base: el orden por relevancia o por precio y los
// filtros de stock, ofertas y marca salen del precio y el stock que se arman
// acá, con jsmath y el colador de español. Pasarlos a SQL cambiaría el orden
// respecto del que se comparó con el TS.
func (s *Servicio) claves(ctx context.Context, f Filtros, l listaParaConsulta) ([]ProductoListado, error) {
	var condiciones []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	condiciones = append(condiciones, "p.active")
	if f.IDs != nil {
		if len(f.IDs) == 0 {
			return []ProductoListado{}, nil
		}
		condiciones = append(condiciones, "p.id = ANY("+arg(f.IDs)+"::uuid[])")
	}
	if f.Categoria != "" && f.Categoria != "todos" {
		condiciones = append(condiciones, "c.slug = "+arg(f.Categoria))
	}
	if f.Subcategoria != "" && f.Subcategoria != "todos" {
		condiciones = append(condiciones, "s.slug = "+arg(f.Subcategoria))
	}
	// coincideBusqueda: cada palabra tiene que aparecer en alguna columna.
	// f_unaccent y no unaccent: es el envoltorio IMMUTABLE sobre el que están
	// los índices de trigramas (migración 0019); con el otro no se usan.
	if terminos := terminosDeBusqueda(f.Busqueda); len(terminos) > 0 {
		var porTermino []string
		for _, t := range terminos {
			patron := arg("%" + t + "%")
			var col []string
			for _, c := range []string{"p.name", "p.description", "p.subcategory", "p.brand", "c.name"} {
				col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+patron+")")
			}
			porTermino = append(porTermino, "("+strings.Join(col, " OR ")+")")
		}
		condiciones = append(condiciones, "("+strings.Join(porTermino, " AND ")+")")
	}
	filas, err := s.pool.Query(ctx, `
		SELECT p.id, p.slug, p.name, p.subcategory, p.brand, p.unit::text,
		       p.alicuota_iva::text, p.a_pedido, p.forma_de_venta::text, p.precio_media_pct,
		       p.featured, c.slug, c.name, s.slug, s.name
		FROM products p
		JOIN categories c ON c.id = p.category_id
		LEFT JOIN subcategories s ON s.id = p.subcategory_id
		WHERE `+strings.Join(condiciones, " AND ")+`
		ORDER BY c.sort_order, p.name, p.id`, args...)
	if err != nil {
		return nil, err
	}
	listado := []ProductoListado{}
	for filas.Next() {
		var p ProductoListado
		var media jsmath.Num
		if err := filas.Scan(&p.ID, &p.Slug, &p.Name, &p.Subcategory, &p.Brand, &p.Unit,
			&p.AlicuotaIva, &p.APedido, &p.FormaDeVenta, &media, &p.Featured,
			&p.CategorySlug, &p.CategoryName, &p.SubcategorySlug, &p.SubcategoryName); err != nil {
			filas.Close()
			return nil, err
		}
		p.PrecioMediaPct = float64(media)
		listado = append(listado, p)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}
	if len(listado) == 0 {
		return listado, nil
	}
	ids := make([]string, len(listado))
	for i, p := range listado {
		ids[i] = p.ID
	}
	variantes, err := s.variantesConStockYPrecio(ctx, ids, l)
	if err != nil {
		return nil, err
	}
	sucursales, err := s.sucursalesActivas(ctx)
	if err != nil {
		return nil, err
	}
	porProducto := map[string][]*varianteListado{}
	for _, v := range variantes {
		porProducto[v.productID] = append(porProducto[v.productID], v)
	}
	for i := range listado {
		p := &listado[i]
		propias := porProducto[p.ID]
		// El «desde» es la variante más barata, y la oferta que se muestra es
		// la de esa misma variante.
		var barata *struct {
			precio, anterior float64
			hayAnterior      bool
		}
		p.Labels = []string{}
		for _, v := range propias {
			p.Labels = append(p.Labels, v.label)
			precio := 0.0
			if v.precio != nil {
				precio = numero(*v.precio)
			}
			if !(precio > 0) {
				continue
			}
			c := struct {
				precio, anterior float64
				hayAnterior      bool
			}{precio: precio}
			if v.precioAnterior != nil {
				c.anterior, c.hayAnterior = numero(*v.precioAnterior), true
			}
			// reduce((a, b) => b.precio < a.precio ? b : a): ante un empate
			// queda la primera.
			if barata == nil || c.precio < barata.precio {
				barata = &c
			}
		}
		if barata != nil {
			t := jsmath.Texto(barata.precio)
			p.PrecioDesde = &t
			if barata.hayAnterior && barata.anterior > barata.precio {
				a := jsmath.Texto(barata.anterior)
				p.PrecioAnterior = &a
				d := jsmath.Round(float64((1 - barata.precio/barata.anterior) * 100))
				p.Descuento = &d
			}
		}
		// Por sucursal, el mejor nivel entre las variantes.
		p.Stock = stockPorSucursal(sucursales, func(slug string) NivelStock {
			niveles := make([]NivelStock, 0, len(propias))
			for _, v := range propias {
				if n, ok := v.stock[slug]; ok {
					niveles = append(niveles, n)
				}
			}
			return Combinado(niveles)
		})
		p.StockCentral = NivelEn(p.Stock, slugCentral)
		p.StockAserradero = NivelEn(p.Stock, slugAserradero)
		p.HayStock = HayEnAlguna(p.Stock)
	}

	resultado := listado[:0:0]
	marca := strings.ToLower(f.Marca)
	for _, p := range listado {
		switch f.Stock {
		case "", "todos":
		case "en-stock":
			if !p.HayStock {
				continue
			}
		default: // el slug de una sucursal
			if NivelEn(p.Stock, f.Stock) == SinStock {
				continue
			}
		}
		if f.SoloOfertas && p.Descuento == nil {
			continue
		}
		if f.Marca != "" && strings.ToLower(deref(p.Brand)) != marca {
			continue
		}
		resultado = append(resultado, p)
	}
	ordenar(resultado, f)
	return resultado, nil
}

// numero es Number(texto) de JS para los numeric que vienen como texto.
func numero(t string) float64 {
	var n jsmath.Num
	if n.Scan(t) != nil {
		return 0
	}
	return float64(n)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// coladores: un collate.Collator no se puede usar desde dos goroutines a la
// vez (guarda estado de la comparación en curso), y con un solo colador
// compartido, dos pedidos ordenando juntos entraban en pánico. Cada orden toma
// uno del pool y lo devuelve.
var coladores = sync.Pool{New: func() any { return collate.New(language.Spanish) }}

// ordenar es la del TS, con un orden estable como el sort de JS: lo que
// empata conserva el orden de la base.
func ordenar(ps []ProductoListado, f Filtros) {
	colador := coladores.Get().(*collate.Collator)
	defer coladores.Put(colador)
	orden := f.Orden
	if f.sinPrecios && (orden == "precio-asc" || orden == "precio-desc") {
		orden = "nombre"
	}
	switch orden {
	case "precio-asc", "precio-desc":
		signo := 1.0
		if orden == "precio-desc" {
			signo = -1
		}
		sort.SliceStable(ps, func(i, j int) bool {
			a, b := ps[i].PrecioDesde, ps[j].PrecioDesde
			// Lo que no tiene precio va al final en los dos sentidos.
			if a == nil || b == nil {
				return a != nil && b == nil
			}
			return (numero(*a)-numero(*b))*signo < 0
		})
	case "nombre":
		sort.SliceStable(ps, func(i, j int) bool { return colador.CompareString(ps[i].Name, ps[j].Name) < 0 })
	default:
		sort.SliceStable(ps, func(i, j int) bool {
			a, b := ps[i], ps[j]
			if !f.sinStock && a.HayStock != b.HayStock {
				return a.HayStock
			}
			if !f.sinPrecios && (a.Descuento != nil) != (b.Descuento != nil) {
				return a.Descuento != nil
			}
			if a.Featured != b.Featured {
				return a.Featured
			}
			return colador.CompareString(a.Name, b.Name) < 0
		})
	}
}

// hidratar es la segunda fase: la primera foto y la descripción de las
// tarjetas que se van a mostrar. Van a la vez, por dos conexiones del pool.
func (s *Servicio) hidratar(ctx context.Context, ps []ProductoListado) error {
	if len(ps) == 0 {
		return nil
	}
	ids := make([]string, len(ps))
	for i, p := range ps {
		ids[i] = p.ID
	}
	var imagenes, descripciones map[string]string
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { imagenes, err = s.primerasImagenes(gctx, ids); return })
	g.Go(func() (err error) { descripciones, err = s.descripciones(gctx, ids); return })
	if err := g.Wait(); err != nil {
		return err
	}
	for i := range ps {
		p := &ps[i]
		if img, ok := imagenes[p.ID]; ok {
			p.Image = &img
		}
		p.Description = descripciones[p.ID]
	}
	return nil
}

func (s *Servicio) descripciones(ctx context.Context, ids []string) (map[string]string, error) {
	filas, err := s.pool.Query(ctx, `SELECT id::text, description FROM products WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	var id, d string
	_, err = pgx.ForEachRow(filas, []any{&id, &d}, func() error { out[id] = d; return nil })
	return out, err
}

func (s *Servicio) primerasImagenes(ctx context.Context, ids []string) (map[string]string, error) {
	filas, err := s.pool.Query(ctx, `SELECT product_id, url FROM product_images WHERE product_id = ANY($1::uuid[]) ORDER BY sort_order`, ids)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := map[string]string{}
	for filas.Next() {
		var id, url string
		if err := filas.Scan(&id, &url); err != nil {
			return nil, err
		}
		if _, ya := out[id]; !ya {
			out[id] = url
		}
	}
	return out, filas.Err()
}

// Productos es listarProductos (con la lista de quien mira) o
// listarProductosPublicos (con la general), según la lista que se pase:
// filtrados, ordenados, cortados en f.Limite y con sus fotos.
func (s *Servicio) Productos(ctx context.Context, f Filtros, l Lista) ([]ProductoListado, error) {
	ps, err := s.Claves(ctx, f, l)
	if err != nil {
		return nil, err
	}
	return ps, s.hidratar(ctx, ps)
}

// Claves es Productos sin la segunda fase: las tarjetas sin foto ni
// descripción, para quien primero filtra, cuenta o recorta (la página, el
// resumen, la portada) y después hidrata solo lo que va a mostrar.
func (s *Servicio) Claves(ctx context.Context, f Filtros, l Lista) ([]ProductoListado, error) {
	if f.Busqueda != "" {
		f.Busqueda = NormalizarBusqueda(f.Busqueda)
	}
	ps, err := s.claves(ctx, f, l.paraConsulta())
	if err != nil {
		return nil, err
	}
	if f.Limite > 0 && len(ps) > f.Limite {
		ps = ps[:f.Limite]
	}
	return ps, nil
}

// Hidratar completa las fotos y la descripción de unas tarjetas de Claves.
func (s *Servicio) Hidratar(ctx context.Context, ps []ProductoListado) error {
	return s.hidratar(ctx, ps)
}

// Resumen es lo que dicen de un listado el metadata de la categoría, su
// imagen para compartir y el contador de ofertas: cuántos son, desde cuánto
// y una foto. Sale de las claves, sin armar ninguna tarjeta.
type Resumen struct {
	Cantidad int      `json:"cantidad"`
	Desde    *float64 `json:"desde"`
	Imagen   *string  `json:"imagen"`
}

// ResumenDe resume unas claves ya filtradas: el «desde» es el menor precio
// positivo (como el Math.min del metadata), y la foto, la primera que haya
// en el orden del listado.
func (s *Servicio) ResumenDe(ctx context.Context, ps []ProductoListado) (Resumen, error) {
	r := Resumen{Cantidad: len(ps)}
	ids := make([]string, len(ps))
	for i, p := range ps {
		ids[i] = p.ID
		if p.PrecioDesde == nil {
			continue
		}
		if n := numero(*p.PrecioDesde); n > 0 && (r.Desde == nil || n < *r.Desde) {
			r.Desde = &n
		}
	}
	if len(ids) == 0 {
		return r, nil
	}
	imagenes, err := s.primerasImagenes(ctx, ids)
	if err != nil {
		return r, err
	}
	for _, id := range ids {
		if img, ok := imagenes[id]; ok {
			r.Imagen = &img
			break
		}
	}
	return r, nil
}

// Cuántos entran en una página y cuántas páginas se acumulan como máximo
// (POR_PAGINA y TOPE_PAGINAS del TS): el tope evita que ?pagina=9999 arme el
// catálogo entero en una respuesta.
const (
	PorPagina   = 24
	TopePaginas = 5
)

// Pagina es PaginaDeCatalogo.
type Pagina struct {
	Productos     []ProductoListado `json:"productos"`
	Total         int               `json:"total"`
	HayMas        bool              `json:"hayMas"`
	TopeAlcanzado bool              `json:"topeAlcanzado"`
}

// Recortar es recortar del TS.
func Recortar(todos []ProductoListado, pagina int) Pagina {
	acotada := min(max(1, pagina), TopePaginas)
	hasta := acotada * PorPagina
	quedanAfuera := len(todos) > hasta
	return Pagina{
		Productos:     todos[:min(hasta, len(todos))],
		Total:         len(todos),
		HayMas:        quedanAfuera && acotada < TopePaginas,
		TopeAlcanzado: quedanAfuera && acotada >= TopePaginas,
	}
}

// VarianteDetalle es la de la ficha.
type VarianteDetalle struct {
	ID          string  `json:"id"`
	Sku         string  `json:"sku"`
	Label       string  `json:"label"`
	Material    *string `json:"material"`
	Color       *string `json:"color"`
	Terminacion *string `json:"terminacion"`
	Calidad     *string `json:"calidad"`
	LargoMm     *int32  `json:"largoMm"`
	AnchoMm     *int32  `json:"anchoMm"`
	EspesorMm   *int32  `json:"espesorMm"`
	Precio      *string `json:"precio"`
	// Stock es el nivel en cada sucursal activa, como en ProductoListado.
	Stock           []StockDeSucursal `json:"stock"`
	StockCentral    NivelStock        `json:"stockCentral"`
	StockAserradero NivelStock        `json:"stockAserradero"`
	Disponibles     float64           `json:"disponibles"`
}

// ProductoDetalle es la ficha.
type ProductoDetalle struct {
	ID              string   `json:"id"`
	Slug            string   `json:"slug"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	Subcategory     *string  `json:"subcategory"`
	SubcategorySlug *string  `json:"subcategorySlug"`
	SubcategoryName *string  `json:"subcategoryName"`
	Brand           *string  `json:"brand"`
	Unit            string   `json:"unit"`
	AlicuotaIva     string   `json:"alicuotaIva"`
	APedido         bool     `json:"aPedido"`
	FormaDeVenta    string   `json:"formaDeVenta"`
	PrecioMediaPct  float64  `json:"precioMediaPct"`
	Featured        bool     `json:"featured"`
	CategorySlug    string   `json:"categorySlug"`
	CategoryName    string   `json:"categoryName"`
	Imagenes        []string `json:"imagenes"`
	// FotoDeMedida es, por id de medida, la posición en Imagenes de su foto
	// (las de la biblioteca van atadas a su medida, migración 00186): la
	// galería cambia de foto cuando se elige otra medida.
	FotoDeMedida map[string]int    `json:"fotoDeMedida"`
	Variantes    []VarianteDetalle `json:"variantes"`
	Usos         *string           `json:"usos"`
	Cuidados     *string           `json:"cuidados"`
	// Documentos son los técnicos atados al producto o a su categoría
	// (migración 00095). **Solo los públicos**: la ficha se guarda en la
	// caché compartida de Next, y un documento reservado ahí quedaría a la
	// vista de cualquiera. De los reservados va la cantidad.
	Documentos           []DocumentoDeFicha `json:"documentos"`
	DocumentosReservados int                `json:"documentosReservados"`
}

// DocumentoDeFicha es un documento técnico en la ficha del producto.
type DocumentoDeFicha struct {
	ID          string  `json:"id"`
	Titulo      string  `json:"titulo"`
	Descripcion *string `json:"descripcion"`
	URL         string  `json:"url"`
	Formato     string  `json:"formato"`
	TamanoBytes *int32  `json:"tamanoBytes"`
}

// ErrNoExiste es un producto que no está o está dado de baja.
var ErrNoExiste = errors.New("no existe")

// Producto es la ficha para una lista (consultarProducto del TS).
func (s *Servicio) Producto(ctx context.Context, slug string, lista Lista) (*ProductoDetalle, error) {
	l := lista.paraConsulta()
	var p ProductoDetalle
	var media jsmath.Num
	var categoriaID string
	err := s.pool.QueryRow(ctx, `
		SELECT p.id, p.slug, p.name, p.description, p.subcategory, p.brand, p.unit::text,
		       p.alicuota_iva::text, p.a_pedido, p.forma_de_venta::text, p.precio_media_pct,
		       p.featured, c.slug, c.name, s.slug, s.name,
		       nullif(btrim(p.usos), ''), nullif(btrim(p.cuidados), ''), p.category_id::text
		FROM products p
		JOIN categories c ON c.id = p.category_id
		LEFT JOIN subcategories s ON s.id = p.subcategory_id
		WHERE p.slug = $1 AND p.active
		LIMIT 1`, slug).Scan(&p.ID, &p.Slug, &p.Name, &p.Description, &p.Subcategory, &p.Brand, &p.Unit,
		&p.AlicuotaIva, &p.APedido, &p.FormaDeVenta, &media, &p.Featured,
		&p.CategorySlug, &p.CategoryName, &p.SubcategorySlug, &p.SubcategoryName, &p.Usos, &p.Cuidados, &categoriaID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoExiste
	}
	if err != nil {
		return nil, err
	}
	p.PrecioMediaPct = float64(media)
	if err := s.documentosDeFicha(ctx, &p, categoriaID); err != nil {
		return nil, err
	}
	p.Imagenes = []string{}
	p.FotoDeMedida = map[string]int{}
	img, err := s.pool.Query(ctx, `SELECT url, variant_id::text FROM product_images WHERE product_id = $1 ORDER BY sort_order, id`, p.ID)
	if err != nil {
		return nil, err
	}
	for img.Next() {
		var u string
		var medida *string
		if err := img.Scan(&u, &medida); err != nil {
			img.Close()
			return nil, err
		}
		if medida != nil {
			if _, ya := p.FotoDeMedida[*medida]; !ya {
				p.FotoDeMedida[*medida] = len(p.Imagenes)
			}
		}
		p.Imagenes = append(p.Imagenes, u)
	}
	img.Close()
	if err := img.Err(); err != nil {
		return nil, err
	}

	sucursales, err := s.sucursalesActivas(ctx)
	if err != nil {
		return nil, err
	}
	activa := make(map[string]bool, len(sucursales))
	for _, b := range sucursales {
		activa[b.slug] = true
	}
	filas, err := s.pool.Query(ctx, `
		SELECT v.id, v.sku, v.label, v.material, v.color, v.terminacion, v.calidad,
		       v.largo_mm, v.ancho_mm, v.espesor_mm,
		       coalesce(pr.price, round((g.price * $3::numeric)::numeric, 2))::text,
		       b.slug, i.qty, i.reservado, i.min_qty
		FROM product_variants v
		LEFT JOIN price_list_items pr ON pr.variant_id = v.id AND pr.price_list_id = $1::uuid
		LEFT JOIN price_list_items g ON g.variant_id = v.id AND g.price_list_id = $2::uuid
		LEFT JOIN inventory i ON i.variant_id = v.id
		LEFT JOIN branches b ON b.id = i.branch_id
		WHERE v.product_id = $4 AND v.active
		ORDER BY v.sort_order, v.sku, v.id`, l.id, l.generalID, jsmath.Num(l.factor), p.ID)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	p.Variantes = []VarianteDetalle{}
	indice := map[string]int{}
	niveles := map[string]map[string]NivelStock{}
	for filas.Next() {
		var v VarianteDetalle
		var precio, sucursal *string
		var qty, reservado, minQty *jsmath.Num
		if err := filas.Scan(&v.ID, &v.Sku, &v.Label, &v.Material, &v.Color, &v.Terminacion, &v.Calidad,
			&v.LargoMm, &v.AnchoMm, &v.EspesorMm, &precio, &sucursal, &qty, &reservado, &minQty); err != nil {
			return nil, err
		}
		i, ok := indice[v.ID]
		if !ok {
			niveles[v.ID] = map[string]NivelStock{}
			p.Variantes = append(p.Variantes, v)
			i = len(p.Variantes) - 1
			indice[v.ID] = i
		}
		actual := &p.Variantes[i]
		if precio != nil {
			actual.Precio = precio
		}
		if sucursal != nil && activa[*sucursal] && qty != nil && minQty != nil {
			res := 0.0
			if reservado != nil {
				res = float64(*reservado)
			}
			libre := Disponible(float64(*qty), res)
			niveles[actual.ID][*sucursal] = Nivel(libre, float64(*minQty))
			// Suma de las sucursales activas: lo que se puede llevar hoy.
			actual.Disponibles = float64(actual.Disponibles + libre)
		}
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	for i := range p.Variantes {
		v := &p.Variantes[i]
		propios := niveles[v.ID]
		v.Stock = stockPorSucursal(sucursales, func(slug string) NivelStock {
			if n, ok := propios[slug]; ok {
				return n
			}
			return SinStock
		})
		v.StockCentral = NivelEn(v.Stock, slugCentral)
		v.StockAserradero = NivelEn(v.Stock, slugAserradero)
	}
	return &p, nil
}

// PreciosPorVariante es preciosPropiosPorVariante: el precio de cada
// variante para una lista diferenciada; para la general, nada (no hay nada que
// corregir).
func (s *Servicio) PreciosPorVariante(ctx context.Context, lista Lista) (map[string]string, error) {
	out := map[string]string{}
	if !lista.EsDiferenciada {
		return out, nil
	}
	l := lista.paraConsulta()
	filas, err := s.q.PreciosDeVariante(ctx, sqlcPreciosParams(l))
	if err != nil {
		return nil, err
	}
	for _, f := range filas {
		out[f.ID] = f.Precio
	}
	return out, nil
}

func sqlcPreciosParams(l listaParaConsulta) sqlc.PreciosDeVarianteParams {
	return sqlc.PreciosDeVarianteParams{Factor: jsmath.Num(l.factor), Lista: l.id, General: l.generalID}
}

// quitarTildes es normalize("NFD") y sacar las marcas combinantes
// (\u0300-\u036f), como normalizarBusqueda del TS.
func quitarTildes(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		if r >= 0x300 && r <= 0x36f {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// documentosDeFicha trae los documentos públicos del producto y de su
// categoría, sin repetir y en el orden de la biblioteca, y cuenta los
// reservados a profesionales.
func (s *Servicio) documentosDeFicha(ctx context.Context, p *ProductoDetalle, categoriaID string) error {
	p.Documentos = []DocumentoDeFicha{}
	filas, err := s.pool.Query(ctx, `
		SELECT d.id::text, d.titulo, d.descripcion, d.url, d.formato, d.tamano_bytes, d.solo_profesionales
		FROM technical_documents d
		WHERE d.activo AND EXISTS (
			SELECT 1 FROM technical_document_targets t
			WHERE t.document_id = d.id AND (t.product_id = $1 OR t.category_id = $2::uuid))
		ORDER BY d.orden, d.titulo`, p.ID, categoriaID)
	if err != nil {
		return err
	}
	defer filas.Close()
	for filas.Next() {
		var d DocumentoDeFicha
		var reservado bool
		var guardado string
		if err := filas.Scan(&d.ID, &d.Titulo, &d.Descripcion, &guardado, &d.Formato, &d.TamanoBytes, &reservado); err != nil {
			return err
		}
		// La de siempre de la biblioteca (contenido.URLDelDocumento): el
		// archivo se sirve por la API, que decide quién lo puede bajar.
		d.URL = "/api/v1/contenido/documentos/" + d.ID + "/archivo"
		if reservado {
			p.DocumentosReservados++
			continue
		}
		p.Documentos = append(p.Documentos, d)
	}
	return filas.Err()
}
