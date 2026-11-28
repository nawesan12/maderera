package cortes

// Los tapacantos del catálogo para el armador del sitio, y la medida de la
// placa escrita siempre igual (revisión de un carpintero en /corte, 18/11).

import (
	"context"
	"regexp"
	"strconv"
	"strings"

	"mjbj/internal/jsmath"
)

// Tapacanto es una variante de tapacanto del catálogo, para elegirla en el
// armador. Sin precio a propósito: lo que se cobra es el pegado por metro
// (la tarifa de la placa), y así la lista sirve igual con la tienda apagada.
type Tapacanto struct {
	VariantID   string   `json:"variantId"`
	Descripcion string   `json:"descripcion"`
	Color       *string  `json:"color"`
	EspesorMm   *float64 `json:"espesorMm"`
	// Tipo es «PVC», «Melamínico» o «ABS»; nulo si el catálogo no lo dice.
	Tipo *string `json:"tipo"`
}

// Tapacantos son las variantes activas del rubro «Tapacantos» o cuyo
// producto se llama así. El rubro es como los ordena el catálogo
// (seed-negocio), pero hay productos que solo lo tienen en el nombre o en el
// texto viejo de `subcategory`, y dejarlos afuera es mostrar un desplegable
// incompleto.
func (s *Servicio) Tapacantos(ctx context.Context) ([]Tapacanto, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT pv.id::text, p.name, pv.label, pv.color, pv.material, pv.espesor_mm
		FROM product_variants pv
		JOIN products p ON p.id = pv.product_id
		LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
		WHERE p.active AND pv.active AND (
			f_unaccent(coalesce(sc.name, '')) ILIKE '%tapacanto%'
			OR f_unaccent(coalesce(p.subcategory, '')) ILIKE '%tapacanto%'
			OR f_unaccent(p.name) ILIKE '%tapacanto%')
		ORDER BY p.name ASC, pv.sort_order ASC, pv.label ASC`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Tapacanto{}
	for filas.Next() {
		var t Tapacanto
		var producto, etiqueta string
		var material *string
		var espesor *int32
		if err := filas.Scan(&t.VariantID, &producto, &etiqueta, &t.Color, &material, &espesor); err != nil {
			return nil, err
		}
		t.Descripcion = strings.TrimSpace(producto + " — " + etiqueta)
		if etiqueta == "" {
			t.Descripcion = producto
		}
		texto := producto + " " + etiqueta
		if material != nil {
			texto += " " + *material
		}
		t.EspesorMm = EspesorDeTapacanto(texto, espesor)
		t.Tipo = TipoDeTapacanto(texto)
		out = append(out, t)
	}
	return out, filas.Err()
}

// reEspesorCanto es un número con «mm» detrás: «0,45 mm», «2mm», «0.45mm».
var reEspesorCanto = regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*mm\b`)

// reEspesorCantoSuelto es el espesor fino escrito sin unidad: «0,45», «0.8».
var reEspesorCantoSuelto = regexp.MustCompile(`\b0[.,]\d{1,2}\b`)

// EspesorDeTapacanto lee el espesor del texto de la variante. El campo
// `espesor_mm` es entero y no guarda 0,45, así que manda el texto; el campo
// vale cuando el texto no dice nada. Más de 3 mm no es un espesor de
// tapacanto sino el ancho del rollo («22 mm»), y se ignora.
func EspesorDeTapacanto(texto string, campo *int32) *float64 {
	for _, m := range reEspesorCanto.FindAllStringSubmatch(texto, -1) {
		if n := jsmath.Numero(strings.ReplaceAll(m[1], ",", ".")); n > 0 && n <= 3 {
			return &n
		}
	}
	if m := reEspesorCantoSuelto.FindString(texto); m != "" {
		if n, err := strconv.ParseFloat(strings.ReplaceAll(m, ",", "."), 64); err == nil && n > 0 {
			return &n
		}
	}
	if campo != nil && *campo > 0 && *campo <= 3 {
		n := float64(*campo)
		return &n
	}
	return nil
}

