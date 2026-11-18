package productos

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/codigobarras"
	"mjbj/internal/plataforma"
)

// Etiqueta es lo que va impreso en la etiqueta de una medida.
type Etiqueta struct {
	VariantID   string `json:"variantId"`
	ProductID   string `json:"productId"`
	Nombre      string `json:"nombre"`
	NombreCorto string `json:"nombreCorto"`
	Medida      string `json:"medida"`
	SKU         string `json:"sku"`
	// Codigo es el código de barras de la medida o, si no tiene, su SKU.
	Codigo string `json:"codigo"`
	// Precio de la lista general, solo si se pidió y es mayor que cero.
	Precio *string              `json:"precio"`
	Barras *codigobarras.Barras `json:"barras"`
}

// TopeDeEtiquetas: ids por pedido. Una hoja con más medidas que esto es un
// error de selección, no una tanda de etiquetas.
const TopeDeEtiquetas = 300

// LargoNombreCorto: lo que entra en dos renglones de una etiqueta de 50 mm.
const LargoNombreCorto = 40

// NombreCorto recorta el nombre en la última palabra entera que entra, con
// puntos suspensivos. La etiqueta es chica y el nombre largo se cortaba a
// mitad de palabra.
func NombreCorto(nombre string) string {
	nombre = strings.Join(strings.Fields(nombre), " ")
	if utf8.RuneCountInString(nombre) <= LargoNombreCorto {
		return nombre
	}
	corte := string([]rune(nombre)[:LargoNombreCorto-1])
	if i := strings.LastIndexByte(corte, ' '); i > LargoNombreCorto/2 {
		corte = corte[:i]
	}
	return strings.TrimRight(corte, " ,.-—") + "…"
}

// separarIds parte «a,b,c» y se queda con los uuid válidos, sin repetir.
func separarIds(s string, vistos map[string]bool) []string {
	var out []string
	for _, x := range strings.Split(s, ",") {
		x = strings.TrimSpace(x)
		if plataforma.UUIDValido(x) && !vistos[x] {
			vistos[x] = true
			out = append(out, x)
		}
	}
	return out
}

// Etiquetas arma las etiquetas de las medidas pedidas y de todas las medidas
// activas de los productos pedidos, en ese orden. Las cantidades las decide
// la hoja: acá va una por medida.
func (s *Servicio) Etiquetas(ctx context.Context, medidas, productos string, conPrecio bool) ([]Etiqueta, error) {
	vistos := map[string]bool{}
	ms := separarIds(medidas, vistos)
	ps := separarIds(productos, vistos)
	if len(ms)+len(ps) > TopeDeEtiquetas {
		return nil, plataforma.Invalido(map[string]string{"medidas": "Son demasiadas medidas para una sola hoja."})
	}
	out := []Etiqueta{}
	if len(ms)+len(ps) == 0 {
		return out, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT v.id, p.id, p.name, v.label, v.sku, v.codigo_barras,
		  (SELECT pli.price::text FROM price_list_items pli
		     JOIN price_lists pl ON pl.id = pli.price_list_id AND pl.is_default
		   WHERE pli.variant_id = v.id AND pli.price > 0 LIMIT 1)
		FROM product_variants v JOIN products p ON p.id = v.product_id
		WHERE v.id = ANY($1::uuid[]) OR (v.product_id = ANY($2::uuid[]) AND v.active)
		ORDER BY p.name, v.sort_order, v.id`, ms, ps)
	if err != nil {
		return nil, err
	}
	todas, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (Etiqueta, error) {
		var e Etiqueta
		var barras *string
		err := r.Scan(&e.VariantID, &e.ProductID, &e.Nombre, &e.Medida, &e.SKU, &barras, &e.Precio)
		e.Codigo = e.SKU
		if barras != nil && strings.TrimSpace(*barras) != "" {
			e.Codigo = strings.TrimSpace(*barras)
		}
		return e, err
	})
	if err != nil {
		return nil, err
	}
	for i := range todas {
		e := &todas[i]
		e.NombreCorto = NombreCorto(e.Nombre)
		if !conPrecio {
			e.Precio = nil
		}
		if b, err := codigobarras.Armar(e.Codigo); err == nil {
			e.Barras = &b
		}
	}
	// Primero las medidas en el orden pedido; después las de cada producto.
	porMedida := map[string]Etiqueta{}
	for _, e := range todas {
		porMedida[e.VariantID] = e
	}
	puesta := map[string]bool{}
	for _, id := range ms {
		if e, ok := porMedida[id]; ok {
			out = append(out, e)
			puesta[id] = true
		}
	}
	for _, p := range ps {
		for _, e := range todas {
			if e.ProductID == p && !puesta[e.VariantID] {
				out = append(out, e)
				puesta[e.VariantID] = true
			}
		}
	}
	return out, nil
}
