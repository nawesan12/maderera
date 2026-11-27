package productos

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/formato"
	"mjbj/internal/fotos"
	"mjbj/internal/jsmath"
	"mjbj/internal/listado"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
	"mjbj/internal/subidas"
)

// Servicio es la gestión de productos.
type Servicio struct {
	fotos *fotos.Biblioteca
	pool  *pgxpool.Pool
	q     *sqlc.Queries
	disco *subidas.Disco
	log   *slog.Logger
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, disco *subidas.Disco, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), disco: disco, log: log}
}

// ConFotos le da la biblioteca de fotos por código: una medida nueva con un
// código de la biblioteca se lleva su foto.
func (s *Servicio) ConFotos(b *fotos.Biblioteca) *Servicio {
	s.fotos = b
	return s
}

// --- el listado ---

// ProductoAdmin es una fila del listado del panel.
type ProductoAdmin struct {
	ID           string  `json:"id"`
	Slug         string  `json:"slug"`
	Name         string  `json:"name"`
	CategoryName string  `json:"categoryName"`
	Brand        *string `json:"brand"`
	Unit         string  `json:"unit"`
	Featured     bool    `json:"featured"`
	Active       bool    `json:"active"`
	Variantes    int     `json:"variantes"`
	StockTotal   float64 `json:"stockTotal"`
	Imagen       *string `json:"imagen"`
	// El precio más bajo de la lista general, para el «desde»: String(n).
	PrecioDesde *string `json:"precioDesde"`
	SinFoto     bool    `json:"sinFoto"`
}

// ConteosDeProductos son los totales de cada estado con los mismos filtros,
// para los botones de arriba de la lista.
type ConteosDeProductos struct {
	Todos     int `json:"todos"`
	SinFoto   int `json:"sinFoto"`
	SinPrecio int `json:"sinPrecio"`
	SinStock  int `json:"sinStock"`
	Ocultos   int `json:"ocultos"`
}

// ListaDeProductos es una página del listado, con el total del filtro.
type ListaDeProductos struct {
	Filas   []ProductoAdmin    `json:"filas"`
	Total   int                `json:"total"`
	Conteos ConteosDeProductos `json:"conteos"`
}

// PorPaginaProductos: múltiplo de 2, 3 y 4, las columnas de la grilla.
const PorPaginaProductos = 36

// Las expresiones de cada estado, sobre `p`. Sin foto, sin precio y sin
// stock miran solo lo publicado: lo oculto ya tiene su propio botón y no
// tiene sentido apurarse a completarlo.
const (
	conFoto   = `EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)`
	conPrecio = `EXISTS (SELECT 1 FROM product_variants v
		JOIN price_list_items pli ON pli.variant_id = v.id
		JOIN price_lists pl ON pl.id = pli.price_list_id AND pl.is_default
		WHERE v.product_id = p.id AND pli.price > 0)`
	// Las sucursales activas, como la pantalla de Stock: si no, «sin stock»
	// contaba distinto en una y otra.
	stockDelProducto = `coalesce((SELECT sum(i.qty) FROM product_variants v JOIN inventory i ON i.variant_id = v.id JOIN branches b ON b.id = i.branch_id AND b.active WHERE v.product_id = p.id), 0)`
)

var estadosDeProducto = map[string]string{
	"sin-foto":   "p.active AND NOT " + conFoto,
	"sin-precio": "p.active AND NOT " + conPrecio,
	"sin-stock":  "p.active AND " + stockDelProducto + " = 0",
	"ocultos":    "NOT p.active",
}

