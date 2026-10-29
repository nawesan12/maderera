package campanas

import (
	"strconv"
	"testing"
)

// BenchmarkArmarCorreo es el trabajo de CPU de una tanda: el correo de cada
// destinatario (su enlace de baja firmado, el cuerpo a HTML y la plantilla).
// El mismo trabajo en TS: bench/tanda10/armar.ts.
func BenchmarkArmarCorreo(b *testing.B) {
	c := ParaArmar{Asunto: "Ofertas de noviembre", Cuerpo: "Hola\n\nEste mes:\n\n- **Fenólico** 18 mm\n- Pino cepillado\n\nMirá todo en https://mjbj.com.ar/catalogo.",
		BotonTexto: ptr("Ver el catálogo"), BotonURL: ptr("/catalogo"), ImagenURL: ptr("/subidas/promo.jpg")}
	b.ReportAllocs()
	for i := 0; b.Loop(); i++ {
		ArmarCorreo("https://mjbj.com.ar", "secreto-de-prueba-de-las-bajas-32-caracteres", c, "cliente"+strconv.Itoa(i)+"@bench.test", "Arq. Juan Pérez")
	}
}

func ptr(s string) *string { return &s }
