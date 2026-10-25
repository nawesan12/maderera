package precios

import (
	"context"
	"strconv"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// La importación de una planilla de precios: primero se compara con la base y
// se muestra qué cambiaría; después se confirma lo que la persona eligió.

// FilaLeida es una fila de la planilla ya interpretada (leerFilas del TS).
type FilaLeida struct {
	Linea             int
	SKU               string
	PrecioGeneral     *string
	PrecioProfesional *string
	Error             string
}

// FilaPrevia es cómo queda cada fila contra la base.
type FilaPrevia struct {
	Linea             int     `json:"linea"`
	SKU               string  `json:"sku"`
	Producto          *string `json:"producto,omitempty"`
	Medida            *string `json:"medida,omitempty"`
	GeneralActual     *string `json:"generalActual,omitempty"`
	GeneralNuevo      *string `json:"generalNuevo,omitempty"`
	ProfesionalActual *string `json:"profesionalActual,omitempty"`
	ProfesionalNuevo  *string `json:"profesionalNuevo,omitempty"`
	Estado            string  `json:"estado"`
	Detalle           *string `json:"detalle,omitempty"`
}

// VistaPrevia es la comparación entera.
type VistaPrevia struct {
	Filas     []FilaPrevia `json:"filas"`
	Cambian   int          `json:"cambian"`
	Iguales   int          `json:"iguales"`
	Problemas int          `json:"problemas"`
	Error     *string      `json:"error,omitempty"`
}

func ptr(s string) *string { return &s }

// Comparar es compararConLaBase: para cada fila, el producto, los precios de
// hoy y los nuevos solo si cambian.
func (s *Servicio) Comparar(ctx context.Context, leidas []FilaLeida) (VistaPrevia, error) {
	ls, _, err := s.listas(ctx, s.q)
	if err != nil {
		return VistaPrevia{}, err
	}
	var skus []string
	for _, f := range leidas {
		if f.SKU != "" {
			skus = append(skus, f.SKU)
		}
	}
	variantes, err := s.q.VariantesPorSKU(ctx, skus)
	if err != nil {
		return VistaPrevia{}, err
	}
	ids := make([]string, len(variantes))
	porSKU := map[string]sqlc.VariantesPorSKURow{}
	for i := len(variantes) - 1; i >= 0; i-- { // el primero gana, como find()
		ids[i] = variantes[i].ID
		porSKU[variantes[i].Sku] = variantes[i]
	}
	precios, err := s.q.PreciosDeLasVariantes(ctx, ids)
	if err != nil {
		return VistaPrevia{}, err
	}
	actual := func(v string, l *sqlc.PriceList) *string {
		for _, p := range precios {
			if l != nil && p.VariantID == v && p.PriceListID == l.ID {
				return ptr(p.Price)
			}
		}
		return nil
	}
	cambia := func(nuevo, actual *string) bool {
		viejo := -1.0
		if actual != nil {
			viejo = jsmath.Numero(*actual)
		}
		return nuevo != nil && jsmath.Numero(*nuevo) != viejo
	}
	v := VistaPrevia{Filas: []FilaPrevia{}}
	for _, l := range leidas {
		f := FilaPrevia{Linea: l.Linea, SKU: l.SKU}
		variante, ok := porSKU[l.SKU]
		switch {
		case l.Error != "":
			f.Estado, f.Detalle = "error", ptr(l.Error)
			v.Problemas++
		case !ok:
			f.Estado, f.Detalle = "sin-sku", ptr("No hay ningún producto con ese código.")
			v.Problemas++
		default:
			f.Producto, f.Medida = ptr(variante.Producto), ptr(variante.Medida)
			f.GeneralActual, f.ProfesionalActual = actual(variante.ID, ls.general), actual(variante.ID, ls.profesional)
			if cambia(l.PrecioGeneral, f.GeneralActual) {
				f.GeneralNuevo = l.PrecioGeneral
			}
			if cambia(l.PrecioProfesional, f.ProfesionalActual) {
				f.ProfesionalNuevo = l.PrecioProfesional
			}
			if f.GeneralNuevo != nil || f.ProfesionalNuevo != nil {
				f.Estado = "cambia"
				v.Cambian++
			} else {
				f.Estado = "igual"
				v.Iguales++
			}
		}
		v.Filas = append(v.Filas, f)
	}
	return v, nil
}

// CambioImportado es lo que la persona confirmó de una fila.
type CambioImportado struct {
	SKU              string  `json:"sku"`
	GeneralNuevo     *string `json:"generalNuevo"`
	ProfesionalNuevo *string `json:"profesionalNuevo"`
}

// Confirmar aplica los cambios en un lote del historial. Devuelve el mensaje.
func (s *Servicio) Confirmar(ctx context.Context, ses *auth.Sesion, cambios []CambioImportado) (string, error) {
	if len(cambios) == 0 {
		return "", plataforma.Invalido(map[string]string{"cambios": "No hay cambios para aplicar."})
	}
	lote := uuid()
	aplicados := 0
	motivo := "Importación de planilla"
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		ls, _, err := s.listas(ctx, q)
		if err != nil {
			return err
		}
		skus := make([]string, len(cambios))
		for i, c := range cambios {
			skus[i] = c.SKU
		}
		variantes, err := q.VariantesPorSKU(ctx, skus)
		if err != nil {
			return err
		}
		porSKU := map[string]string{}
		for i := len(variantes) - 1; i >= 0; i-- {
			porSKU[variantes[i].Sku] = variantes[i].ID
		}
		for _, c := range cambios {
			id, ok := porSKU[c.SKU]
			if !ok {
				continue
			}
			for _, x := range []struct {
				lista *sqlc.PriceList
				valor *string
			}{{ls.general, c.GeneralNuevo}, {ls.profesional, c.ProfesionalNuevo}} {
				if x.lista == nil || x.valor == nil || *x.valor == "" {
					continue
				}
				hubo, err := cambiar(ctx, q, ses, id, x.lista.ID, *x.valor, sqlc.PriceChangeSourceImportacion, &motivo, &lote)
				if err != nil {
					return err
				}
				if hubo {
					aplicados++
				}
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaImportar, "precio", "",
		"Importó una planilla: "+strconv.Itoa(aplicados)+" precio"+plural(aplicados)+" cambiado"+plural(aplicados),
		map[string]any{"loteId": lote, "aplicados": aplicados, "filas": len(cambios)})
	return "Se aplicaron " + strconv.Itoa(aplicados) + " cambio" + plural(aplicados) + " de precio.", nil
}