// Listar es listarProductosAdmin, de a páginas: todos (también los dados de
// baja), los últimos tocados primero. La búsqueda es por palabra (todas
// tienen que aparecer) en nombre, marca, rubro o categoría, sin tildes.
func (s *Servicio) Listar(ctx context.Context, f listado.Filtros) (ListaDeProductos, error) {
	out := ListaDeProductos{Filas: []ProductoAdmin{}}
	var c listado.Consulta
	c.Comunes(f, "")
	c.Busqueda(f.Busqueda, []string{"p.name", "p.brand", "p.subcategory", "c.name"})
	desde := ` FROM products p JOIN categories c ON c.id = p.category_id `
	conteo := `SELECT count(*)`
	for _, e := range []string{"sin-foto", "sin-precio", "sin-stock", "ocultos"} {
		conteo += `, count(*) FILTER (WHERE ` + estadosDeProducto[e] + `)`
	}
	k := &out.Conteos
	if err := s.pool.QueryRow(ctx, conteo+desde+c.Donde(), c.Args()...).Scan(&k.Todos, &k.SinFoto, &k.SinPrecio, &k.SinStock, &k.Ocultos); err != nil {
		return out, err
	}
	out.Total = map[string]int{"sin-foto": k.SinFoto, "sin-precio": k.SinPrecio, "sin-stock": k.SinStock, "ocultos": k.Ocultos}[f.Estado]
	if cond, ok := estadosDeProducto[f.Estado]; ok {
		c.Y(cond)
	} else {
		out.Total = k.Todos
	}
	limite, salto := f.Pagina(PorPaginaProductos)
	filas, err := s.pool.Query(ctx, `
		SELECT p.id, p.slug, p.name, c.name, p.brand, p.unit::text, p.featured, p.active,
		  (SELECT count(*) FROM product_variants v WHERE v.product_id = p.id)::int,
		  `+stockDelProducto+`::float8,
		  (SELECT i.url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order LIMIT 1),
		  (SELECT min(pli.price) FROM product_variants v
		     JOIN price_list_items pli ON pli.variant_id = v.id
		     JOIN price_lists pl ON pl.id = pli.price_list_id AND pl.is_default
		   WHERE v.product_id = p.id AND pli.price > 0)::float8
		`+desde+c.Donde()+`
		ORDER BY p.updated_at DESC, p.id
		LIMIT `+c.Arg(limite)+` OFFSET `+c.Arg(salto), c.Args()...)
	if err != nil {
		return out, err
	}
	out.Filas, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (ProductoAdmin, error) {
		var p ProductoAdmin
		var precio *float64
		err := r.Scan(&p.ID, &p.Slug, &p.Name, &p.CategoryName, &p.Brand, &p.Unit, &p.Featured, &p.Active,
			&p.Variantes, &p.StockTotal, &p.Imagen, &precio)
		if precio != nil {
			t := jsmath.Texto(*precio)
			p.PrecioDesde = &t
		}
		p.SinFoto = p.Imagen == nil
		return p, err
	})
	if out.Filas == nil {
		out.Filas = []ProductoAdmin{}
	}
	return out, err
}

