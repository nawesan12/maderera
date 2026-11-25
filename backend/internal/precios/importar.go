package precios

import (
	"context"
	"math"
	"strconv"
	"strings"

	"errors"

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
	// Un SKU que aparece dos veces es un error en todas sus filas: ganaba
	// el último sin aviso, y quién sabe cuál era el bueno (T3, hallazgo 15).
	lineasDe := map[string][]int{}
	for _, l := range leidas {
		if l.SKU != "" && l.Error == "" {
			lineasDe[l.SKU] = append(lineasDe[l.SKU], l.Linea)
		}
	}
	v := VistaPrevia{Filas: []FilaPrevia{}}
	for _, l := range leidas {
		f := FilaPrevia{Linea: l.Linea, SKU: l.SKU}
		variante, ok := porSKU[l.SKU]
		switch {
		case l.Error != "":
			f.Estado, f.Detalle = "error", ptr(l.Error)
			v.Problemas++
		case len(lineasDe[l.SKU]) > 1:
			otra := lineasDe[l.SKU][0]
			if otra == l.Linea {
				otra = lineasDe[l.SKU][1]
			}
			f.Estado, f.Detalle = "error", ptr("Repetido en la línea "+strconv.Itoa(otra)+".")
			v.Problemas++
		case !precioImportable(l.PrecioGeneral) || !precioImportable(l.PrecioProfesional):
			f.Estado, f.Detalle = "error", ptr("El precio tiene que ser mayor a cero y con hasta dos decimales.")
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

// precioImportable: vacío (no se cambia) o un número finito, mayor a cero y
// con hasta dos decimales. Un 0 o un negativo dejaba el producto regalado.
func precioImportable(p *string) bool {
	if p == nil || *p == "" {
		return true
	}
	n := jsmath.Numero(*p)
	if math.IsNaN(n) || math.IsInf(n, 0) || n <= 0 || n > 1e12 {
		return false
	}
	return math.Abs(float64(n*100)-jsmath.Round(n*100)) < 1e-6
}

// CambioImportado es lo que la persona confirmó de una fila, con los precios
// que vio en la vista previa (nil: no tenía).
type CambioImportado struct {
	SKU               string  `json:"sku"`
	GeneralNuevo      *string `json:"generalNuevo"`
	ProfesionalNuevo  *string `json:"profesionalNuevo"`
	GeneralActual     *string `json:"generalActual"`
	ProfesionalActual *string `json:"profesionalActual"`
}

// mismoPrecio compara el precio que vio la vista previa con el de ahora.
func mismoPrecio(visto *string, ahora *string) bool {
	if visto == nil || *visto == "" || ahora == nil {
		return (visto == nil || *visto == "") && ahora == nil
	}
	return jsmath.Numero(*visto) == jsmath.Numero(*ahora)
}

// Confirmar aplica los cambios en un lote del historial. Devuelve el mensaje.
//
// **No confía en lo que manda el navegador** (T3, hallazgo 15): cada fila se
// vuelve a validar —el precio, que el SKU no esté dos veces— y se rechaza la
// que cambió de precio desde la vista previa (alguien lo tocó a mano en el
// medio: la planilla lo pisaba sin que nadie lo viera). Las demás se aplican,
// y el mensaje dice cuántas se rechazaron y por qué.
func (s *Servicio) Confirmar(ctx context.Context, ses *auth.Sesion, cambios []CambioImportado) (string, error) {
	if len(cambios) == 0 {
		return "", plataforma.Invalido(map[string]string{"cambios": "No hay cambios para aplicar."})
	}
	lote := uuid()
	aplicados := 0
	var invalidos, repetidos, cambiaron int
	cuantas := map[string]int{}
	for _, c := range cambios {
		cuantas[c.SKU]++
	}
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
			if cuantas[c.SKU] > 1 {
				repetidos++
				continue
			}
			if !precioImportable(c.GeneralNuevo) || !precioImportable(c.ProfesionalNuevo) {
				invalidos++
				continue
			}
			type cambio struct {
				lista        *sqlc.PriceList
				valor, visto *string
			}
			filas := []cambio{{ls.general, c.GeneralNuevo, c.GeneralActual}, {ls.profesional, c.ProfesionalNuevo, c.ProfesionalActual}}
			movido := false
			for _, x := range filas {
				if x.lista == nil || x.valor == nil || *x.valor == "" {
					continue
				}
				var hoy *string
				a, err := q.PrecioActual(ctx, sqlc.PrecioActualParams{VariantID: id, PriceListID: x.lista.ID})
				if err == nil {
					hoy = &a
				} else if !errors.Is(err, pgx.ErrNoRows) {
					return err
				}
				movido = movido || !mismoPrecio(x.visto, hoy)
			}
			if movido {
				cambiaron++
				continue
			}
			for _, x := range filas {
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
		map[string]any{"loteId": lote, "aplicados": aplicados, "filas": len(cambios),
			"rechazadas": map[string]int{"cambiaron": cambiaron, "repetidas": repetidos, "invalidas": invalidos}})
	m := "Se aplicaron " + strconv.Itoa(aplicados) + " cambio" + plural(aplicados) + " de precio."
	if r := cambiaron + repetidos + invalidos; r > 0 {
		var por []string
		if cambiaron > 0 {
			por = append(por, strconv.Itoa(cambiaron)+" cambiaron de precio después de la vista previa")
		}
		if repetidos > 0 {
			por = append(por, strconv.Itoa(repetidos)+" tienen el código repetido")
		}
		if invalidos > 0 {
			por = append(por, strconv.Itoa(invalidos)+" con un precio que no vale")
		}
		m += " Se rechazaron " + strconv.Itoa(r) + " fila" + plural(r) + ": " + strings.Join(por, ", ") + "."
	}
	return m, nil
}
