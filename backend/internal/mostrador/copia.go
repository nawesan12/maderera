package mostrador

import (
	"context"
	"strings"
	"time"

	"mjbj/internal/jsmath"
	"mjbj/internal/ventas"
)

// La copia local del mostrador para trabajar sin internet
// (lib/dal/admin/mostrador-offline.ts): variantes, precios de las listas
// alcanzables, stock y padrón de clientes, completos o desde un momento.

// margen hacia atrás del generadoAt: una fila escrita mientras corría la
// consulta no puede caer en el hueco entre dos deltas.
const margen = 5 * time.Second

// FechaJS es Date.prototype.toISOString: UTC con milisegundos.
func FechaJS(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// LeerDesde es el ?desde= de un delta: nil (todo) si no vino o no es una fecha.
func LeerDesde(crudo string) *time.Time {
	if crudo == "" {
		return nil
	}
	for _, f := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02T15:04:05.000", "2006-01-02"} {
		var t time.Time
		var err error
		if f == time.RFC3339Nano {
			t, err = time.Parse(f, crudo)
		} else if f == "2006-01-02" {
			t, err = time.Parse(f, crudo) // solo la fecha: UTC, como new Date("AAAA-MM-DD")
		} else {
			t, err = time.ParseInLocation(f, crudo, time.UTC) // Next corre en UTC
		}
		if err == nil {
			t = t.Truncate(time.Millisecond)
			return &t
		}
	}
	return nil
}

// VarianteDeLaCopia es una variante de la copia.
type VarianteDeLaCopia struct {
	VariantID      string  `json:"variantId"`
	Sku            string  `json:"sku"`
	Producto       string  `json:"producto"`
	Medida         string  `json:"medida"`
	Unidad         string  `json:"unidad"`
	Marca          *string `json:"marca"`
	Categoria      string  `json:"categoria"`
	SortOrder      int     `json:"sortOrder"`
	LargoMm        *int    `json:"largoMm"`
	AnchoMm        *int    `json:"anchoMm"`
	FormaDeVenta   string  `json:"formaDeVenta"`
	PrecioMediaPct float64 `json:"precioMediaPct"`
	Busqueda       string  `json:"busqueda"`
}

// PrecioDeLaCopia es un precio de una lista.
type PrecioDeLaCopia struct {
	PriceListID string  `json:"priceListId"`
	VariantID   string  `json:"variantId"`
	Precio      float64 `json:"precio"`
}

// StockDeLaCopia es lo que hay de una variante en una sucursal.
type StockDeLaCopia struct {
	BranchID  string  `json:"branchId"`
	VariantID string  `json:"variantId"`
	Qty       float64 `json:"qty"`
}

// ListaDeLaCopia es una lista alcanzable.
type ListaDeLaCopia struct {
	ID        string `json:"id"`
	Nombre    string `json:"nombre"`
	EsGeneral bool   `json:"esGeneral"`
}

// CopiaDelMostrador es la respuesta de GET /api/mostrador/catalogo.
type CopiaDelMostrador struct {
	Variantes  []VarianteDeLaCopia `json:"variantes"`
	Precios    []PrecioDeLaCopia   `json:"precios"`
	Stock      []StockDeLaCopia    `json:"stock"`
	Listas     []ListaDeLaCopia    `json:"listas"`
	Bajas      []string            `json:"bajas"`
	GeneradoAt string              `json:"generadoAt"`
}

func unir(partes ...*string) string {
	var xs []string
	for _, p := range partes {
		if p != nil && *p != "" {
			xs = append(xs, *p)
		}
	}
	return strings.Join(xs, " ")
}

