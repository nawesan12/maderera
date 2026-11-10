package main

import (
	"context"
	"errors"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/asistente"
	"mjbj/internal/catalogo"
	"mjbj/internal/cortes"
	"mjbj/internal/plataforma"
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

// corteadorDelBot guarda el despiece del chat como consulta de corte, sobre la
// placa que nombraron: la misma elección que hace el cortador del sitio con
// el enlace del asistente (lib/cortes/enlace.ts), la placa que tenga todas
// las palabras del material o, si no hay, la que tenga la primera.
func corteadorDelBot(pool *pgxpool.Pool, log *slog.Logger) whatsapp.Corteador {
	cat := catalogo.Nuevo(pool)
	cor := cortes.Nuevo(pool, log)
	return func(ctx context.Context, d asistente.Despiece) (string, string, string, error) {
		general, err := cat.General(ctx)
		if err != nil {
			return "", "", "", err
		}
		placas, err := cor.Placas(ctx, general)
		if err != nil {
			return "", "", "", err
		}
		p := elegirPlaca(placas, d.Material)
		if p == nil {
			return "", "", "", nil
		}
		piezas := make([]any, 0, len(d.Piezas))
		for _, x := range d.Piezas {
			piezas = append(piezas, map[string]any{
				"largoMm": float64(x.LargoMm), "anchoMm": float64(x.AnchoMm), "cantidad": float64(x.Cantidad),
				"cantoLargo": float64(x.CantoLargo), "cantoAncho": float64(x.CantoAncho), "respetaVeta": float64(0),
			})
		}
		token, err := cor.GuardarConsulta(ctx, map[string]any{"variantId": p.VariantID, "piezas": piezas}, "whatsapp")
		var problema *plataforma.Problema
		if errors.As(err, &problema) && problema.Estado < 500 {
			motivo := problema.Detalle
			for _, m := range problema.Errores {
				motivo = m
			}
			return "", p.Descripcion, motivo, nil
		}
		return token, p.Descripcion, "", err
	}
}

func elegirPlaca(placas []cortes.PlacaCortable, material string) *cortes.PlacaCortable {
	var palabras []string
	for _, w := range strings.Fields(asistente.Normalizar(material)) {
		if len(w) > 2 {
			palabras = append(palabras, w)
		}
	}
	if len(palabras) == 0 {
		return nil
	}
	tiene := func(p cortes.PlacaCortable, w string) bool {
		return strings.Contains(asistente.Normalizar(p.Descripcion), w)
	}
	for i := range placas {
		todas := true
		for _, w := range palabras {
			if !tiene(placas[i], w) {
				todas = false
				break
			}
		}
		if todas {
			return &placas[i]
		}
	}
	for i := range placas {
		if tiene(placas[i], palabras[0]) {
			return &placas[i]
		}
	}
	return nil
}
