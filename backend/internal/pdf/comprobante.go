package pdf

import (
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// El comprobante fiscal en PDF (lib/pdf/comprobante.ts): la letra en
// recuadro al centro, el IVA discriminado solo en la A, el QR únicamente
// cuando hay CAE y la marca de agua cuando no la hay. Lo que cambió desde el
// TS, a propósito: en la B y la C el precio unitario es el final, y la B a
// consumidor final lleva la leyenda de la ley 27.743.
//
// Espera a la tanda 7 (facturación ARCA): hoy lo llaman
// app/api/comprobantes/[id]/pdf/route.ts, lib/notificaciones/fiscal.ts y
// lib/whatsapp/documentos.ts, con los datos de lib/fiscal.

// ItemComprobante es un renglón del detalle. Los importes llegan como texto
// (numeric de la base).
type ItemComprobante struct {
	Descripcion    string `json:"descripcion"`
	Unidad         string `json:"unidad"`
	Cantidad       string `json:"cantidad"`
	PrecioUnitario string `json:"precioUnitario"`
	AlicuotaIva    string `json:"alicuotaIva"`
	Subtotal       string `json:"subtotal"`
}

// TributoComprobante es una percepción u otro tributo.
type TributoComprobante struct {
	Descripcion string `json:"descripcion"`
	Alicuota    string `json:"alicuota"`
	Importe     string `json:"importe"`
}

// ComprobantePdf es la interfaz ComprobantePdf del TS. Los null de texto
// valen lo mismo que la tira vacía (el TS los usa como falsos).
type ComprobantePdf struct {
	Tipo                 string               `json:"tipo"`
	PuntoVenta           float64              `json:"puntoVenta"`
	Numero               float64              `json:"numero"`
	ReceptorNombre       string               `json:"receptorNombre"`
	ReceptorCuit         string               `json:"receptorCuit"`
	ReceptorCondicionIva string               `json:"receptorCondicionIva"`
	ReceptorDomicilio    string               `json:"receptorDomicilio"`
	Neto                 string               `json:"neto"`
	Iva21                string               `json:"iva21"`
	Iva27                string               `json:"iva27"`
	Iva105               string               `json:"iva105"`
	Exento               string               `json:"exento"`
	TributosTotal        string               `json:"tributosTotal"`
	Total                string               `json:"total"`
	Cae                  string               `json:"cae"`
	CaeVencimiento       *time.Time           `json:"caeVencimiento"`
	FechaEmision         time.Time            `json:"fechaEmision"`
	FechaVencimiento     *time.Time           `json:"fechaVencimiento"`
	Observaciones        string               `json:"observaciones"`
	Estado               string               `json:"estado"`
	Items                []ItemComprobante    `json:"items"`
	Tributos             []TributoComprobante `json:"tributos"`
}

// EmisorFiscal es el emisor del comprobante: el del encabezado más los
// datos fiscales.
type EmisorFiscal struct {
	Emisor
	IngresosBrutos    string     `json:"ingresosBrutos"`
	InicioActividades *time.Time `json:"inicioActividades"`
}

// DatosComprobante son los dos argumentos de comprobantePdf.
type DatosComprobante struct {
	Comprobante ComprobantePdf `json:"comprobante"`
	Emisor      *EmisorFiscal  `json:"emisor"`
}

var condicionesComprobante = map[string]string{
	"responsable_inscripto": "Responsable inscripto",
	"monotributista":        "Responsable monotributo",
	"exento":                "IVA exento",
	"consumidor_final":      "Consumidor final",
	"no_categorizado":       "No categorizado",
}

// comprobanteLetra es letraDe: la última letra del tipo, en mayúscula.
func comprobanteLetra(tipo string) string {
	if tipo == "" {
		return ""
	}
	return strings.ToUpper(tipo[len(tipo)-1:])
}

// comprobanteNombre es nombreComprobante.
func comprobanteNombre(tipo string) string {
	l := comprobanteLetra(tipo)
	switch {
	case strings.HasPrefix(tipo, "nota_credito"):
		return "Nota de crédito " + l
	case strings.HasPrefix(tipo, "nota_debito"):
		return "Nota de débito " + l
	}
	return "Factura " + l
}

// rellenarJS es String(n).padStart(largo, "0").
func rellenarJS(n float64, largo int) string {
	s := numeroJS(n)
	for len(s) < largo {
		s = "0" + s
	}
	return s
}

// comprobanteNumero es numeroFormateado: «0003-00000127».
func comprobanteNumero(puntoVenta, numero float64) string {
	return rellenarJS(puntoVenta, 4) + "-" + rellenarJS(numero, 8)
}

// precioImpreso es el precio unitario del renglón. En la A, el neto (el IVA
// va en su columna); en la B y la C, que no discriminan, el final con IVA,
// el mismo que da el subtotal impreso. El TS imprimía el neto en todas: en
// la B, precio por cantidad no daba el subtotal.
func precioImpreso(item ItemComprobante, discrimina bool) string {
	if discrimina {
		return MonedaDe(item.PrecioUnitario)
	}
	cantidad := jsmath.Numero(item.Cantidad)
	if !(cantidad > 0) {
		return MonedaDe(item.PrecioUnitario)
	}
	return Moneda(jsmath.Numero(item.Subtotal) / cantidad)
}

// Comprobante arma el PDF del comprobante fiscal.
func Comprobante(d DatosComprobante, _ time.Time) ([]byte, error) {
	c := d.Comprobante
	var emisor *Emisor
	if d.Emisor != nil {
		emisor = &d.Emisor.Emisor
	}
	h := NuevaHoja()
	derecha := AnchoA4 - Margen
	discrimina := comprobanteLetra(c.Tipo) == "A"
	num := jsmath.Numero

	marcas := func() {
		if c.Cae == "" {
			h.MarcaDeAgua("Sin valor fiscal")
		}
		if c.Estado == "anulada" {
			h.MarcaDeAgua("Anulada")
		}
	}
	marcas()

	// Emisor
	y := AltoA4 - Margen - 10
	finEmisor := h.EncabezadoEmisor(emisor, y)

	if d.Emisor != nil && d.Emisor.IngresosBrutos != "" {
		h.Escribir("Ingresos Brutos "+d.Emisor.IngresosBrutos, Opciones{X: Margen, Y: finEmisor, Tamano: 7.5, Color: TintaSuave})
	}

	// La letra, en recuadro al centro.
	anchoCaja := Mm(18)
	altoCaja := Mm(16)
	xCaja := (AnchoA4 - anchoCaja) / 2
	yCaja := AltoA4 - Margen - altoCaja - 4

	h.Recuadro(xCaja, yCaja, anchoCaja, altoCaja, 1.5, Color{})
	h.EscribirCentrado(comprobanteLetra(c.Tipo), xCaja+anchoCaja/2, Opciones{Y: yCaja + Mm(5.5), Tamano: 26, Fuente: Negrita})
	h.EscribirCentrado("COMPROBANTE", xCaja+anchoCaja/2, Opciones{Y: yCaja + Mm(2), Tamano: 5, Color: TintaSuave})

	// Numeración y fechas
	y = AltoA4 - Margen - 10
	h.Escribir(comprobanteNombre(c.Tipo), Opciones{X: derecha, Y: y, Tamano: 11, Fuente: Negrita, Derecha: true})
	y -= 15
	h.Escribir(comprobanteNumero(c.PuntoVenta, c.Numero), Opciones{X: derecha, Y: y, Tamano: 13, Fuente: Mono, Derecha: true})
	y -= 13
	h.Escribir("Fecha "+FechaSolaCorta(c.FechaEmision), Opciones{X: derecha, Y: y, Tamano: 7.5, Color: TintaSuave, Derecha: true})
	y -= 10
	if c.FechaVencimiento != nil {
		h.Escribir("Vencimiento "+FechaSolaCorta(*c.FechaVencimiento), Opciones{X: derecha, Y: y, Tamano: 7.5, Color: TintaSuave, Derecha: true})
	}

	// Receptor
	cursor := minimo(finEmisor, yCaja) - Mm(8)
	altoReceptor := Mm(20)
	h.Recuadro(Margen, cursor-altoReceptor, AnchoA4-Margen*2, altoReceptor, 0.5, ColorLinea)
	h.Escribir("DESTINATARIO", Opciones{X: Margen + 8, Y: cursor - 12, Tamano: 6, Fuente: Negrita, Color: TintaSuave})

	columna := (AnchoA4 - Margen*2) / 2
	condicion, ok := condicionesComprobante[c.ReceptorCondicionIva]
	if !ok {
		condicion = c.ReceptorCondicionIva
	}
	domicilio := c.ReceptorDomicilio
	if domicilio == "" {
		domicilio = "—"
	}
	cuit := Cuit(c.ReceptorCuit)
	if cuit == "" {
		cuit = "—"
	}
	datos := [][2]string{
		{"Razón social", c.ReceptorNombre},
		{"CUIT / DNI", cuit},
		{"Condición frente al IVA", condicion},
		{"Domicilio", domicilio},
	}
	for i, dato := range datos {
		x := Margen + 8 + float64(float64(i%2)*columna)
		yFila := cursor - 26 - float64(i/2*20)
		h.Escribir(dato[0], Opciones{X: x, Y: yFila, Tamano: 6, Color: TintaSuave})
		h.Escribir(dato[1], Opciones{X: x, Y: yFila - 9, Tamano: 8.5, Fuente: Negrita})
	}

	cursor -= altoReceptor + Mm(6)

	// Detalle
	colCantidad := Margen + Mm(98)
	colUnidad := Margen + Mm(118)
	colPrecio := Margen + Mm(148)
	colIva := Margen + Mm(160)
	colSubtotal := derecha

	encabezarDetalle := func() {
		cabecera := Opciones{Y: cursor, Tamano: 6, Fuente: Negrita, Color: TintaSuave}
		con := func(o Opciones, x float64, der bool) Opciones { o.X, o.Derecha = x, der; return o }
		h.Escribir("DESCRIPCIÓN", con(cabecera, Margen, false))
		h.Escribir("CANT.", con(cabecera, colCantidad, true))
		h.Escribir("UNIDAD", con(cabecera, colUnidad, true))
		h.Escribir("P. UNIT.", con(cabecera, colPrecio, true))
		if discrimina {
			h.Escribir("IVA", con(cabecera, colIva, true))
		}
		h.Escribir("SUBTOTAL", con(cabecera, colSubtotal, true))

		cursor -= 6
		h.Raya(cursor, 1, Tinta)
		cursor -= 14
	}
	encabezarDetalle()

	// Lo que no entra pasa a otra hoja (antes, como en el TS, se salía por
	// abajo): arriba van el comprobante y su número, para que la hoja suelta
	// se sepa de qué es, y el pie fiscal queda en la última.
	limite := Margen + Mm(30)
	otraHoja := func() {
		h.NuevaPagina()
		marcas()
		y := AltoA4 - Margen - 10
		h.Escribir(comprobanteNombre(c.Tipo)+" "+comprobanteNumero(c.PuntoVenta, c.Numero)+" (continuación)",
			Opciones{X: Margen, Y: y, Tamano: 9, Fuente: Negrita})
		cursor = y - Mm(10)
	}
	espacio := func(necesario float64, detalle bool) {
		if cursor-necesario >= limite {
			return
		}
		otraHoja()
		if detalle {
			encabezarDetalle()
		}
	}

	for _, item := range c.Items {
		renglones := len(Renglones(item.Descripcion, Helvetica, 8.5, Mm(100)))
		espacio(maximo(float64(renglones)*8.5*1.35, 12)+4, true)
		alto := h.EscribirParrafo(item.Descripcion, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 8.5}, Ancho: Mm(100)})
		h.Escribir(numeroJS(num(item.Cantidad)), Opciones{X: colCantidad, Y: cursor, Tamano: 8.5, Fuente: Mono, Derecha: true})
		h.Escribir(Unidad(item.Unidad), Opciones{X: colUnidad, Y: cursor, Tamano: 8, Derecha: true})
		h.Escribir(precioImpreso(item, discrimina), Opciones{X: colPrecio, Y: cursor, Tamano: 8.5, Fuente: Mono, Derecha: true})
		if discrimina {
			h.Escribir(numeroJS(num(item.AlicuotaIva))+"%", Opciones{X: colIva, Y: cursor, Tamano: 8, Derecha: true})
		}
		h.Escribir(MonedaDe(item.Subtotal), Opciones{X: colSubtotal, Y: cursor, Tamano: 8.5, Fuente: Mono, Derecha: true})

		cursor -= maximo(alto, 12) + 4
		h.Raya(cursor+8, 0, Color{})
	}

	// Totales
	cursor -= Mm(6)
	xEtiqueta := derecha - Mm(60)

	var totales [][2]string
	if discrimina {
		totales = append(totales, [2]string{"Neto gravado", MonedaDe(c.Neto)})
		if num(c.Iva21) > 0 {
			totales = append(totales, [2]string{"IVA 21%", MonedaDe(c.Iva21)})
		}
		if num(c.Iva105) > 0 {
			totales = append(totales, [2]string{"IVA 10,5%", MonedaDe(c.Iva105)})
		}
		if num(c.Iva27) > 0 {
			totales = append(totales, [2]string{"IVA 27%", MonedaDe(c.Iva27)})
		}
	}
	if num(c.Exento) > 0 {
		totales = append(totales, [2]string{"Exento", MonedaDe(c.Exento)})
	}
	for _, t := range c.Tributos {
		totales = append(totales, [2]string{t.Descripcion + " " + numeroJS(num(t.Alicuota)) + "%", MonedaDe(t.Importe)})
	}
	// Los totales van juntos (y con la leyenda de transparencia, si la hay):
	// partirlos entre dos hojas confunde.
	bloque := float64(len(totales))*12 + 24 + Mm(10) + Mm(28)
	if c.Observaciones != "" {
		bloque += Mm(12)
	}
	espacio(bloque, false)
	for _, f := range totales {
		h.Escribir(f[0], Opciones{X: xEtiqueta, Y: cursor, Tamano: 8.5, Color: TintaSuave})
		h.Escribir(f[1], Opciones{X: derecha, Y: cursor, Tamano: 8.5, Fuente: Mono, Derecha: true})
		cursor -= 12
	}

	h.Pagina.DibujarLinea(Linea{X1: xEtiqueta, Y1: cursor + 4, X2: derecha, Y2: cursor + 4, Grosor: 1.5, Color: Naranja})
	cursor -= 12

	h.Escribir("TOTAL", Opciones{X: xEtiqueta, Y: cursor, Tamano: 12, Fuente: Negrita})
	h.Escribir(MonedaDe(c.Total), Opciones{X: derecha, Y: cursor, Tamano: 13, Fuente: Negrita, Derecha: true})

	cursor -= Mm(10)

	// Régimen de Transparencia Fiscal al Consumidor (ley 27.743, RG 5614):
	// la factura B a un consumidor final dice el IVA que lleva adentro el
	// precio y los otros impuestos nacionales indirectos (acá no hay).
	if comprobanteLetra(c.Tipo) == "B" && c.ReceptorCondicionIva == "consumidor_final" {
		ivaContenido := num(c.Iva21) + num(c.Iva105) + num(c.Iva27)
		h.Escribir("Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)", Opciones{X: Margen, Y: cursor, Tamano: 7.5, Fuente: Negrita})
		cursor -= 11
		h.Escribir("IVA contenido: "+Moneda(ivaContenido), Opciones{X: Margen, Y: cursor, Tamano: 8})
		cursor -= 10
		h.Escribir("Otros impuestos nacionales indirectos: "+Moneda(0), Opciones{X: Margen, Y: cursor, Tamano: 8})
		cursor -= Mm(7)
	}

	if c.Observaciones != "" {
		cursor -= h.EscribirParrafo(c.Observaciones, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 8, Color: TintaSuave}, Ancho: Mm(120)})
	}

	// Pie fiscal
	yPie := Margen + Mm(24)
	h.Raya(yPie+Mm(6), 0, Color{})

	if c.Cae != "" && emisor != nil && emisor.Cuit != "" {
		cr, err := qrPngCrudo(UrlQr(DatosQr{
			Fecha:        c.FechaEmision,
			CuitEmisor:   emisor.Cuit,
			PuntoVenta:   c.PuntoVenta,
			Tipo:         c.Tipo,
			Numero:       c.Numero,
			Total:        num(c.Total),
			ReceptorCuit: c.ReceptorCuit,
			Cae:          c.Cae,
		}))
		if err != nil {
			return nil, err
		}
		img := h.Doc.incrustar(cr)
		lado := Mm(22)
		h.Pagina.DibujarImagen(img, Margen, yPie-Mm(4), lado, lado)

		h.Escribir("CAE "+c.Cae, Opciones{X: Margen + lado + 12, Y: yPie + Mm(12), Tamano: 9, Fuente: Negrita})
		if c.CaeVencimiento != nil {
			h.Escribir("Vencimiento del CAE: "+FechaSolaCorta(*c.CaeVencimiento), Opciones{X: Margen + lado + 12, Y: yPie + Mm(8), Tamano: 8, Color: TintaSuave})
		}
		h.Escribir("Comprobante autorizado por ARCA", Opciones{X: Margen + lado + 12, Y: yPie + Mm(4), Tamano: 7, Color: TintaSuave})
	} else {
		h.Recuadro(Margen, yPie, AnchoA4-Margen*2, Mm(12), 1, Naranja)
		h.Escribir("Comprobante sin autorización de ARCA — no válido como factura", Opciones{X: Margen + 10, Y: yPie + Mm(4.5), Tamano: 9, Fuente: Negrita})
	}

	return h.Bytes()
}
