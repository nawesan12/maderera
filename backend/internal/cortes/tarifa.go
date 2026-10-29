package cortes

// La tarifa del corte, la placa y el presupuesto (lib/cortes/tarifa.ts,
// placa.ts, sierra.ts y presupuesto.ts): aritmética pura, como todo lo que
// mueve plata.

import (
	"math"
	"strings"

	"golang.org/x/text/unicode/norm"

	"mjbj/internal/jsmath"
)

// TarifaDeCorte es el precio de la pasada y del metro de tapacanto de una
// familia, para una lista (nula: la de público).
type TarifaDeCorte struct {
	Material            string  `json:"material"`
	PriceListID         *string `json:"priceListId"`
	PrecioPorPasada     float64 `json:"precioPorPasada"`
	PrecioPorMetroCanto float64 `json:"precioPorMetroCanto"`
}

// esEspacioJS es \s de JavaScript.
func esEspacioJS(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

func comparable(texto string) string {
	var b strings.Builder
	espacio := false
	for _, r := range strings.ToLower(norm.NFD.String(texto)) {
		if r >= 0x300 && r <= 0x36f {
			continue
		}
		if esEspacioJS(r) {
			espacio = true
			continue
		}
		if espacio && b.Len() > 0 {
			b.WriteByte(' ')
		}
		espacio = false
		b.WriteRune(r)
	}
	return b.String()
}

// BuscarTarifa es tarifaDeCorte: prueba los nombres en orden (primero la
// categoría del producto) y, sin la propia de la lista, cae a la general.
func BuscarTarifa(tarifas []TarifaDeCorte, candidatos []string, priceListID *string) *TarifaDeCorte {
	for _, c := range candidatos {
		if c == "" {
			continue
		}
		buscado := comparable(c)
		var delMaterial []*TarifaDeCorte
		for i := range tarifas {
			if comparable(tarifas[i].Material) == buscado {
				delMaterial = append(delMaterial, &tarifas[i])
			}
		}
		if len(delMaterial) == 0 {
			continue
		}
		if priceListID != nil && *priceListID != "" {
			for _, t := range delMaterial {
				if t.PriceListID != nil && *t.PriceListID == *priceListID {
					return t
				}
			}
		}
		for _, t := range delMaterial {
			if t.PriceListID == nil {
				return t
			}
		}
	}
	return nil
}

// CargoPorCorte es lo que se cobra por las pasadas.
func CargoPorCorte(t *TarifaDeCorte, pasadas float64) float64 {
	if t == nil || pasadas <= 0 {
		return 0
	}
	return jsmath.Round(float64(float64(t.PrecioPorPasada*math.Floor(pasadas))*100)) / 100
}

// PiezaConCanto es lo que hace falta para medir el tapacanto.
type PiezaConCanto struct {
	LargoMm, AnchoMm, Cantidad, CantoLargo, CantoAncho float64
}

// truncOCero es `Math.trunc(n) || 0`.
func truncOCero(n float64) float64 {
	t := math.Trunc(n)
	if math.IsNaN(t) || t == 0 {
		return 0
	}
	return t
}

func oCero(n float64) float64 {
	if math.IsNaN(n) || n == 0 {
		return 0
	}
	return n
}

// MetrosDeTapacanto son los metros lineales de canto de un despiece.
func MetrosDeTapacanto(piezas []PiezaConCanto) float64 {
	acotar := func(n float64) float64 { return math.Min(math.Max(truncOCero(n), 0), 2) }
	mm := 0.0
	for _, p := range piezas {
		cantidad := math.Max(truncOCero(p.Cantidad), 0)
		lados := float64(acotar(p.CantoLargo)*oCero(p.LargoMm)) + float64(acotar(p.CantoAncho)*oCero(p.AnchoMm))
		mm = mm + float64(cantidad*lados)
	}
	return jsmath.Round(float64((mm/1000)*100)) / 100
}

// CargoPorTapacanto es lo que se cobra por el pegado.
func CargoPorTapacanto(t *TarifaDeCorte, metros float64) float64 {
	if t == nil || metros <= 0 || t.PrecioPorMetroCanto <= 0 {
		return 0
	}
	return jsmath.Round(float64(float64(t.PrecioPorMetroCanto*metros)*100)) / 100
}

// --- la placa (lib/cortes/placa.ts) ---

// Medida de plaza más común, la primera de MEDIDAS_DE_PLACA.
const (
	PlacaPorDefectoLargo = 2750
	PlacaPorDefectoAncho = 1830
)

// MedidaDePlaca es la medida con la que se arma el plano.
type MedidaDePlaca struct {
	Largo    float64 `json:"largo"`
	Ancho    float64 `json:"ancho"`
	Supuesta bool    `json:"supuesta"`
	Mitad    *string `json:"mitad"`
}

func verdadero(p *float64) bool { return p != nil && *p != 0 && !math.IsNaN(*p) }

// ResolverMedida es medidaDePlaca: lo cargado a mano, la variante o la de
// plaza, y encima la mitad.
func ResolverMedida(propiaLargo, propiaAncho, varianteLargo, varianteAncho *float64, mitad *string) MedidaDePlaca {
	propia := verdadero(propiaLargo) && verdadero(propiaAncho)
	variante := verdadero(varianteLargo) && verdadero(varianteAncho)
	largo, ancho := float64(PlacaPorDefectoLargo), float64(PlacaPorDefectoAncho)
	if propia {
		largo, ancho = *propiaLargo, *propiaAncho
	} else if variante {
		largo, ancho = *varianteLargo, *varianteAncho
	}
	if mitad != nil && *mitad == "ancho" {
		largo = math.Floor(largo / 2)
	}
	if mitad != nil && *mitad == "largo" {
		ancho = math.Floor(ancho / 2)
	}
	return MedidaDePlaca{largo, ancho, !propia && !variante, mitad}
}

// NombreDeLaMitad es cómo se dice en pantalla de qué sale el trabajo.
func NombreDeLaMitad(mitad *string) string {
	if mitad != nil && *mitad == "largo" {
		return "Media placa, partida a lo largo"
	}
	if mitad != nil && *mitad == "ancho" {
		return "Media placa, partida al ancho"
	}
	return "Placa entera"
}

// FraccionDePlaca: media placa se cobra al porcentaje de la media.
func FraccionDePlaca(mitad *string, pctMedia float64) float64 {
	if mitad != nil && *mitad != "" {
		return pctMedia / 100
	}
	return 1
}

// --- la sierra (lib/cortes/sierra.ts) ---

const (
	SierraMinimaMm = 0.5
	SierraMaximaMm = 10
)

// LeerAnchoDeSierra lee «3,2», «3.2» o «5» y lo redondea a un decimal; nil
// si está vacío o fuera de rango.
func LeerAnchoDeSierra(texto string) *float64 {
	if texto == "" {
		return nil
	}
	n := jsmath.Numero(strings.Replace(strings.TrimSpace(texto), ",", ".", 1))
	return sierraEnRango(n)
}

func sierraEnRango(n float64) *float64 {
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return nil
	}
	r := jsmath.Round(float64(n*10)) / 10
	if r < SierraMinimaMm || r > SierraMaximaMm {
		return nil
	}
	return &r
}

