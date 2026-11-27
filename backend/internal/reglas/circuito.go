package reglas

import (
	"context"
	"strings"
)

// Cómo se nombra el circuito sin factura (regla etiqueta_del_circuito,
// H167): «B» se lee como la Factura B. La regla solo cambia la palabra en
// las pantallas, los mensajes y la bitácora; el valor guardado («negro»), el
// nombre del archivo de asientos y CircuitoDelCheque no cambian.

// EtiquetaCorta es cómo se rotula el circuito sin factura en un chip o un
// filtro: «B», «Sin factura» o «Interno».
func EtiquetaCorta(valor string) string {
	switch valor {
	case "sin_factura":
		return "Sin factura"
	case "interno":
		return "Interno"
	}
	return "B"
}

// EnUnaFrase es cómo se dice en una oración: «circuito B», «circuito sin
// factura» o «circuito interno».
func EnUnaFrase(valor string) string {
	switch valor {
	case "sin_factura":
		return "circuito sin factura"
	case "interno":
		return "circuito interno"
	}
	return "circuito B"
}

// Circuito lee la regla y devuelve la frase («circuito B»…).
func Circuito(ctx context.Context, c Consultador) string {
	v, err := Valor(ctx, c, EtiquetaDelCircuito)
	if err != nil {
		v = Arranque(EtiquetaDelCircuito)
	}
	return EnUnaFrase(v)
}

// CircuitoCorto lee la regla y devuelve el rótulo («B»…).
func CircuitoCorto(ctx context.Context, c Consultador) string {
	v, err := Valor(ctx, c, EtiquetaDelCircuito)
	if err != nil {
		v = Arranque(EtiquetaDelCircuito)
	}
	return EtiquetaCorta(v)
}

// EnElTexto cambia «circuito B» y «el B»/«al B»/«del B» de un texto armado
// con la palabra de arranque por la que eligió la regla. Con «b» lo deja
// igual.
func EnElTexto(texto, valor string) string {
	if valor == "" || valor == "b" {
		return texto
	}
	frase := EnUnaFrase(valor)
	r := strings.NewReplacer(
		"circuito B", frase,
		// «van al archivo B» (mes simulado, M2S2-031).
		"archivo B", "archivo del "+frase,
		" el B ", " el "+frase+" ", " el B:", " el "+frase+":", " el B.", " el "+frase+".",
		" al B ", " al "+frase+" ", " al B.", " al "+frase+".", " al B:", " al "+frase+":",
		" del B ", " del "+frase+" ", " del B.", " del "+frase+".",
	)
	return r.Replace(texto)
}
