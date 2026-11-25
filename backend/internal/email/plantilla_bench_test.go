package email

import (
	"strconv"
	"strings"
	"testing"
)

// Un correo de campaña con una tabla larga: el Replacer de Escapar se armaba
// en cada llamada (una por dato y por renglón).
func BenchmarkEnvolver(b *testing.B) {
	o := Opciones{
		Titulo: "Ofertas de noviembre", Adelanto: "Placas y molduras", Saludo: "Hola, Marta:",
		Parrafos: []string{"Estas son las <strong>ofertas</strong> de la semana."},
		CTA:      &Enlace{Texto: "Ver las ofertas", URL: "https://mjbj.com.ar/catalogo?ofertas=1"},
		Cierre:   "Gracias por elegirnos.",
	}
	for i := range 200 {
		o.Datos = append(o.Datos, Bloque{Etiqueta: "Producto " + strconv.Itoa(i), Valor: strings.Repeat("Melamina <18 mm> & \"blanca\" ", 2)})
		imp := float64(1000 + i)
		o.Lineas = append(o.Lineas, LineaCorreo{Descripcion: "Fenólico 18 mm & film", Cantidad: "3", Unidad: "placa", Importe: &imp})
	}
	b.ReportAllocs()
	for b.Loop() {
		_, _ = Envolver("https://mjbj.com.ar", o)
	}
}
