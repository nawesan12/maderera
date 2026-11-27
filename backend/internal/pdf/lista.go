package pdf

import (
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// La lista de precios en PDF (lib/pdf/lista-precios.ts): la que baja el
// profesional desde /mi-lista-de-precios y la que exporta el panel. Lleva la
// fecha en grande y el aviso de vigencia: los precios se mueven todas las
// semanas y una lista sin fecha reenviada tres meses después es una
// discusión asegurada en el mostrador.

// FilaDeLista es un renglón de la lista. Precio nil es «a consultar».
type FilaDeLista struct {
	Sku       string  `json:"sku"`
	Producto  string  `json:"producto"`
	Medida    string  `json:"medida"`
	Categoria string  `json:"categoria"`
	Precio    *string `json:"precio"`
}

// DatosLista es lo que recibe pdfDeListaDePrecios.
type DatosLista struct {
	Titulo string        `json:"titulo"`
	Filas  []FilaDeLista `json:"filas"`
	Emisor *Emisor       `json:"emisor"`
	// LeyendaIva: «Precios finales con IVA» o «Precios netos, sin IVA».
	LeyendaIva string `json:"leyendaIva"`
}

const renglonLista = 14

// Las columnas de la lista, desde el margen. El producto y la medida bajan
// de renglón dentro de la suya; el código, que no tiene espacios, se achica
// y si hace falta se corta. Antes un nombre largo se metía debajo de la
// medida y del precio.
var (
	listaColProducto = Mm(28)
	listaColMedida   = Mm(105)
	listaAnchoSku    = Mm(26)
	listaAnchoProd   = Mm(75)
	listaAnchoMedida = Mm(48)
	listaInterlinea  = 10.0
)

// TituloDeLista es «Lista profesional» a partir del nombre de la lista: si
// el nombre ya empieza con «Lista», no se repite (mes simulado, M2S3-093:
// «Lista Lista profesional»).
func TituloDeLista(nombre string) string {
	n := strings.TrimSpace(nombre)
	if strings.HasPrefix(strings.ToLower(n), "lista") {
		return n
	}
	return "Lista " + n
}

// ListaDePrecios arma el PDF de la lista. ahora es la fecha de vigencia.
func ListaDePrecios(d DatosLista, ahora time.Time) ([]byte, error) {
	h := NuevaHoja()
	derecha := AnchoA4 - Margen

	y := h.EncabezadoEmisor(d.Emisor, h.Y)

	h.Escribir(d.Titulo, Opciones{X: derecha, Y: h.Y, Tamano: 13, Fuente: Negrita, Derecha: true})
	h.Escribir("Vigente al "+FechaLocal(ahora), Opciones{X: derecha, Y: h.Y - 15, Tamano: 9, Derecha: true})

	y -= 8
	h.Raya(y, 0, Color{})
	y -= 14

	y = encabezadoLista(h, y, derecha)

	// Agrupado por categoría: una lista de mil renglones de ferretería sin
	// separaciones no se puede recorrer con el dedo.
	categoria := ""
	for _, f := range d.Filas {
		producto := Renglones(f.Producto, Normal, 8, listaAnchoProd)
		medida := Renglones(f.Medida, Normal, 8, listaAnchoMedida)
		extra := float64(max(len(producto), len(medida), 1)-1) * listaInterlinea
		if y-extra < Margen+Mm(20) {
			h.NuevaPagina()
			y = AltoA4 - Margen
			y = encabezadoLista(h, y, derecha)
			categoria = ""
		}
		if f.Categoria != categoria {
			categoria = f.Categoria
			y -= 4
			h.Escribir(Mayusculas(categoria), Opciones{X: Margen, Y: y, Tamano: 8, Fuente: Negrita})
			y -= renglonLista
		}

		h.EscribirEnAncho(f.Sku, Opciones{X: Margen, Y: y, Tamano: 7.5, Fuente: Mono}, listaAnchoSku)
		h.EscribirParrafo(f.Producto, Parrafo{Opciones: Opciones{X: Margen + listaColProducto, Y: y, Tamano: 8}, Ancho: listaAnchoProd, Interlineado: listaInterlinea})
		h.EscribirParrafo(f.Medida, Parrafo{Opciones: Opciones{X: Margen + listaColMedida, Y: y, Tamano: 8, Color: TintaSuave}, Ancho: listaAnchoMedida, Interlineado: listaInterlinea})
		// `fila.precio ? … : …`: la tira vacía también es «a consultar». La
		// lista va en pesos redondos a propósito (Moneda, no Moneda2): es
		// para consultar precios, no un importe a pagar.
		// En cero tampoco es un precio: la escalera a medida salía a «$0»
		// (M2S3-093).
		if f.Precio != nil && *f.Precio != "" && jsmath.Numero(*f.Precio) > 0 {
			h.EscribirNumero(MonedaDe(*f.Precio), Opciones{X: derecha, Y: y, Tamano: 8.5, Fuente: Negrita, Derecha: true}, Mm(27))
		} else {
			h.Escribir("a consultar", Opciones{X: derecha, Y: y, Tamano: 8.5, Color: TintaSuave, Derecha: true})
		}
		y -= renglonLista + extra
	}

	y -= 6
	h.Raya(y, 0, Color{})
	h.Escribir(d.LeyendaIva+". Los precios pueden cambiar sin aviso; consultá vigencia antes de comprar.",
		Opciones{X: Margen, Y: y - 12, Tamano: 7.5, Color: TintaSuave})

	return h.Bytes()
}

func encabezadoLista(h *Hoja, y, derecha float64) float64 {
	h.Escribir("CÓDIGO", Opciones{X: Margen, Y: y, Tamano: 7, Color: TintaSuave})
	h.Escribir("PRODUCTO", Opciones{X: Margen + listaColProducto, Y: y, Tamano: 7, Color: TintaSuave})
	h.Escribir("MEDIDA", Opciones{X: Margen + listaColMedida, Y: y, Tamano: 7, Color: TintaSuave})
	h.Escribir("PRECIO", Opciones{X: derecha, Y: y, Tamano: 7, Color: TintaSuave, Derecha: true})
	siguiente := y - 5
	h.Raya(siguiente, 0, Color{})
	return siguiente - 12
}
