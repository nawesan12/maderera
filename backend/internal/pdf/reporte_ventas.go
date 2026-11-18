package pdf

import (
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// El reporte de ventas en PDF (lib/pdf/reporte-ventas.ts): el total
// arriba, el margen si hay costos cargados y el detalle con su
// participación. Los renglones sin costo se dicen, no se cuentan como cero.
//
// Espera a la tanda 5 (ventas): los datos salen de lib/dal/admin/reportes.ts
// y lo arma app/admin/reportes/exportar (que con otro formato da el CSV).

// FilaDeReporte es FilaDeReporte de lib/dal/admin/reportes.ts.
type FilaDeReporte struct {
	Clave          string   `json:"clave"`
	Etiqueta       string   `json:"etiqueta"`
	Detalle        *string  `json:"detalle"`
	Cantidad       float64  `json:"cantidad"`
	Total          float64  `json:"total"`
	NetoVenta      float64  `json:"netoVenta"`
	Costo          *float64 `json:"costo"`
	LineasSinCosto float64  `json:"lineasSinCosto"`
	// NetoCosteado: la venta sin IVA de los renglones con costo, contra la
	// que se mide el margen (la misma cuenta que la pantalla y el CSV).
	NetoCosteado float64 `json:"netoCosteado"`
}

// DatosReporteVentas es lo que recibe reporteDeVentasPdf.
type DatosReporteVentas struct {
	Filas []FilaDeReporte `json:"filas"`
	// Titulo: por dónde está cortado («Por producto», «Por rubro»…).
	Titulo  string `json:"titulo"`
	Periodo string `json:"periodo"`
	// Filtros: lo que acota el reporte, ya escrito. Vacío es null.
	Filtros *string `json:"filtros"`
	Emisor  *Emisor `json:"emisor"`
	// Totales: los del período entero (reportes.TotalesDelReporte). Sin
	// ellos —los casos guardados del golden— se suman las filas.
	Totales *TotalesDelReporte `json:"totales,omitempty"`
}

// TotalesDelReporte son las cifras de la cabecera.
type TotalesDelReporte struct {
	Total          float64  `json:"total"`
	NetoVenta      float64  `json:"netoVenta"`
	NetoCosteado   float64  `json:"netoCosteado"`
	Costo          *float64 `json:"costo"`
	LineasSinCosto float64  `json:"lineasSinCosto"`
}

// ReporteDeVentas arma el PDF. ahora no se usa (el período viene escrito).
func ReporteDeVentas(d DatosReporteVentas, _ time.Time) ([]byte, error) {
	h := NuevaHoja()
	anchoUtil := AnchoA4 - Margen*2

	y := h.EncabezadoEmisor(d.Emisor, h.Y)

	h.Escribir("REPORTE DE VENTAS", Opciones{X: AnchoA4 - Margen, Y: h.Y, Tamano: 15, Fuente: Negrita, Derecha: true})
	h.Escribir(d.Titulo+" · "+d.Periodo, Opciones{X: AnchoA4 - Margen, Y: h.Y - 16, Tamano: 8, Color: TintaSuave, Derecha: true})
	if d.Filtros != nil && *d.Filtros != "" {
		h.Escribir(*d.Filtros, Opciones{X: AnchoA4 - Margen, Y: h.Y - 27, Tamano: 8, Color: TintaSuave, Derecha: true})
	}

	y -= 10
	h.Raya(y, 0, Color{})
	y -= 16

	// La cabecera es la del período entero: con el tope de filas de los
	// cortes, sumar las filas daba un total corto.
	t := TotalesDelReporte{}
	if d.Totales != nil {
		t = *d.Totales
	} else {
		costeadas, costoTotal := 0, 0.0
		for _, f := range d.Filas {
			t.Total = t.Total + f.Total
		}
		for _, f := range d.Filas {
			t.NetoVenta = t.NetoVenta + f.NetoVenta
			if f.Costo != nil {
				costeadas++
				t.NetoCosteado = t.NetoCosteado + f.NetoCosteado
			}
		}
		for _, f := range d.Filas {
			if f.Costo != nil {
				costoTotal = costoTotal + *f.Costo
			}
		}
		for _, f := range d.Filas {
			t.LineasSinCosto = t.LineasSinCosto + f.LineasSinCosto
		}
		if costeadas > 0 {
			t.Costo = &costoTotal
		}
	}
	total := t.Total

	cifras := [][2]string{{Moneda(total), "vendido, con IVA"}}
	if t.Costo != nil {
		base := t.NetoCosteado
		if base == 0 || base != base { // costeado || 1
			base = 1
		}
		cifras = append(cifras,
			[2]string{Moneda(t.NetoVenta), "neto sin IVA"},
			[2]string{Moneda(*t.Costo), "costo"},
			[2]string{numeroJS(jsmath.Round(((t.NetoCosteado-*t.Costo)/base)*100)) + "%", "margen sobre " + Moneda(t.NetoCosteado)},
		)
	}

	h.Pagina.DibujarRectangulo(Rectangulo{X: Margen, Y: y - Mm(11), Ancho: anchoUtil, Alto: Mm(13), Relleno: RGB(0.98, 0.97, 0.95)})

	anchoCifra := anchoUtil / float64(len(cifras))
	for i, c := range cifras {
		x := Margen + Mm(3) + float64(float64(i)*anchoCifra)
		h.Escribir(c[0], Opciones{X: x, Y: y - Mm(3), Tamano: 12, Fuente: Negrita})
		h.Escribir(c[1], Opciones{X: x, Y: y - Mm(8), Tamano: 7, Color: TintaSuave})
	}

	y -= Mm(18)

	// Lo vendido sin costo, en plata: el margen se mide sin eso.
	if sinCosto := t.NetoVenta - t.NetoCosteado; t.LineasSinCosto > 0 && sinCosto >= 0.5 {
		h.Escribir(Moneda(sinCosto)+" vendidos sin costo cargado, afuera del margen.",
			Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
		y -= 16
	}

	type columna struct {
		titulo  string
		ancho   float64
		derecha bool
	}
	columnas := []columna{
		{strings.Replace(d.Titulo, "Por ", "", 1), Mm(66), false},
		{"Cant.", Mm(18), true},
		{"Total", Mm(28), true},
		// El neto contra el que se mide el margen, para poder rehacerlo.
		{"Neto c/costo", Mm(24), true},
		{"Margen", Mm(26), true},
		{"Part.", Mm(16), true},
	}

	encabezado := func() {
		cx := Margen
		for _, c := range columnas {
			x := cx
			if c.derecha {
				x = cx + c.ancho
			}
			h.Escribir(Mayusculas(c.titulo), Opciones{X: x, Y: y, Tamano: 6.5, Color: TintaSuave, Derecha: c.derecha})
			cx += c.ancho
		}
		y -= 5
		h.Pagina.DibujarLinea(Linea{X1: Margen, Y1: y, X2: AnchoA4 - Margen, Y2: y, Grosor: 0.5, Color: ColorLinea})
		y -= 11
	}

	encabezado()

	for _, f := range d.Filas {
		if y < Margen+Mm(18) {
			h.NuevaPagina()
			y = AltoA4 - Margen
			encabezado()
		}
		margen, costeado := "—", "—"
		if f.Costo != nil {
			margen = Moneda(f.NetoCosteado - *f.Costo)
			costeado = Moneda(f.NetoCosteado)
		}
		participacion := "—"
		if total > 0 {
			participacion = numeroJS(jsmath.Round((f.Total/total)*100)) + "%"
		}
		celdas := []string{
			f.Etiqueta,
			intlUnDecimal(jsmath.Round(f.Cantidad), true),
			Moneda(f.Total),
			costeado,
			margen,
			participacion,
		}
		cx := Margen
		for i, celda := range celdas {
			c := columnas[i]
			x := cx
			if c.derecha {
				x = cx + c.ancho
			}
			h.Escribir(recortarReporte(celda, c.ancho-4), Opciones{X: x, Y: y, Tamano: 8, Color: Tinta, Derecha: c.derecha})
			cx += c.ancho
		}
		y -= 12
	}

	return h.Bytes()
}

// recortarReporte es recortar() del TS: saca de a dos unidades de UTF-16
// hasta que el texto entra, y le pone «…».
//
// El TS mide el texto crudo con pdf-lib, que tira un error si hay un
// carácter fuera de WinAnsi (un emoji en el nombre de un producto voltea la
// descarga entera). Acá Ancho no cuenta esos caracteres —que igual Limpiar
// borra al escribir— y el reporte sale.
func recortarReporte(texto string, ancho float64) string {
	recortado := texto
	for largoJS(recortado) > 3 && Normal.Ancho(recortado, 8) > ancho {
		recortado = cortarJS(recortado, largoJS(recortado)-2)
	}
	if recortado == texto {
		return texto
	}
	return recortado + "…"
}
