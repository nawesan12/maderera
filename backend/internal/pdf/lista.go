package pdf

import "time"

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
		if y < Margen+Mm(20) {
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

		h.Escribir(f.Sku, Opciones{X: Margen, Y: y, Tamano: 7.5, Fuente: Mono})
		h.Escribir(f.Producto, Opciones{X: Margen + Mm(28), Y: y, Tamano: 8})
		h.Escribir(f.Medida, Opciones{X: Margen + Mm(105), Y: y, Tamano: 8, Color: TintaSuave})
		// `fila.precio ? … : …`: la tira vacía también es «a consultar».
		if f.Precio != nil && *f.Precio != "" {
			h.Escribir(MonedaDe(*f.Precio), Opciones{X: derecha, Y: y, Tamano: 8.5, Fuente: Negrita, Derecha: true})
		} else {
			h.Escribir("a consultar", Opciones{X: derecha, Y: y, Tamano: 8.5, Color: TintaSuave, Derecha: true})
		}
		y -= renglonLista
	}

	y -= 6
	h.Raya(y, 0, Color{})
	h.Escribir(d.LeyendaIva+". Los precios pueden cambiar sin aviso; consultá vigencia antes de comprar.",
		Opciones{X: Margen, Y: y - 12, Tamano: 7.5, Color: TintaSuave})

	return h.Bytes()
}

func encabezadoLista(h *Hoja, y, derecha float64) float64 {
	h.Escribir("CÓDIGO", Opciones{X: Margen, Y: y, Tamano: 7, Color: TintaSuave})
	h.Escribir("PRODUCTO", Opciones{X: Margen + Mm(28), Y: y, Tamano: 7, Color: TintaSuave})
	h.Escribir("MEDIDA", Opciones{X: Margen + Mm(105), Y: y, Tamano: 7, Color: TintaSuave})
	h.Escribir("PRECIO", Opciones{X: derecha, Y: y, Tamano: 7, Color: TintaSuave, Derecha: true})
	siguiente := y - 5
	h.Raya(siguiente, 0, Color{})
	return siguiente - 12
}