// Marcas son las marcas cargadas, una vez cada una aunque cambie la
// mayúscula, para el filtro de los listados.
func (s *Servicio) Marcas(ctx context.Context) ([]string, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT min(trim(brand)) FROM products
		WHERE brand IS NOT NULL AND trim(brand) <> ''
		GROUP BY lower(trim(brand)) ORDER BY lower(trim(brand))`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowTo[string])
}

// --- la ficha ---

// Ficha es obtenerProductoAdmin: el producto con las formas de drizzle, su
// galería y sus medidas con los precios de las dos listas y el stock de las
// dos sucursales.
type Ficha struct {
	ID                    string            `json:"id"`
	Slug                  string            `json:"slug"`
	Name                  string            `json:"name"`
	CategoryID            string            `json:"categoryId"`
	Subcategory           *string           `json:"subcategory"`
	Description           string            `json:"description"`
	Brand                 *string           `json:"brand"`
	Unit                  string            `json:"unit"`
	Featured              bool              `json:"featured"`
	Active                bool              `json:"active"`
	CreatedAt             time.Time         `json:"createdAt"`
	UpdatedAt             time.Time         `json:"updatedAt"`
	AlicuotaIva           string            `json:"alicuotaIva"`
	APedido               bool              `json:"aPedido"`
	SubcategoryID         *string           `json:"subcategoryId"`
	RecargoElaboracionPct *string           `json:"recargoElaboracionPct"`
	Imputacion            *string           `json:"imputacion"`
	Usos                  *string           `json:"usos"`
	Cuidados              *string           `json:"cuidados"`
	FormaDeVenta          string            `json:"formaDeVenta"`
	PrecioMediaPct        float64           `json:"precioMediaPct"`
	Imagen                string            `json:"imagen"`
	Galeria               []ImagenDeGaleria `json:"galeria"`
	Variantes             []VarianteDeFicha `json:"variantes"`
	Sucursales            []SucursalDeFicha `json:"sucursales"`
}

// ImagenDeGaleria es una foto del producto.
type ImagenDeGaleria struct {
	ID  string  `json:"id"`
	URL string  `json:"url"`
	Alt *string `json:"alt"`
}

// VarianteDeFicha es una medida en la ficha.
type VarianteDeFicha struct {
	ID                string `json:"id"`
	SKU               string `json:"sku"`
	Label             string `json:"label"`
	LargoMm           *int32 `json:"largoMm"`
	AnchoMm           *int32 `json:"anchoMm"`
	EspesorMm         *int32 `json:"espesorMm"`
	Material          string `json:"material"`
	Color             string `json:"color"`
	Terminacion       string `json:"terminacion"`
	Calidad           string `json:"calidad"`
	CodigoBarras      string `json:"codigoBarras"`
	PrecioGeneral     string `json:"precioGeneral"`
	PrecioProfesional string `json:"precioProfesional"`
	// Stocks: uno por sucursal activa, en el orden de Ficha.Sucursales.
	Stocks []StockDeFicha `json:"stocks"`
}

// StockDeFicha es el stock de una medida en una sucursal.
type StockDeFicha struct {
	Sucursal string  `json:"sucursal"`
	Stock    float64 `json:"stock"`
	Minimo   float64 `json:"minimo"`
}

// StockEn es el de la sucursal con ese id, o cero.
func (v VarianteDeFicha) StockEn(sucursal string) StockDeFicha {
	for _, st := range v.Stocks {
		if st.Sucursal == sucursal {
			return st
		}
	}
	return StockDeFicha{Sucursal: sucursal}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// SucursalDeFicha es una sucursal activa: una columna de stock en la ficha.
type SucursalDeFicha struct {
	ID     string `json:"id"`
	Slug   string `json:"slug"`
	Nombre string `json:"nombre"`
}

// listasYSucursales: la general, la profesional (por slug) y las sucursales
// de la base. Eran dos sucursales escritas acá; una tercera no aparecía en la
// ficha y su stock no se podía cargar.
type listasYSucursales struct {
	general, profesional *string
	sucursales           []sqlc.SucursalesDeLaFichaRow
}

// activas son las sucursales que muestra la ficha, por orden.
func (l listasYSucursales) activas() []SucursalDeFicha {
	out := []SucursalDeFicha{}
	for _, b := range l.sucursales {
		if b.Active {
			out = append(out, SucursalDeFicha{b.ID, b.Slug, b.Name})
		}
	}
	return out
}

// sucursal busca la de un stock: por id, o por slug en el formato viejo.
func (l listasYSucursales) sucursal(st StockDeSucursal) *string {
	for i, b := range l.sucursales {
		// Solo en una activa: en una dada de baja el stock quedaría donde la
		// grilla no lo muestra ni el total lo suma.
		if !b.Active {
			continue
		}
		if st.Sucursal != "" && b.ID == st.Sucursal || st.Sucursal == "" && b.Slug == st.Slug {
			return &l.sucursales[i].ID
		}
	}
	return nil
}

func (s *Servicio) listasYSucursales(ctx context.Context, q *sqlc.Queries) (listasYSucursales, error) {
	var r listasYSucursales
	listas, err := q.ListasDePrecios(ctx)
	if err != nil {
		return r, err
	}
	for _, l := range listas {
		if l.IsDefault && r.general == nil {
			r.general = &l.ID
		}
		if l.Slug == "profesional" && r.profesional == nil {
			r.profesional = &l.ID
		}
	}
	r.sucursales, err = q.SucursalesDeLaFicha(ctx)
	return r, err
}

// ErrNoExiste es un producto que no está.
var ErrNoExiste = errors.New("el producto no existe")

// Ficha devuelve el producto para editarlo.
func (s *Servicio) Ficha(ctx context.Context, id string) (*Ficha, error) {
	p, err := s.q.ProductoPorID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoExiste
	}
	if err != nil {
		return nil, err
	}
	f := &Ficha{
		ID: p.ID, Slug: p.Slug, Name: p.Name, CategoryID: p.CategoryID, Subcategory: p.Subcategory,
		Description: p.Description, Brand: p.Brand, Unit: p.Unit, Featured: p.Featured, Active: p.Active,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt, AlicuotaIva: p.AlicuotaIva, APedido: p.APedido,
		SubcategoryID: p.SubcategoryID, Imputacion: p.Imputacion, FormaDeVenta: p.FormaDeVenta,
		PrecioMediaPct: float64(p.PrecioMediaPct), Galeria: []ImagenDeGaleria{}, Variantes: []VarianteDeFicha{},
	}
	if p.RecargoElaboracionPct != nil {
		t := strconv.FormatFloat(float64(*p.RecargoElaboracionPct), 'f', 2, 64)
		f.RecargoElaboracionPct = &t
	}
	if err := s.pool.QueryRow(ctx, `SELECT usos, cuidados FROM products WHERE id = $1`, id).Scan(&f.Usos, &f.Cuidados); err != nil {
		return nil, err
	}
	imgs, err := s.q.ImagenesDelProducto(ctx, id)
	if err != nil {
		return nil, err
	}
	for _, i := range imgs {
		f.Galeria = append(f.Galeria, ImagenDeGaleria{i.ID, i.Url, i.Alt})
	}
	if len(imgs) > 0 {
		f.Imagen = imgs[0].Url
	}
	vs, err := s.q.VariantesDelProducto(ctx, id)
	if err != nil {
		return nil, err
	}
	ls, err := s.listasYSucursales(ctx, s.q)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(vs))
	for i, v := range vs {
		ids[i] = v.ID
	}
	precios, err := s.q.PreciosDeVariantes(ctx, ids)
	if err != nil {
		return nil, err
	}
	stock, err := s.q.StockDeVariantes(ctx, ids)
	if err != nil {
		return nil, err
	}
	precio := func(v string, lista *string) string {
		for _, p := range precios {
			if lista != nil && p.VariantID == v && p.PriceListID == *lista {
				return p.Price
			}
		}
		return "0"
	}
	cantidad := func(v string, suc *string, minimo bool) float64 {
		for _, st := range stock {
			if suc != nil && st.VariantID == v && st.BranchID == *suc {
				if minimo {
					return float64(st.MinQty)
				}
				return float64(st.Qty)
			}
		}
		return 0
	}
	f.Sucursales = ls.activas()
	stocks := func(v string) []StockDeFicha {
		out := make([]StockDeFicha, len(f.Sucursales))
		for i, b := range f.Sucursales {
			out[i] = StockDeFicha{Sucursal: b.ID, Stock: cantidad(v, &b.ID, false), Minimo: cantidad(v, &b.ID, true)}
		}
		return out
	}
	for _, v := range vs {
		f.Variantes = append(f.Variantes, VarianteDeFicha{
			ID: v.ID, SKU: v.Sku, Label: v.Label, LargoMm: v.LargoMm, AnchoMm: v.AnchoMm, EspesorMm: v.EspesorMm,
			Material: deref(v.Material), Color: deref(v.Color), Terminacion: deref(v.Terminacion), Calidad: deref(v.Calidad),
			CodigoBarras: deref(v.CodigoBarras), PrecioGeneral: precio(v.ID, ls.general), PrecioProfesional: precio(v.ID, ls.profesional),
			Stocks: stocks(v.ID),
		})
	}
	return f, nil
}

// --- guardar la ficha ---

func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func mm(v *float64) *int32 {
	if v == nil {
		return nil
	}
	n := int32(math.Round(*v))
	return &n
}

// StockNuevo es el físico que deja la ficha, leído con el candado tomado.
//
// **Arreglado** (auditoría del 30/10): la ficha pisaba el físico con el
// número que traía, aunque fuera el de hace diez minutos: una venta hecha
// mientras tanto se perdía al guardar un cambio de precio, y un campo vacío
// ponía el físico en 0. Ahora:
//   - campo vacío: el físico no se toca;
//   - con lo que la pantalla vio al abrir: si no cambió, no se toca; si
//     cambió, se aplica la diferencia (10 → 12 son dos más, aunque entre
//     tanto se hayan vendido tres);
//   - sin lo visto (un alta, o quien no lo manda): el valor tal cual, como
//     siempre.
func StockNuevo(anterior float64, cantidad, visto *float64) float64 {
	switch {
	case cantidad == nil:
		return anterior
	case visto == nil:
		return *cantidad
	case *cantidad == *visto:
		return anterior
	default:
		return jsmath.Round(float64(anterior+(*cantidad-*visto))*1000) / 1000
	}
}

func valor(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}

// slugLibre: si el slug ya lo tiene otro producto, al editar es un error y
// al crear se le busca un sufijo (-2 … -10), como el TS.
func (s *Servicio) slugLibre(ctx context.Context, p Producto) (string, error) {
	choque, err := s.q.SlugOcupado(ctx, p.Slug)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && choque == p.ID) {
		return p.Slug, nil
	}
	if err != nil {
		return "", err
	}
	if p.ID != "" {
		return "", &ErrorDeCampo{"Ya hay otro producto con ese nombre en la misma dirección web.", "name"}
	}
	for sufijo := 2; sufijo <= 10; sufijo++ {
		candidato := p.Slug + "-" + strconv.Itoa(sufijo)
		if _, err := s.q.SlugOcupado(ctx, candidato); errors.Is(err, pgx.ErrNoRows) {
			return candidato, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", &ErrorDeCampo{"Ya hay demasiados productos con ese mismo nombre. Revisá si no está duplicado.", "name"}
}

// Guardar crea o edita la ficha entera en una transacción: el producto, sus
// medidas (las que no vinieron se desactivan, no se borran: tienen ventas),
// los precios de las dos listas y el stock de las dos sucursales, con un
// movimiento de ajuste por cada cantidad que cambió.
//
// El stock se toca con el candado de lib/inventario/locks.ts (el TS de la
// ficha no lo tomaba: una venta y una edición podían pisarse).
func (s *Servicio) Guardar(ctx context.Context, ses *auth.Sesion, f FormProducto) (string, error) {
	p, e := Validar(f)
	if e != nil {
		return "", e
	}
	slug, err := s.slugLibre(ctx, p)
	if err != nil {
		return "", err
	}
	p.Slug = slug
	forma := p.FormaDeVenta
	if p.Unit != "placa" {
		forma = "entera"
	}
	var recargo *jsmath.Num
	if p.RecargoElaboracionPct != nil && *p.RecargoElaboracionPct > 0 {
		r := jsmath.Num(*p.RecargoElaboracionPct)
		recargo = &r
	}
	id := p.ID
	var nuevas []fotos.Medida
	var preciosCambiados []string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		nuevas, preciosCambiados = nil, nil
		q := s.q.WithTx(tx)
		ls, err := s.listasYSucursales(ctx, q)
		if err != nil {
			return err
		}
		if id != "" {
			err = q.EditarProducto(ctx, sqlc.EditarProductoParams{
				ID: id, Name: p.Name, Slug: p.Slug, CategoryID: p.CategoryID, Subcategory: p.Subcategory,
				SubcategoryID: p.SubcategoryID, Description: p.Description, Brand: p.Brand, Unit: sqlc.UnitOfSale(p.Unit),
				FormaDeVenta: sqlc.FormaDeVenta(forma), PrecioMediaPct: jsmath.Num(p.PrecioMediaPct),
				AlicuotaIva: jsmath.Num(jsmath.Numero(p.AlicuotaIva)), Imputacion: p.Imputacion,
				RecargoElaboracionPct: recargo, Featured: p.Featured, APedido: p.APedido, Active: p.Active,
			})
		} else {
			id, err = q.CrearProducto(ctx, sqlc.CrearProductoParams{
				Name: p.Name, Slug: p.Slug, CategoryID: p.CategoryID, Subcategory: p.Subcategory,
				SubcategoryID: p.SubcategoryID, Description: p.Description, Brand: p.Brand, Unit: sqlc.UnitOfSale(p.Unit),
				FormaDeVenta: sqlc.FormaDeVenta(forma), PrecioMediaPct: jsmath.Num(p.PrecioMediaPct),
				AlicuotaIva: jsmath.Num(jsmath.Numero(p.AlicuotaIva)), Imputacion: p.Imputacion,
				RecargoElaboracionPct: recargo, Featured: p.Featured, APedido: p.APedido, Active: p.Active,
			})
			if err == nil && p.Imagen != "" {
				err = q.AgregarImagenInicial(ctx, sqlc.AgregarImagenInicialParams{ProductID: id, Url: p.Imagen, Alt: &p.Name})
			}
		}
		if err != nil {
			return err
		}
		// Fuera de sqlc a propósito: son dos columnas de texto que solo
		// escribe esta pantalla (migración 00095).
		if _, err := tx.Exec(ctx, `UPDATE products SET usos = $2, cuidados = $3 WHERE id = $1`, id, p.Usos, p.Cuidados); err != nil {
			return err
		}
		existentes, err := q.IDsDeVariantes(ctx, id)
		if err != nil {
			return err
		}
		var enviados, desactivar []string
		for _, v := range p.Variantes {
			if v.ID != "" {
				enviados = append(enviados, v.ID)
			}
		}
		for _, e := range existentes {
			if !slices.Contains(enviados, e) {
				desactivar = append(desactivar, e)
			}
		}
		if len(desactivar) > 0 {
			if err := q.DesactivarVariantes(ctx, desactivar); err != nil {
				return err
			}
		}
		for orden, v := range p.Variantes {
			vid := v.ID
			if vid != "" {
				err = q.EditarVariante(ctx, sqlc.EditarVarianteParams{
					ID: vid, ProductID: id, Sku: v.SKU, Label: v.Label, LargoMm: mm(v.LargoMm), AnchoMm: mm(v.AnchoMm),
					EspesorMm: mm(v.EspesorMm), Material: nulo(v.Material), Color: nulo(v.Color),
					Terminacion: nulo(v.Terminacion), Calidad: nulo(v.Calidad), SortOrder: int32(orden),
				})
			} else {
				vid, err = q.CrearVariante(ctx, sqlc.CrearVarianteParams{
					ProductID: id, Sku: v.SKU, Label: v.Label, LargoMm: mm(v.LargoMm), AnchoMm: mm(v.AnchoMm),
					EspesorMm: mm(v.EspesorMm), Material: nulo(v.Material), Color: nulo(v.Color),
					Terminacion: nulo(v.Terminacion), Calidad: nulo(v.Calidad), SortOrder: int32(orden),
				})
				if err == nil {
					nuevas = append(nuevas, fotos.Medida{ProductoID: id, Codigo: v.SKU})
				}
			}
			if err != nil {
				// El código ya es de una medida de otro producto: se dice de
				// cuál, en vez de un error sin explicación.
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "product_variants_sku_idx" {
					var duenio string
					_ = s.pool.QueryRow(ctx, `SELECT p.name FROM product_variants v JOIN products p ON p.id = v.product_id
						WHERE lower(v.sku) = lower($1) LIMIT 1`, v.SKU).Scan(&duenio)
					msj := "El código " + v.SKU + " ya es de otra medida."
					if duenio != "" {
						msj = "El código " + v.SKU + " ya es de " + duenio + "."
					}
					return &ErrorDeCampo{msj, "variantes." + strconv.Itoa(orden) + ".sku"}
				}
				return err
			}
			// El código de barras, fuera de sqlc como usos y cuidados: lo
			// escribe esta pantalla y el importador (migración 00100).
			if _, err := tx.Exec(ctx, `UPDATE product_variants SET codigo_barras = $2 WHERE id = $1`, vid, nulo(v.CodigoBarras)); err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == "23505" {
					return &ErrorDeCampo{"El código de barras " + v.CodigoBarras + " ya es de otra medida.",
						"variantes." + strconv.Itoa(orden) + ".codigoBarras"}
				}
				return err
			}
			for _, lp := range []struct {
				lista  *string
				precio string
				nombre string
			}{{ls.general, v.PrecioGeneral, "general"}, {ls.profesional, v.PrecioProfesional, "profesional"}} {
				if lp.lista == nil {
					continue
				}
				// El precio que cambia queda en la bitácora con el de antes y el
				// nuevo, como en el ajuste masivo (mes simulado, M2S1-047): la
				// edición de un precio salía «Editó el producto», sin montos.
				var antes *string
				_ = tx.QueryRow(ctx, `SELECT price::text FROM price_list_items WHERE price_list_id = $1 AND variant_id = $2`, *lp.lista, vid).Scan(&antes)
				nuevo := jsmath.Numero(lp.precio)
				previo := 0.0
				if antes != nil {
					previo = jsmath.Numero(*antes)
				}
				if (nuevo > 0 || previo > 0) && math.Abs(nuevo-previo) > 0.005 {
					cual := v.SKU
					if cual == "" {
						cual = v.Label
					}
					texto := "Precio " + lp.nombre + " de " + cual + ": " + formato.Importe(max(previo, 0)) + " → " + formato.Importe(max(nuevo, 0))
					preciosCambiados = append(preciosCambiados, texto)
				}
				// Sin precio profesional propio, la medida sigue el porcentaje
				// de la lista sobre la general. Guardar un 0 le ganaba al
				// porcentaje y el profesional veía la medida a $0.
				//
				// Y sin precio general, la medida queda sin precio en vez de a
				// $0: con la lista en 0, vender a $0 no se medía como bajo la
				// lista (comité final, M11 y decisión 4; la tabla de Precios ya
				// lo rechaza, la ficha guardaba el «0» del campo vacío).
				if jsmath.Numero(lp.precio) <= 0 {
					if err := q.QuitarPrecio(ctx, sqlc.QuitarPrecioParams{PriceListID: *lp.lista, VariantID: vid}); err != nil {
						return err
					}
					continue
				}
				if err := q.GuardarPrecio(ctx, sqlc.GuardarPrecioParams{PriceListID: *lp.lista, VariantID: vid, Price: lp.precio}); err != nil {
					return err
				}
			}
			for _, x := range v.Stocks {
				st := struct {
					suc             *string
					cantidad, visto *float64
					minimo          float64
				}{ls.sucursal(x), x.Stock, x.Visto, valor(x.Minimo)}
				if st.suc == nil {
					// Por id, una sucursal que no está es un error de quien
					// manda; por slug (formato viejo), se saltea como antes.
					if x.Sucursal != "" {
						return &ErrorDeCampo{"No se encontró la sucursal.", x.CampoSucursal}
					}
					continue
				}
				if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: vid, Sucursal: *st.suc}); err != nil {
					return err
				}
				anterior := 0.0
				if a, err := q.StockDe(ctx, sqlc.StockDeParams{VariantID: vid, BranchID: *st.suc}); err == nil {
					anterior = float64(a)
				} else if !errors.Is(err, pgx.ErrNoRows) {
					return err
				}
				nuevo := StockNuevo(anterior, st.cantidad, st.visto)
				if err := q.FijarStock(ctx, sqlc.FijarStockParams{VariantID: vid, BranchID: *st.suc,
					Qty: jsmath.Num(nuevo), MinQty: jsmath.Num(st.minimo)}); err != nil {
					return err
				}
				if nuevo != anterior {
					nota := "Ajuste manual desde la ficha del producto (" + formato.Cantidad(anterior) + " → " + formato.Cantidad(nuevo) + ")"
					if err := q.RegistrarMovimiento(ctx, sqlc.RegistrarMovimientoParams{
						VariantID: vid, BranchID: *st.suc, Type: sqlc.MovementTypeAjuste,
						Qty: jsmath.Num(jsmath.Round(float64(nuevo-anterior)*1000) / 1000), Note: &nota, CreatedByUserID: &ses.UserID,
					}); err != nil {
						return err
					}
				}
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	// Las fotos de la biblioteca de las medidas nuevas: después del commit y
	// antes de contestar (la ficha que se vuelve a armar ya las muestra).
	// Solo al crear la medida: guardar de nuevo no devuelve una foto que la
	// clienta borró.
	for _, m := range nuevas {
		s.fotos.Adjuntar(ctx, s.pool, m)
	}
	for _, texto := range preciosCambiados {
		bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "precio", p.ID, texto+" · "+p.Name, nil)
	}
	accion, verbo, entidad := sqlc.AccionAuditoriaCrear, "Cargó", ""
	if p.ID != "" {
		accion, verbo, entidad = sqlc.AccionAuditoriaEditar, "Editó", p.ID
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "producto", entidad, verbo+" el producto "+p.Name, nil)
	return id, nil
}

// Activar lo publica o lo da de baja.
func (s *Servicio) Activar(ctx context.Context, ses *auth.Sesion, id string, activo bool) error {
	nombre, err := s.q.CambiarActivo(ctx, sqlc.CambiarActivoParams{ID: id, Active: activo})
	if errors.Is(err, pgx.ErrNoRows) {
		nombre = "un producto"
	} else if err != nil {
		return err
	}
	accion, verbo := sqlc.AccionAuditoriaEliminar, "Dio de baja"
	if activo {
		accion, verbo = sqlc.AccionAuditoriaEditar, "Publicó"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "producto", id, verbo+" "+nombre, nil)
	return nil
}

// --- el umbral de los candidatos a baja ---

// MesesPorOmision es el umbral si nadie lo cambió o lo guardado es basura.
const MesesPorOmision = 12

// MesesSinVender es mesesSinVenderDelSistema: un entero de 1 a 60.
func (s *Servicio) MesesSinVender(ctx context.Context) (int, error) {
	v, err := s.q.MesesSinVender(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return MesesPorOmision, nil
	}
	if err != nil {
		return 0, err
	}
	n := jsmath.Numero(v)
	if n != math.Trunc(n) || n < 1 || n > 60 {
		return MesesPorOmision, nil
	}
	return int(n), nil
}

// GuardarMesesSinVender cambia el umbral (solo el admin).
func (s *Servicio) GuardarMesesSinVender(ctx context.Context, ses *auth.Sesion, meses int) (string, error) {
	if meses < 1 || meses > 60 {
		return "", plataforma.Invalido(map[string]string{"meses": "Poné un número de meses entre 1 y 60."})
	}
	if err := s.q.GuardarMesesSinVender(ctx, strconv.Itoa(meses)); err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "producto", "",
		"Cambió el umbral de candidatos a baja a "+strconv.Itoa(meses)+" meses sin ventas", nil)
	return "Ahora se señalan los que no se venden hace " + strconv.Itoa(meses) + " meses.", nil
}

// Candidato es un producto que quizá haya que dar de baja.
type Candidato struct {
	ID                 string   `json:"id"`
	Nombre             string   `json:"nombre"`
	Slug               string   `json:"slug"`
	Categoria          string   `json:"categoria"`
	DiasSinVender      *int     `json:"diasSinVender"`
	Stock              float64  `json:"stock"`
	VariantesSinPrecio int32    `json:"variantesSinPrecio"`
	Variantes          int32    `json:"variantes"`
	Motivos            []string `json:"motivos"`
}

// Candidatos es candidatosDeBajaDelSistema: **no da de baja nada**, arma la
// lista y alguien decide. Tres motivos: sin ventas en el umbral (o nunca, si
// está cargado hace más que eso), sin stock disponible, o ninguna medida con
// precio. Primero los que juntan más motivos.
func (s *Servicio) Candidatos(ctx context.Context, meses int, ahora time.Time) ([]Candidato, error) {
	// setMonth(getMonth() - n) de JS, en la hora del servidor (UTC).
	corte := ahora.UTC().AddDate(0, -meses, 0)
	filas, err := s.q.CandidatosDeBaja(ctx)
	if err != nil {
		return nil, err
	}
	out := []Candidato{}
	for _, f := range filas {
		c := Candidato{ID: f.ID, Nombre: f.Nombre, Slug: f.Slug, Categoria: f.Categoria, Stock: f.Stock,
			Variantes: f.Variantes, VariantesSinPrecio: f.VariantesSinPrecio, Motivos: []string{}}
		if f.UltimaVenta.Valid {
			d := int(math.Floor(float64(ahora.Sub(f.UltimaVenta.Time).Milliseconds()) / 86_400_000))
			c.DiasSinVender = &d
			if f.UltimaVenta.Time.Before(corte) {
				c.Motivos = append(c.Motivos, "Sin ventas hace "+strconv.Itoa(int(math.Floor(float64(d)/30)))+" meses")
			}
		} else if f.Creado.Before(corte) {
			c.Motivos = append(c.Motivos, "Nunca se vendió")
		}
		if c.Stock <= 0 {
			c.Motivos = append(c.Motivos, "Sin stock en ninguna sucursal")
		}
		if c.Variantes > 0 && c.VariantesSinPrecio == c.Variantes {
			c.Motivos = append(c.Motivos, "Ninguna medida tiene precio")
		}
		if len(c.Motivos) > 0 {
			out = append(out, c)
		}
	}
	slices.SortStableFunc(out, func(a, b Candidato) int { return len(b.Motivos) - len(a.Motivos) })
	return out, nil
}