var (
	rePVC        = regexp.MustCompile(`(?i)\bpvc\b`)
	reABS        = regexp.MustCompile(`(?i)\babs\b`)
	reMelaminico = regexp.MustCompile(`(?i)melam`)
)

// TipoDeTapacanto dice de qué es, si el texto lo nombra.
func TipoDeTapacanto(texto string) *string {
	var t string
	switch {
	case rePVC.MatchString(texto):
		t = "PVC"
	case reABS.MatchString(texto):
		t = "ABS"
	case reMelaminico.MatchString(texto):
		t = "Melamínico"
	default:
		return nil
	}
	return &t
}

// reMedidaDePlaca es «1220 x 2440mm» o «2750 × 1830» dentro de la etiqueta.
var reMedidaDePlaca = regexp.MustCompile(`(\d{3,5})\s*[xX×]\s*(\d{3,5})(\s*mm)?`)

// MedidaEnOrden reescribe la medida de la etiqueta como largo × ancho mm.
// Las etiquetas vienen cargadas como «1220 x 2440mm» (ancho primero, como se
// dice en el mostrador) y el plano dice 2440 × 1220: el carpintero veía dos
// órdenes en la misma pantalla. Solo se toca la medida que coincide con la
// de la variante; cualquier otro texto queda igual.
func MedidaEnOrden(etiqueta string, largo, ancho int32) string {
	if largo <= 0 || ancho <= 0 {
		return etiqueta
	}
	l, a := strconv.Itoa(int(largo)), strconv.Itoa(int(ancho))
	hecho := false
	return reMedidaDePlaca.ReplaceAllStringFunc(etiqueta, func(m string) string {
		if hecho {
			return m
		}
		p := reMedidaDePlaca.FindStringSubmatch(m)
		if (p[1] == l && p[2] == a) || (p[1] == a && p[2] == l) {
			hecho = true
			return l + " × " + a + " mm"
		}
		return m
	})
}

// MaterialEnOrden es el material de un corte del catálogo con la medida
// escrita como la da el sitio («Melamina Blanca — 2600 × 1830 mm — 18mm»):
// el panel guardaba la etiqueta de la variante («1830 x 2600mm») y el sitio
// la medida en orden, así que la misma placa salía con dos nombres en la
// cola, el archivo de la máquina y los materiales del PTX (mes simulado,
// M2S1-063). Se arregla al leer: lo guardado antes también sale igual.
//
// Sin variante —la placa la trae el cliente, o el corte es de antes— la
// etiqueta se copió igual del buscador («MDF — 1830 x 2600mm — 18mm») y
// salía distinta de la misma placa del catálogo (M2S3-067): la primera
// medida se escribe con el lado largo primero, que es el orden del sitio.
func MaterialEnOrden(material string, largo, ancho *int32) string {
	if largo != nil && ancho != nil && *largo > 0 && *ancho > 0 {
		l, a := strconv.Itoa(int(*largo)), strconv.Itoa(int(*ancho))
		for _, p := range reMedidaDePlaca.FindAllStringSubmatch(material, -1) {
			if (p[1] == l && p[2] == a) || (p[1] == a && p[2] == l) {
				return MedidaEnOrden(material, *largo, *ancho)
			}
		}
	}
	return LadoLargoPrimero(material)
}

// LadoLargoPrimero reescribe la primera medida de placa de la etiqueta como
// «largo × ancho mm», el lado mayor primero.
func LadoLargoPrimero(etiqueta string) string {
	p := reMedidaDePlaca.FindStringSubmatch(etiqueta)
	if p == nil {
		return etiqueta
	}
	a, errA := strconv.Atoi(p[1])
	b, errB := strconv.Atoi(p[2])
	if errA != nil || errB != nil {
		return etiqueta
	}
	if b > a {
		a, b = b, a
	}
	return MedidaEnOrden(etiqueta, int32(a), int32(b))
}
