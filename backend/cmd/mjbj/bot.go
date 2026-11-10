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

// fichaDelBot trae las medidas con el precio de la lista general: van al
// presupuesto en revisión, no al cliente.
func fichaDelBot(pool *pgxpool.Pool) whatsapp.Ficheador {
	cat := catalogo.Nuevo(pool)
	return func(ctx context.Context, slug string) (*whatsapp.FichaBot, error) {
		general, err := cat.General(ctx)
		if err != nil {
			return nil, err
		}
		p, err := cat.Producto(ctx, slug, general)
		if err != nil || p == nil {
			return nil, err
		}
		f := &whatsapp.FichaBot{Nombre: p.Name, Unidad: p.Unit}
		for _, v := range p.Variantes {
			vb := whatsapp.VarianteBot{ID: v.ID, Label: v.Label}
			if v.EspesorMm != nil {
				vb.EspesorMm = int(*v.EspesorMm)
			}
			if v.LargoMm != nil {
				vb.LargoMm = int(*v.LargoMm)
			}
			if v.AnchoMm != nil {
				vb.AnchoMm = int(*v.AnchoMm)
			}
			if v.Precio != nil {
				vb.Precio = *v.Precio
			}
			f.Variantes = append(f.Variantes, vb)
		}
		return f, nil
	}
}
