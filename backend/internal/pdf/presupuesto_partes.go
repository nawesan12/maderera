package pdf

import "mjbj/internal/jsmath"

// Lo que el presupuesto toma de otros módulos del TS. Son copias: cuando se
// muden la facturación (tanda 7) y las sucursales, se juntan con las suyas.

// Desagregado es Desagregado de lib/fiscal/impuestos.ts.
type Desagregado struct {
	Neto, Iva, Total, Alicuota float64
}

// Desagregar es desagregar de lib/fiscal/impuestos.ts: del precio final al
// neto y el IVA, con el IVA como diferencia para que las partes sumen el
// total. Golden en presupuesto_partes_test.go.
func Desagregar(precioFinal, alicuota float64) Desagregado {
	total := jsmath.Redondear2Eps(precioFinal)
	// `!alicuota || alicuota <= 0`: el NaN también cae acá.
	if alicuota != alicuota || alicuota <= 0 {
		return Desagregado{Neto: total, Iva: 0, Total: total, Alicuota: 0}
	}
	neto := jsmath.Redondear2Eps(total / (1 + alicuota/100))
	return Desagregado{Neto: neto, Iva: jsmath.Redondear2Eps(total - neto), Total: total, Alicuota: alicuota}
}

// sucursalesPublicadas son las de lib/sucursales.ts (SUCURSALES), con lo
// que imprime el pie del presupuesto.
var sucursalesPublicadas = []struct{ nombre, direccion, telefono string }{
	{"Casa Central", "Av. Juan B. Justo 4153, Mar del Plata", "223 590-3118"},
	{"Aserradero", "Diagonal Canosa 61, Mar del Plata", "223 506-0817"},
}
