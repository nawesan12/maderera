package main

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/catalogo"
	"mjbj/internal/whatsapp"
)

// buscadorDelBot le da al bot de WhatsApp el catálogo público: lista general,
// sin precios (el bot no los da), hasta seis productos.
func buscadorDelBot(pool *pgxpool.Pool) whatsapp.Buscador {
	cat := catalogo.Nuevo(pool)
	return func(ctx context.Context, consulta, rubro string) ([]whatsapp.ProductoBot, error) {
		general, err := cat.General(ctx)
		if err != nil {
			return nil, err
		}
		f := catalogo.Filtros{Busqueda: consulta}
		if consulta == "" {
			f.Categoria = rubro
		}
		ps, err := cat.Productos(ctx, f, general)
		if err != nil {
			return nil, err
		}
		if len(ps) == 0 && consulta != "" && rubro != "" {
			if ps, err = cat.Productos(ctx, catalogo.Filtros{Categoria: rubro}, general); err != nil {
				return nil, err
			}
		}
		if len(ps) > 6 {
			ps = ps[:6]
		}
		out := make([]whatsapp.ProductoBot, 0, len(ps))
		for _, p := range ps {
			out = append(out, whatsapp.ProductoBot{
				Nombre: p.Name, Slug: p.Slug, Medidas: p.Labels,
				Central: p.StockCentral != catalogo.SinStock, Aserr: p.StockAserradero != catalogo.SinStock,
			})
		}
		return out, nil
	}
}
