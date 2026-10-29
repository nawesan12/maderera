package pdf

import "time"

// El reporte de reposición en papel (lib/pdf/reposicion.ts): la hoja con la
// que se sale a comprar. Solo lo que tiene compra sugerida, en el orden en
// que llega (por urgencia).
//
// Espera a la tanda 5: los datos (lib/dal/admin/reposicion.ts) leen ventas.

// FilaDeReposicion tiene los campos de FilaDeReposicion del TS que usa el
// PDF; el resto del JSON se ignora.
type FilaDeReposicion struct {
	Producto             string  `json:"producto"`
	Medida               string  `json:"medida"`
	Rubro                *string `json:"rubro"`
	DisponibleCentral    float64 `json:"disponibleCentral"`
	DisponibleAserradero float64 `json:"disponibleAserradero"`
	Vendido              float64 `json:"vendido"`
	Sugerido             float64 `json:"sugerido"`
}

// ReporteDeReposicion es lo que recibe reposicionPdf.
type ReporteDeReposicion struct {
	Filas             []FilaDeReposicion `json:"filas"`
	DiasDelPeriodo    float64            `json:"diasDelPeriodo"`
	CoberturaObjetivo float64            `json:"coberturaObjetivo"`
}

// Reposicion arma el PDF. ahora es la fecha de emisión.
func Reposicion(r ReporteDeReposicion, ahora time.Time) ([]byte, error) {
	h := NuevaHoja()
	derecha := AnchoA4 - Margen

	y := AltoA4 - Margen - 6

	h.Escribir("Reposición sugerida", Opciones{X: Margen, Y: y, Tamano: 14, Fuente: Negrita})
	h.Escribir("Emitido el "+FechaCortaHoy(ahora), Opciones{X: derecha, Y: y, Tamano: 8, Color: TintaSuave, Derecha: true})
	y -= 13

	h.Escribir("Ventas de los últimos "+numeroJS(r.DiasDelPeriodo)+" días contra el stock disponible, para cubrir "+numeroJS(r.CoberturaObjetivo)+" días.",
		Opciones{X: Margen, Y: y, Tamano: 8.5, Color: TintaSuave})
	y -= Mm(7)

	var paraComprar []FilaDeReposicion
	for _, f := range r.Filas {
		if f.Sugerido > 0 {
			paraComprar = append(paraComprar, f)
		}
	}
	if len(paraComprar) == 0 {
		h.Escribir("Con el stock de hoy no hay nada urgente para comprar.", Opciones{X: Margen, Y: y, Tamano: 10})
		return h.Bytes()
	}

	colCentral := derecha - Mm(58)
	colAserradero := derecha - Mm(44)
	colVendido := derecha - Mm(30)
	colComprar := derecha

	encabezado := func(c float64) float64 {
		h.Escribir("PRODUCTO", Opciones{X: Margen, Y: c, Tamano: 6, Fuente: Negrita, Color: TintaSuave})
		for _, col := range []struct {
			x     float64
			texto string
		}{{colCentral, "CENTRAL"}, {colAserradero, "ASERR."}, {colVendido, "VENDIDO"}, {colComprar, "COMPRAR"}} {
			h.Escribir(col.texto, Opciones{X: col.x, Y: c, Tamano: 6, Fuente: Negrita, Color: TintaSuave, Derecha: true})
		}
		h.Raya(c-5, 1, Tinta)
		return c - 16
	}

	y = encabezado(y)

	for _, f := range paraComprar {
		if y < Margen+Mm(14) {
			h.NuevaPagina()
			y = encabezado(AltoA4 - Margen)
		}
		nombre := f.Producto + " — " + f.Medida
		if f.Rubro != nil && *f.Rubro != "" {
			nombre += " (" + *f.Rubro + ")"
		}
		if largoJS(nombre) > 68 {
			nombre = cortarJS(nombre, 67) + "…"
		}
		h.Escribir(nombre, Opciones{X: Margen, Y: y, Tamano: 8.5})

		for _, col := range []struct {
			x     float64
			valor float64
		}{{colCentral, f.DisponibleCentral}, {colAserradero, f.DisponibleAserradero}, {colVendido, f.Vendido}} {
			h.Escribir(numeroJS(col.valor), Opciones{X: col.x, Y: y, Tamano: 8.5, Fuente: Mono, Derecha: true})
		}
		h.Escribir(numeroJS(f.Sugerido), Opciones{X: colComprar, Y: y, Tamano: 9.5, Fuente: Negrita, Derecha: true})

		y -= 13
		h.Raya(y+6, 0, Color{})
	}

	h.EscribirCentrado("La compra sugerida sale del ritmo de venta del período; un producto estacional puede pedir de más o de menos.",
		AnchoA4/2, Opciones{Y: Margen, Tamano: 6.5, Color: TintaSuave})

	return h.Bytes()
}
