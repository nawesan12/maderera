package pdf

import (
	"strconv"
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// El reporte del trabajo de corte (lib/pdf/corte.ts): la cabecera del
// trabajo, los números (placas, pasadas, aprovechado, lo que se lleva el
// disco), la tabla de piezas placa por placa y la de sobrantes con de quién
// es cada recorte. Documento de taller: puede crecer a varias hojas.
//
// Espera a la tanda 11 (cortes): hoy lo arma app/api/cortes/[id]/pdf.

// CorteParaPdf es CorteParaPdf del TS.
type CorteParaPdf struct {
	Numero           string    `json:"numero"`
	Cliente          string    `json:"cliente"`
	Material         string    `json:"material"`
	CantoDescripcion *string   `json:"cantoDescripcion"`
	DeQueSale        string    `json:"deQueSale"`
	CreatedAt        time.Time `json:"createdAt"`
	MetrosCanto      float64   `json:"metrosCanto"`
}

// DatosCorte son los tres argumentos de cortePdf(corte, plano, emisor).
type DatosCorte struct {
	Corte  CorteParaPdf `json:"corte"`
	Plano  PlanoDeCorte `json:"plano"`
	Emisor *Emisor      `json:"emisor"`
}

// Corte arma el reporte del corte. ahora no se usa (la fecha es la del
// trabajo); está por la firma común de los documentos.
func Corte(d DatosCorte, _ time.Time) ([]byte, error) {
	corte, plano := d.Corte, d.Plano
	h := NuevaHoja()
	anchoUtil := AnchoA4 - Margen*2

	y := h.EncabezadoEmisor(d.Emisor, h.Y)

	h.Escribir("REPORTE DE CORTE", Opciones{X: AnchoA4 - Margen, Y: h.Y, Tamano: 15, Fuente: Negrita, Derecha: true})
	h.Escribir(corte.Numero, Opciones{X: AnchoA4 - Margen, Y: h.Y - 16, Tamano: 11, Fuente: Mono, Derecha: true})
	h.Escribir(FechaLocal(corte.CreatedAt), Opciones{X: AnchoA4 - Margen, Y: h.Y - 28, Tamano: 8, Color: TintaSuave, Derecha: true})

	y -= 10
	h.Raya(y, 0, Color{})
	y -= 16

	tapacanto := "Sin tapacanto"
	if corte.CantoDescripcion != nil && *corte.CantoDescripcion != "" {
		tapacanto = *corte.CantoDescripcion
	}
	for _, par := range [][2]string{
		{"Cliente", corte.Cliente},
		{"Material", corte.Material},
		{"De qué sale", corte.DeQueSale + " de " + numeroJS(plano.PlacaLargo) + " × " + numeroJS(plano.PlacaAncho) + " mm"},
		{"Tapacanto", tapacanto},
	} {
		h.Escribir(par[0], Opciones{X: Margen, Y: y, Tamano: 7.5, Color: TintaSuave})
		h.Escribir(par[1], Opciones{X: Margen + Mm(28), Y: y, Tamano: 9.5, Fuente: Negrita})
		y -= 14
	}

	y -= 6

	sierra := 0.0
	for _, placa := range plano.Placas {
		sierra = sierra + superficieDeSierra(placa, plano.AnchoSierra)
	}

	placas := "placas"
	if len(plano.Placas) == 1 {
		placas = "placa"
	}
	aprovechado := numeroJS(jsmath.Round(plano.AprovechadoTotal*100)) + "%"
	cifras := [][2]string{
		{strconv.Itoa(len(plano.Placas)), placas},
		{numeroJS(plano.TotalPiezas), "piezas"},
		{numeroJS(plano.Pasadas), "pasadas"},
		{aprovechado, "aprovechado"},
		{formatearSierra(plano.AnchoSierra), "se lleva la sierra"},
		{metrosCorte(corte.MetrosCanto) + " m", "de tapacanto"},
	}

	anchoCifra := anchoUtil / float64(len(cifras))
	h.Pagina.DibujarRectangulo(Rectangulo{X: Margen, Y: y - Mm(11), Ancho: anchoUtil, Alto: Mm(13), Relleno: RGB(0.98, 0.97, 0.95)})

	for i, c := range cifras {
		x := Margen + Mm(3) + float64(float64(i)*anchoCifra)
		h.Escribir(c[0], Opciones{X: x, Y: y - Mm(3), Tamano: 12, Fuente: Negrita})
		h.Escribir(c[1], Opciones{X: x, Y: y - Mm(8), Tamano: 7, Color: TintaSuave})
	}

	y -= Mm(18)

	if n := len(plano.NoEntran); n > 0 {
		cuantas := strconv.Itoa(n) + " piezas no entran"
		if n == 1 {
			cuantas = "Una pieza no entra"
		}
		medidas := make([]string, n)
		for i, p := range plano.NoEntran {
			medidas[i] = numeroJS(p.LargoMm) + " × " + numeroJS(p.AnchoMm) + " mm"
		}
		h.Escribir(cuantas+" en la placa: "+strings.Join(medidas, ", "), Opciones{X: Margen, Y: y, Tamano: 9, Fuente: Negrita, Color: Naranja})
		y -= 16
	}

	var piezas [][]string
	for _, placa := range plano.Placas {
		for i, p := range placa.Piezas {
			girada := ""
			if p.Girada {
				girada = " (girada)"
			}
			etiqueta := "—"
			if p.Etiqueta != nil && *p.Etiqueta != "" {
				etiqueta = *p.Etiqueta
			}
			piezas = append(piezas, []string{
				numeroJS(placa.Numero),
				strconv.Itoa(i + 1),
				numeroJS(p.Ancho) + " × " + numeroJS(p.Alto) + " mm" + girada,
				numeroJS(p.LargoOriginal) + " × " + numeroJS(p.AnchoOriginal) + " mm",
				etiqueta,
				"x " + numeroJS(p.X) + " · y " + numeroJS(p.Y),
			})
		}
	}
	y = corteTabla(h, y, "Piezas", []string{"Placa", "N.º", "Sobre la placa", "Como se pidió", "Etiqueta", "Posición"}, piezas)

	y -= 10

	var sobrantes [][]string
	for _, placa := range plano.Placas {
		if len(placa.Recortes) == 0 {
			sobrantes = append(sobrantes, []string{numeroJS(placa.Numero), "—", "Sin pedazos enteros que valga guardar", "—", "—"})
			continue
		}
		deQuien := "Al stock"
		if placa.SeVendeEntera {
			deQuien = "Del cliente"
		}
		for i, r := range placa.Recortes {
			sobrantes = append(sobrantes, []string{
				numeroJS(placa.Numero),
				strconv.Itoa(i + 1),
				numeroJS(r.Ancho) + " × " + numeroJS(r.Alto) + " mm",
				metrosCorte((r.Ancho * r.Alto) / 1_000_000),
				deQuien,
			})
		}
	}
	y = corteTabla(h, y, "Sobrantes", []string{"Placa", "N.º", "Medida", "m²", "De quién es"}, sobrantes)

	y -= 14

	pasadas := "pasadas"
	if plano.Pasadas == 1 {
		pasadas = "pasada"
	}
	h.EscribirParrafo("De lo comprado, el "+aprovechado+" sale en piezas. La sierra se come "+metrosCorte(sierra/1_000_000)+" m² en "+numeroJS(plano.Pasadas)+" "+pasadas+" de "+formatearSierra(plano.AnchoSierra)+", y el resto queda en los sobrantes de la tabla. De una placa que se vende entera el recorte es del cliente y se va con él; de una que se cobró por corte, vuelve al stock.",
		Parrafo{Opciones: Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave}, Ancho: anchoUtil})

	return h.Bytes()
}

