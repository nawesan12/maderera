package productos

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
	"mjbj/internal/subidas"
)

// Servicio es la gestión de productos.
type Servicio struct {
	pool  *pgxpool.Pool
	q     *sqlc.Queries
	disco *subidas.Disco
	log   *slog.Logger
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, disco *subidas.Disco, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), disco: disco, log: log}
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

// terminos es lo de coincideBusqueda: hasta seis palabras.
func terminos(texto string) []string {
	t := strings.Fields(texto)
	if len(t) > 6 {
		t = t[:6]
	}
	return t
}

// Listar es listarProductosAdmin: todos (también los dados de baja), los
// últimos tocados primero. La búsqueda es por palabra (todas tienen que
// aparecer) en nombre, marca, rubro o categoría, sin tildes.
func (s *Servicio) Listar(ctx context.Context, busqueda, categoria string) ([]ProductoAdmin, error) {
	var cond []string
	var args []any
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	if categoria != "" && categoria != "todos" {
		cond = append(cond, "c.slug = "+arg(categoria))
	}
	for _, t := range terminos(busqueda) {
		patron := arg("%" + t + "%")
		var col []string
		for _, c := range []string{"p.name", "p.brand", "p.subcategory", "c.name"} {
			col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+patron+")")
		}
		cond = append(cond, "("+strings.Join(col, " OR ")+")")
	}
	donde := ""
	if len(cond) > 0 {
		donde = "WHERE " + strings.Join(cond, " AND ")
	}
	filas, err := s.pool.Query(ctx, `
		SELECT p.id, p.slug, p.name, c.name, p.brand, p.unit::text, p.featured, p.active,
		  (SELECT count(*) FROM product_variants v WHERE v.product_id = p.id)::int,
		  coalesce((SELECT sum(i.qty) FROM product_variants v JOIN inventory i ON i.variant_id = v.id WHERE v.product_id = p.id), 0)::float8,
		  (SELECT i.url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order LIMIT 1),
		  (SELECT min(pli.price) FROM product_variants v
		     JOIN price_list_items pli ON pli.variant_id = v.id
		     JOIN price_lists pl ON pl.id = pli.price_list_id AND pl.is_default
		   WHERE v.product_id = p.id AND pli.price > 0)::float8
		FROM products p JOIN categories c ON c.id = p.category_id
		`+donde+`
		ORDER BY p.updated_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (ProductoAdmin, error) {
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
	FormaDeVenta          string            `json:"formaDeVenta"`
	PrecioMediaPct        float64           `json:"precioMediaPct"`
	Imagen                string            `json:"imagen"`
	Galeria               []ImagenDeGaleria `json:"galeria"`
	Variantes             []VarianteDeFicha `json:"variantes"`
}

// ImagenDeGaleria es una foto del producto.
type ImagenDeGaleria struct {
	ID  string  `json:"id"`
	URL string  `json:"url"`
	Alt *string `json:"alt"`
}

// VarianteDeFicha es una medida en la ficha.
type VarianteDeFicha struct {
	ID                string  `json:"id"`
	SKU               string  `json:"sku"`
	Label             string  `json:"label"`
	LargoMm           *int32  `json:"largoMm"`
	AnchoMm           *int32  `json:"anchoMm"`
	EspesorMm         *int32  `json:"espesorMm"`
	Material          string  `json:"material"`
	Color             string  `json:"color"`
	Terminacion       string  `json:"terminacion"`
	Calidad           string  `json:"calidad"`
	PrecioGeneral     string  `json:"precioGeneral"`
	PrecioProfesional string  `json:"precioProfesional"`
	StockCentral      float64 `json:"stockCentral"`
	StockAserradero   float64 `json:"stockAserradero"`
	MinCentral        float64 `json:"minCentral"`
	MinAserradero     float64 `json:"minAserradero"`
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// listasYSucursales: la general, la profesional (por slug) y las dos
// sucursales, que la ficha edita juntas.
type listasYSucursales struct{ general, profesional, central, aserradero *string }

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
	sucs, err := q.Sucursales(ctx)
	if err != nil {
		return r, err
	}
	for _, b := range sucs {
		switch b.Slug {
		case "casa-central":
			r.central = &b.ID
		case "aserradero":
			r.aserradero = &b.ID
		}
	}
	return r, nil
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
	for _, v := range vs {
		f.Variantes = append(f.Variantes, VarianteDeFicha{
			ID: v.ID, SKU: v.Sku, Label: v.Label, LargoMm: v.LargoMm, AnchoMm: v.AnchoMm, EspesorMm: v.EspesorMm,
			Material: deref(v.Material), Color: deref(v.Color), Terminacion: deref(v.Terminacion), Calidad: deref(v.Calidad),
			PrecioGeneral: precio(v.ID, ls.general), PrecioProfesional: precio(v.ID, ls.profesional),
			StockCentral: cantidad(v.ID, ls.central, false), StockAserradero: cantidad(v.ID, ls.aserradero, false),
			MinCentral: cantidad(v.ID, ls.central, true), MinAserradero: cantidad(v.ID, ls.aserradero, true),
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
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
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
			}
			if err != nil {
				return err
			}
			for _, lp := range []struct {
				lista  *string
				precio string
			}{{ls.general, v.PrecioGeneral}, {ls.profesional, v.PrecioProfesional}} {
				if lp.lista == nil {
					continue
				}
				if err := q.GuardarPrecio(ctx, sqlc.GuardarPrecioParams{PriceListID: *lp.lista, VariantID: vid, Price: lp.precio}); err != nil {
					return err
				}
			}
			for _, st := range []struct {
				suc              *string
				cantidad, minimo float64
			}{{ls.central, valor(v.StockCentral), valor(v.MinCentral)}, {ls.aserradero, valor(v.StockAserradero), valor(v.MinAserradero)}} {
				if st.suc == nil {
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
				if err := q.FijarStock(ctx, sqlc.FijarStockParams{VariantID: vid, BranchID: *st.suc,
					Qty: jsmath.Num(st.cantidad), MinQty: jsmath.Num(st.minimo)}); err != nil {
					return err
				}
				if st.cantidad != anterior {
					nota := "Ajuste manual desde la ficha del producto (" + formato.Cantidad(anterior) + " → " + formato.Cantidad(st.cantidad) + ")"
					if err := q.RegistrarMovimiento(ctx, sqlc.RegistrarMovimientoParams{
						VariantID: vid, BranchID: *st.suc, Type: sqlc.MovementTypeAjuste,
						Qty: jsmath.Num(jsmath.Round(float64(st.cantidad-anterior)*1000) / 1000), Note: &nota, CreatedByUserID: &ses.UserID,
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
