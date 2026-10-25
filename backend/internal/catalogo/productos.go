package catalogo

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
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
	ID              string     `json:"id"`
	Slug            string     `json:"slug"`
	Name            string     `json:"name"`
	Description     string     `json:"description"`
	Subcategory     *string    `json:"subcategory"`
	SubcategorySlug *string    `json:"subcategorySlug"`
	SubcategoryName *string    `json:"subcategoryName"`
	Brand           *string    `json:"brand"`
	Unit            string     `json:"unit"`
	AlicuotaIva     string     `json:"alicuotaIva"`
	APedido         bool       `json:"aPedido"`
	FormaDeVenta    string     `json:"formaDeVenta"`
	PrecioMediaPct  float64    `json:"precioMediaPct"`
	Featured        bool       `json:"featured"`
	CategorySlug    string     `json:"categorySlug"`
	CategoryName    string     `json:"categoryName"`
	Image           *string    `json:"image"`
	PrecioDesde     *string    `json:"precioDesde"`
	PrecioAnterior  *string    `json:"precioAnterior"`
	Descuento       *float64   `json:"descuento"`
	Labels          []string   `json:"labels"`
	StockCentral    NivelStock `json:"stockCentral"`
	StockAserradero NivelStock `json:"stockAserradero"`
	HayStock        bool       `json:"hayStock"`
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
	productID       string
	label           string
	precio          *string
	precioAnterior  *string
	stockCentral    NivelStock
	stockAserradero NivelStock
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
		ORDER BY v.sort_order`,
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
			v = &varianteListado{productID: productID, label: label, precio: precio, stockCentral: SinStock, stockAserradero: SinStock}
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
			nivel := Nivel(Disponible(float64(*qty), res), float64(*minQty))
			switch *sucursal {
			case "casa-central":
				v.stockCentral = nivel
			case "aserradero":
				v.stockAserradero = nivel
			}
		}
	}
	return orden, filas.Err()
}

// consultarProductos es la del TS: filtra en la base lo que se puede, y en Go
// lo que depende del precio y del stock ya armados (disponibilidad, ofertas,
// marca), y ordena.
func (s *Servicio) consultarProductos(ctx context.Context, f Filtros, l listaParaConsulta) ([]ProductoListado, error) {
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
		SELECT p.id, p.slug, p.name, p.description, p.subcategory, p.brand, p.unit::text,
		       p.alicuota_iva::text, p.a_pedido, p.forma_de_venta::text, p.precio_media_pct,
		       p.featured, c.slug, c.name, s.slug, s.name
		FROM products p
		JOIN categories c ON c.id = p.category_id
		LEFT JOIN subcategories s ON s.id = p.subcategory_id
		WHERE `+strings.Join(condiciones, " AND ")+`
		ORDER BY c.sort_order, p.name`, args...)
	if err != nil {
		return nil, err
	}
	listado := []ProductoListado{}
	for filas.Next() {
		var p ProductoListado
		var media jsmath.Num
		if err := filas.Scan(&p.ID, &p.Slug, &p.Name, &p.Description, &p.Subcategory, &p.Brand, &p.Unit,
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
	imagenes, err := s.primerasImagenes(ctx, ids)
	if err != nil {
		return nil, err
	}
	variantes, err := s.variantesConStockYPrecio(ctx, ids, l)
	if err != nil {
		return nil, err
	}
	porProducto := map[string][]*varianteListado{}
	for _, v := range variantes {
		porProducto[v.productID] = append(porProducto[v.productID], v)
	}
	for i := range listado {
		p := &listado[i]
		if img, ok := imagenes[p.ID]; ok {
			p.Image = &img
		}
		propias := porProducto[p.ID]
		// El «desde» es la variante más barata, y la oferta que se muestra es
		// la de esa misma variante.
		var barata *struct {
			precio, anterior float64
			hayAnterior      bool
		}
		var niveles struct{ central, aserradero []NivelStock }
		p.Labels = []string{}
		for _, v := range propias {
			p.Labels = append(p.Labels, v.label)
			niveles.central = append(niveles.central, v.stockCentral)
			niveles.aserradero = append(niveles.aserradero, v.stockAserradero)
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
		p.StockCentral = Combinado(niveles.central)
		p.StockAserradero = Combinado(niveles.aserradero)
		p.HayStock = p.StockCentral != SinStock || p.StockAserradero != SinStock
	}

	resultado := listado[:0:0]
	marca := strings.ToLower(f.Marca)
	for _, p := range listado {
		switch f.Stock {
		case "casa-central":
			if p.StockCentral == SinStock {
				continue
			}
		case "aserradero":
			if p.StockAserradero == SinStock {
				continue
			}
		case "", "todos":
		default: // en-stock
			if !p.HayStock {
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
	ordenar(resultado, f.Orden)
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

var colador = collate.New(language.Spanish)

// ordenar es la del TS, con un orden estable como el sort de JS: lo que
// empata conserva el orden de la base.
func ordenar(ps []ProductoListado, orden string) {
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
			if a.HayStock != b.HayStock {
				return a.HayStock
			}
			if (a.Descuento != nil) != (b.Descuento != nil) {
				return a.Descuento != nil
			}
			if a.Featured != b.Featured {
				return a.Featured
			}
			return colador.CompareString(a.Name, b.Name) < 0
		})
	}
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
// listarProductosPublicos (con la general), según la lista que se pase.
func (s *Servicio) Productos(ctx context.Context, f Filtros, l Lista) ([]ProductoListado, error) {
	if f.Busqueda != "" {
		f.Busqueda = NormalizarBusqueda(f.Busqueda)
	}
	return s.consultarProductos(ctx, f, l.paraConsulta())
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
	ID              string     `json:"id"`
	Sku             string     `json:"sku"`
	Label           string     `json:"label"`
	Material        *string    `json:"material"`
	Color           *string    `json:"color"`
	Terminacion     *string    `json:"terminacion"`
	Calidad         *string    `json:"calidad"`
	LargoMm         *int32     `json:"largoMm"`
	AnchoMm         *int32     `json:"anchoMm"`
	EspesorMm       *int32     `json:"espesorMm"`
	Precio          *string    `json:"precio"`
	StockCentral    NivelStock `json:"stockCentral"`
	StockAserradero NivelStock `json:"stockAserradero"`
	Disponibles     float64    `json:"disponibles"`
}

// ProductoDetalle es la ficha.
type ProductoDetalle struct {
	ID              string            `json:"id"`
	Slug            string            `json:"slug"`
	Name            string            `json:"name"`
	Description     string            `json:"description"`
	Subcategory     *string           `json:"subcategory"`
	SubcategorySlug *string           `json:"subcategorySlug"`
	SubcategoryName *string           `json:"subcategoryName"`
	Brand           *string           `json:"brand"`
	Unit            string            `json:"unit"`
	AlicuotaIva     string            `json:"alicuotaIva"`
	APedido         bool              `json:"aPedido"`
	FormaDeVenta    string            `json:"formaDeVenta"`
	PrecioMediaPct  float64           `json:"precioMediaPct"`
	Featured        bool              `json:"featured"`
	CategorySlug    string            `json:"categorySlug"`
	CategoryName    string            `json:"categoryName"`
	Imagenes        []string          `json:"imagenes"`
	Variantes       []VarianteDetalle `json:"variantes"`
}

// ErrNoExiste es un producto que no está o está dado de baja.
var ErrNoExiste = errors.New("no existe")

// Producto es la ficha para una lista (consultarProducto del TS).
func (s *Servicio) Producto(ctx context.Context, slug string, lista Lista) (*ProductoDetalle, error) {
	l := lista.paraConsulta()
	var p ProductoDetalle
	var media jsmath.Num
	err := s.pool.QueryRow(ctx, `
		SELECT p.id, p.slug, p.name, p.description, p.subcategory, p.brand, p.unit::text,
		       p.alicuota_iva::text, p.a_pedido, p.forma_de_venta::text, p.precio_media_pct,
		       p.featured, c.slug, c.name, s.slug, s.name
		FROM products p
		JOIN categories c ON c.id = p.category_id
		LEFT JOIN subcategories s ON s.id = p.subcategory_id
		WHERE p.slug = $1 AND p.active
		LIMIT 1`, slug).Scan(&p.ID, &p.Slug, &p.Name, &p.Description, &p.Subcategory, &p.Brand, &p.Unit,
		&p.AlicuotaIva, &p.APedido, &p.FormaDeVenta, &media, &p.Featured,
		&p.CategorySlug, &p.CategoryName, &p.SubcategorySlug, &p.SubcategoryName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoExiste
	}
	if err != nil {
		return nil, err
	}
	p.PrecioMediaPct = float64(media)
	p.Imagenes = []string{}
	img, err := s.pool.Query(ctx, `SELECT url FROM product_images WHERE product_id = $1 ORDER BY sort_order`, p.ID)
	if err != nil {
		return nil, err
	}
	for img.Next() {
		var u string
		if err := img.Scan(&u); err != nil {
			img.Close()
			return nil, err
		}
		p.Imagenes = append(p.Imagenes, u)
	}
	img.Close()

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
		ORDER BY v.sort_order`, l.id, l.generalID, jsmath.Num(l.factor), p.ID)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	p.Variantes = []VarianteDetalle{}
	indice := map[string]int{}
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
			v.StockCentral, v.StockAserradero = SinStock, SinStock
			p.Variantes = append(p.Variantes, v)
			i = len(p.Variantes) - 1
			indice[v.ID] = i
		}
		actual := &p.Variantes[i]
		if precio != nil {
			actual.Precio = precio
		}
		if sucursal != nil && qty != nil && minQty != nil {
			res := 0.0
			if reservado != nil {
				res = float64(*reservado)
			}
			libre := Disponible(float64(*qty), res)
			nivel := Nivel(libre, float64(*minQty))
			switch *sucursal {
			case "casa-central":
				actual.StockCentral = nivel
			case "aserradero":
				actual.StockAserradero = nivel
			}
			// Suma de las dos sucursales: lo que se puede llevar hoy.
			actual.Disponibles = float64(actual.Disponibles + libre)
		}
	}
	return &p, filas.Err()
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