// corteTabla es tabla() de lib/pdf/corte.ts: con encabezado, y abre hoja
// nueva cuando se acaba el papel.
func corteTabla(h *Hoja, desde float64, titulo string, columnas []string, filas [][]string) float64 {
	anchoUtil := AnchoA4 - Margen*2
	anchoColumna := anchoUtil / float64(len(columnas))
	y := desde

	encabezado := func() {
		h.Escribir(titulo, Opciones{X: Margen, Y: y, Tamano: 10, Fuente: Negrita})
		y -= 13
		for i, c := range columnas {
			h.Escribir(Mayusculas(c), Opciones{X: Margen + float64(float64(i)*anchoColumna), Y: y, Tamano: 6.5, Color: TintaSuave})
		}
		y -= 5
		h.Pagina.DibujarLinea(Linea{X1: Margen, Y1: y, X2: AnchoA4 - Margen, Y2: y, Grosor: 0.5, Color: ColorLinea})
		y -= 11
	}

	encabezado()

	for _, fila := range filas {
		if y < Margen+Mm(18) {
			h.NuevaPagina()
			y = AltoA4 - Margen
			encabezado()
		}
		for i, celda := range fila {
			h.Escribir(celda, Opciones{X: Margen + float64(float64(i)*anchoColumna), Y: y, Tamano: 8, Color: Tinta})
		}
		y -= 12
	}
	return y
}
