package catalogo

import (
	"context"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
)

// FilaDeLista es un renglón de la lista de precios en PDF.
type FilaDeLista struct {
	SKU       string  `json:"sku"`
	Producto  string  `json:"producto"`
	Medida    string  `json:"medida"`
	Categoria string  `json:"categoria"`
	Precio    *string `json:"precio"`
}

// A mano y no con sqlc: sqlc pierde que el precio puede faltar (una variante
// sin precio cargado) en cuanto la columna tiene un cast.
const filasDeMiLista = `
SELECT v.sku, p.name, v.label, c.name,
       coalesce(pr.price, round((g.price * $1::numeric)::numeric, 2))::text
FROM product_variants v
JOIN products p ON p.id = v.product_id
JOIN categories c ON c.id = p.category_id
LEFT JOIN price_list_items pr ON pr.variant_id = v.id AND pr.price_list_id = $2::uuid
LEFT JOIN price_list_items g ON g.variant_id = v.id AND g.price_list_id = $3::uuid
WHERE p.active AND v.active
ORDER BY c.sort_order, p.name, v.sort_order`

// FilasDeMiLista son las variantes activas con el precio de la lista dada,
// calculado como en el catálogo: el propio, o el general por el factor de
// una lista derivada. El TS de /mi-lista-de-precios ignoraba el factor y le
// mostraba al profesional el precio general.
func (s *Servicio) FilasDeMiLista(ctx context.Context, lista Lista) ([]FilaDeLista, error) {
	l := lista.paraConsulta()
	filas, err := s.pool.Query(ctx, filasDeMiLista, jsmath.Num(l.factor), l.id, l.generalID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (FilaDeLista, error) {
		var f FilaDeLista
		err := r.Scan(&f.SKU, &f.Producto, &f.Medida, &f.Categoria, &f.Precio)
		return f, err
	})
}