// Copia es copiaDelMostrador.
func (s *Servicio) Copia(ctx context.Context, desde *time.Time) (CopiaDelMostrador, error) {
	generado := s.ahora().Add(-margen)
	c := CopiaDelMostrador{Variantes: []VarianteDeLaCopia{}, Precios: []PrecioDeLaCopia{}, Stock: []StockDeLaCopia{}, Listas: []ListaDeLaCopia{}, Bajas: []string{}, GeneradoAt: FechaJS(generado)}

	filas, err := s.pool.Query(ctx, `
		SELECT v.id, v.sku, p.name, v.label, p.unit::text, p.brand, c.name, v.sort_order, v.largo_mm, v.ancho_mm,
		       p.forma_de_venta::text, p.precio_media_pct
		FROM product_variants v JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id
		WHERE v.active = true AND p.active = true AND ($1::timestamptz IS NULL OR v.updated_at > $1 OR p.updated_at > $1)
		ORDER BY v.sort_order`, desde)
	if err != nil {
		return c, err
	}
	for filas.Next() {
		var v VarianteDeLaCopia
		var pct jsmath.Num
		if err := filas.Scan(&v.VariantID, &v.Sku, &v.Producto, &v.Medida, &v.Unidad, &v.Marca, &v.Categoria, &v.SortOrder,
			&v.LargoMm, &v.AnchoMm, &v.FormaDeVenta, &pct); err != nil {
			filas.Close()
			return c, err
		}
		v.PrecioMediaPct = pct.F()
		v.Busqueda = ventas.Normalizar(unir(&v.Producto, &v.Medida, &v.Sku, v.Marca, &v.Categoria))
		c.Variantes = append(c.Variantes, v)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return c, err
	}

	if desde != nil {
		filas, err := s.pool.Query(ctx, `
			SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
			WHERE (v.active = false OR p.active = false) AND (v.updated_at > $1 OR p.updated_at > $1)`, *desde)
		if err != nil {
			return c, err
		}
		for filas.Next() {
			var id string
			if err := filas.Scan(&id); err != nil {
				filas.Close()
				return c, err
			}
			c.Bajas = append(c.Bajas, id)
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return c, err
		}
	}

	filas, err = s.pool.Query(ctx, `
		SELECT DISTINCT l.id, l.name, l.is_default FROM price_lists l LEFT JOIN customers c ON c.price_list_id = l.id
		WHERE l.active = true AND (l.is_default = true OR c.id IS NOT NULL)`)
	if err != nil {
		return c, err
	}
	var ids []string
	for filas.Next() {
		var l ListaDeLaCopia
		if err := filas.Scan(&l.ID, &l.Nombre, &l.EsGeneral); err != nil {
			filas.Close()
			return c, err
		}
		c.Listas = append(c.Listas, l)
		ids = append(ids, l.ID)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return c, err
	}

	if len(ids) > 0 {
		filas, err := s.pool.Query(ctx, `
			SELECT price_list_id, variant_id, price FROM price_list_items
			WHERE price_list_id = ANY($1::uuid[]) AND ($2::timestamptz IS NULL OR updated_at > $2)`, ids, desde)
		if err != nil {
			return c, err
		}
		for filas.Next() {
			var p PrecioDeLaCopia
			var precio jsmath.Num
			if err := filas.Scan(&p.PriceListID, &p.VariantID, &precio); err != nil {
				filas.Close()
				return c, err
			}
			p.Precio = precio.F()
			c.Precios = append(c.Precios, p)
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return c, err
		}
	}

	filas, err = s.pool.Query(ctx, `
		SELECT i.branch_id, i.variant_id, i.qty FROM inventory i JOIN branches b ON b.id = i.branch_id
		WHERE b.active = true AND ($1::timestamptz IS NULL OR i.updated_at > $1)`, desde)
	if err != nil {
		return c, err
	}
	defer filas.Close()
	for filas.Next() {
		var x StockDeLaCopia
		var qty jsmath.Num
		if err := filas.Scan(&x.BranchID, &x.VariantID, &qty); err != nil {
			return c, err
		}
		x.Qty = qty.F()
		c.Stock = append(c.Stock, x)
	}
	return c, filas.Err()
}

// ClienteDeLaCopia es un cliente del padrón local.
type ClienteDeLaCopia struct {
	ID            string  `json:"id"`
	Nombre        string  `json:"nombre"`
	RazonSocial   *string `json:"razonSocial"`
	Cuit          *string `json:"cuit"`
	CondicionIva  string  `json:"condicionIva"`
	PriceListID   *string `json:"priceListId"`
	Estado        string  `json:"estado"`
	LimiteCredito float64 `json:"limiteCredito"`
	Busqueda      string  `json:"busqueda"`
}

// PadronDelMostrador es la respuesta de GET /api/mostrador/clientes.
type PadronDelMostrador struct {
	Clientes   []ClienteDeLaCopia `json:"clientes"`
	GeneradoAt string             `json:"generadoAt"`
}

// Padron es clientesDelMostrador.
func (s *Servicio) Padron(ctx context.Context, desde *time.Time) (PadronDelMostrador, error) {
	p := PadronDelMostrador{Clientes: []ClienteDeLaCopia{}, GeneradoAt: FechaJS(s.ahora().Add(-margen))}
	filas, err := s.pool.Query(ctx, `
		SELECT id, nombre, razon_social, cuit, condicion_iva::text, price_list_id, estado::text, limite_credito
		FROM customers WHERE active = true AND ($1::timestamptz IS NULL OR updated_at > $1)
		ORDER BY nombre`, desde)
	if err != nil {
		return p, err
	}
	defer filas.Close()
	for filas.Next() {
		var c ClienteDeLaCopia
		var lim jsmath.Num
		if err := filas.Scan(&c.ID, &c.Nombre, &c.RazonSocial, &c.Cuit, &c.CondicionIva, &c.PriceListID, &c.Estado, &lim); err != nil {
			return p, err
		}
		c.LimiteCredito = lim.F()
		c.Busqueda = ventas.Normalizar(unir(&c.Nombre, c.RazonSocial, c.Cuit))
		p.Clientes = append(p.Clientes, c)
	}
	return p, filas.Err()
}