// --- el presupuesto (lib/cortes/presupuesto.ts) ---

// PiezaPresupuestada es una pieza como la conoce el presupuesto.
type PiezaPresupuestada struct {
	LargoMm    float64 `json:"largoMm"`
	AnchoMm    float64 `json:"anchoMm"`
	Cantidad   float64 `json:"cantidad"`
	CantoLargo float64 `json:"cantoLargo"`
	CantoAncho float64 `json:"cantoAncho"`
}

// PresupuestoDeCorte es qué se le cobra a alguien que pide un corte.
type PresupuestoDeCorte struct {
	PlacasEnteras    int      `json:"placasEnteras"`
	Fraccion         float64  `json:"fraccion"`
	PrecioPorPlaca   float64  `json:"precioPorPlaca"`
	SubtotalPlacas   float64  `json:"subtotalPlacas"`
	PasadasCobrables int      `json:"pasadasCobrables"`
	PrecioPorPasada  float64  `json:"precioPorPasada"`
	SubtotalCorte    float64  `json:"subtotalCorte"`
	MetrosCanto      float64  `json:"metrosCanto"`
	SubtotalCanto    float64  `json:"subtotalCanto"`
	Total            float64  `json:"total"`
	Faltan           []string `json:"faltan"`
}

func redondear(v float64) float64 { return jsmath.Round(float64(v*100)) / 100 }

// Presupuestar es presupuestarCorte: placa por placa, la que se vende entera
// cobra el material y la otra las pasadas; aparte, el tapacanto.
func Presupuestar(plano Plano, tarifa *TarifaDeCorte, precioPorPlaca *float64, piezas []PiezaPresupuestada, fraccion float64) PresupuestoDeCorte {
	enteras := plano.PlacasEnteras
	precio := 0.0
	if precioPorPlaca != nil {
		precio = *precioPorPlaca
	}
	sub := redondear(float64(float64(enteras)*precio) * fraccion)
	corte := CargoPorCorte(tarifa, float64(plano.PasadasCobrables))
	conCanto := make([]PiezaConCanto, len(piezas))
	for i, p := range piezas {
		conCanto[i] = PiezaConCanto{p.LargoMm, p.AnchoMm, p.Cantidad, p.CantoLargo, p.CantoAncho}
	}
	metros := MetrosDeTapacanto(conCanto)
	canto := CargoPorTapacanto(tarifa, metros)

	faltan := []string{}
	if len(plano.Placas) == 0 {
		faltan = append(faltan, "Cargá el despiece: sin piezas no hay plano ni precio.")
	}
	if n := len(plano.NoEntran); n > 0 {
		if n == 1 {
			faltan = append(faltan, "Hay una pieza que no entra en la placa.")
		} else {
			faltan = append(faltan, "Hay "+jsmath.Texto(float64(n))+" piezas que no entran en la placa.")
		}
	}
	if enteras > 0 && (precioPorPlaca == nil || *precioPorPlaca == 0 || math.IsNaN(*precioPorPlaca)) {
		faltan = append(faltan, "Falta el precio de la placa: sin eso no se puede cobrar el material.")
	}
	if len(plano.Placas)-enteras > 0 && tarifa == nil {
		faltan = append(faltan, "No hay tarifa de corte cargada para este material. Se configura en Cortes.")
	}
	pp := 0.0
	if tarifa != nil {
		pp = tarifa.PrecioPorPasada
	}
	return PresupuestoDeCorte{
		PlacasEnteras: enteras, Fraccion: fraccion, PrecioPorPlaca: precio, SubtotalPlacas: sub,
		PasadasCobrables: plano.PasadasCobrables, PrecioPorPasada: pp, SubtotalCorte: corte,
		MetrosCanto: metros, SubtotalCanto: canto, Total: redondear(sub + corte + canto), Faltan: faltan,
	}
}
