package pdf

import (
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// El comprobante fiscal en PDF (lib/pdf/comprobante.ts): la letra en
// recuadro al centro, el IVA discriminado solo en la A, el QR únicamente
// cuando hay CAE y la marca de agua cuando no la hay. Lo que cambió desde el
// TS, a propósito: en la B y la C el precio unitario es el final; la B a
// consumidor final lleva la leyenda de la ley 27.743; los importes van con
// centavos (el TS los redondeaba a pesos: una A con neto 101,45 decía
// «Neto $ 101, IVA $ 21, total $ 123»); el encabezado lleva lo que pide la
// RG 1415 —la condición del emisor frente al IVA, el inicio de actividades
// y el código del comprobante bajo la letra—, y un nombre, un domicilio o
// una descripción largos bajan de renglón en vez de pisar la columna de al
// lado.
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
	// Neto: en la A, el subtotal de la fila va neto (cantidad × unitario
	// neto) y el IVA abajo; con el subtotal con IVA la fila no cerraba a
	// mano (simulación del mes, H080). Vacío, el subtotal (los golden del
	// TS no lo traen).
	Neto string `json:"neto,omitempty"`
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
	Tipo                 string  `json:"tipo"`
	PuntoVenta           float64 `json:"puntoVenta"`
	Numero               float64 `json:"numero"`
	ReceptorNombre       string  `json:"receptorNombre"`
	ReceptorCuit         string  `json:"receptorCuit"`
	ReceptorCondicionIva string  `json:"receptorCondicionIva"`
	ReceptorDomicilio    string  `json:"receptorDomicilio"`
	Neto                 string  `json:"neto"`
	Iva21                string  `json:"iva21"`
	Iva27                string  `json:"iva27"`
	Iva105               string  `json:"iva105"`
	Exento               string  `json:"exento"`
	TributosTotal        string  `json:"tributosTotal"`
	Total                string  `json:"total"`
	Cae                  string  `json:"cae"`
	// Homologacion: el CAE salió del ambiente de prueba de ARCA y no tiene
	// valor fiscal. Lleva su marca de agua.
	Homologacion     bool                 `json:"homologacion,omitempty"`
	CaeVencimiento   *time.Time           `json:"caeVencimiento"`
	FechaEmision     time.Time            `json:"fechaEmision"`
	FechaVencimiento *time.Time           `json:"fechaVencimiento"`
	Observaciones    string               `json:"observaciones"`
	Estado           string               `json:"estado"`
	Items            []ItemComprobante    `json:"items"`
	Tributos         []TributoComprobante `json:"tributos"`
	// CondicionVenta (Contado · Efectivo, Cuenta corriente) y Pedido van en
	// el encabezado si vienen (H030, H311).
	CondicionVenta string `json:"condicionVenta,omitempty"`
	Pedido         string `json:"pedido,omitempty"`
	// Asociado: en una nota, el comprobante que corrige, ya escrito
	// («Anula parcialmente: Factura A 0015-00000105 del 27/11/26»). Va en el
	// lugar del pedido (M3S3-006).
	Asociado string `json:"asociado,omitempty"`
}

// EmisorFiscal es el emisor del comprobante: el del encabezado más los
// datos fiscales. InicioActividades es un día (el argentino, a medianoche
// UTC, como las otras fechas del comprobante).
type EmisorFiscal struct {
	Emisor
	CondicionIva      string     `json:"condicionIva"`
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

// comprobanteCodigo es el código del comprobante que va bajo la letra
// (RG 1415): «COD. 01» la factura A, «COD. 06» la B, «COD. 11» la C. Vacío
// si el tipo no es uno de los nueve.
func comprobanteCodigo(tipo string) string {
	c, ok := codigoComprobante[tipo]
	if !ok {
		return ""
	}
	return "COD. " + rellenarJS(c, 2)
}

// precioImpreso es el precio unitario del renglón. En la A, el neto (el IVA
// va en su columna); en la B y la C, que no discriminan, el final con IVA,
// el mismo que da el subtotal impreso. El TS imprimía el neto en todas: en
// la B, precio por cantidad no daba el subtotal.
//
// En las dos, con los decimales que hagan falta para que cantidad ×
// unitario dé el subtotal impreso (UnitarioQueCierra, M2S1-154).
func precioImpreso(item ItemComprobante, discrimina bool) string {
	cantidad := jsmath.Numero(item.Cantidad)
	if !(cantidad > 0) {
		return Moneda2De(item.PrecioUnitario)
	}
	if discrimina {
		if item.Neto == "" {
			return Moneda2De(item.PrecioUnitario)
		}
		return UnitarioQueCierra(jsmath.Numero(item.Neto), cantidad)
	}
	return UnitarioQueCierra(jsmath.Numero(item.Subtotal), cantidad)
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
		} else if c.Homologacion {
			// Lo que le importa al que lo recibe; «homologación» no lo
			// entiende nadie del otro lado del mostrador.
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

	// Lo fiscal del emisor que pide la RG 1415, solo lo que está cargado.
	if f := d.Emisor; f != nil {
		var lineas []string
		if f.CondicionIva != "" {
			condicion, ok := condicionesComprobante[f.CondicionIva]
			if !ok {
				condicion = f.CondicionIva
			}
			lineas = append(lineas, "IVA "+condicion)
		}
		if f.IngresosBrutos != "" {
			lineas = append(lineas, "Ingresos Brutos "+f.IngresosBrutos)
		}
		if f.InicioActividades != nil {
			lineas = append(lineas, "Inicio de actividades "+FechaSolaCorta(*f.InicioActividades))
		}
		for _, l := range lineas {
			h.EscribirEnAncho(l, Opciones{X: Margen, Y: finEmisor, Tamano: 7.5, Color: TintaSuave}, Mm(72))
			finEmisor -= 10
		}
	}

	// La letra, en recuadro al centro.
	anchoCaja := Mm(18)
	altoCaja := Mm(16)
	xCaja := (AnchoA4 - anchoCaja) / 2
	yCaja := AltoA4 - Margen - altoCaja - 4

	h.Recuadro(xCaja, yCaja, anchoCaja, altoCaja, 1.5, Color{})
	h.EscribirCentrado(comprobanteLetra(c.Tipo), xCaja+anchoCaja/2, Opciones{Y: yCaja + Mm(5.5), Tamano: 26, Fuente: Negrita})
	h.EscribirCentrado(comprobanteCodigo(c.Tipo), xCaja+anchoCaja/2, Opciones{Y: yCaja + Mm(2), Tamano: 6.5, Fuente: Negrita})

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
		y -= 10
	}
	if c.CondicionVenta != "" {
		h.Escribir("Condición de venta: "+c.CondicionVenta, Opciones{X: derecha, Y: y, Tamano: 7.5, Color: TintaSuave, Derecha: true})
		y -= 10
	}
	if c.Asociado != "" {
		h.Escribir(c.Asociado, Opciones{X: derecha, Y: y, Tamano: 7.5, Fuente: Negrita, Derecha: true})
		y -= 10
	}
	if c.Pedido != "" {
		h.Escribir("Pedido "+c.Pedido, Opciones{X: derecha, Y: y, Tamano: 7.5, Color: TintaSuave, Derecha: true})
		y -= 10
	}

	// Receptor
	cursor := minimo(minimo(finEmisor, yCaja), y+10) - Mm(8)

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
	altoReceptor := h.CuadroDeDatos("DESTINATARIO", []Dato{
		{"Razón social", c.ReceptorNombre},
		{"CUIT / DNI", cuit},
		{"Condición frente al IVA", condicion},
		{"Domicilio", domicilio},
	}, cursor, 2)

	cursor -= altoReceptor + Mm(6)

	// Detalle. Cada columna tiene su ancho (el número de la derecha es el
	// borde, y el ancho se cuenta hacia la izquierda): la descripción baja
	// de renglón dentro del suyo, y un importe que no entra se achica. Antes
	// la descripción, de 100 mm, se metía debajo de la cantidad, y un
	// subtotal largo pisaba la columna del IVA.
	anchoDescripcion := Mm(78)
	colCantidad, anchoCantidad := Margen+Mm(94), Mm(14)
	colUnidad, anchoUnidad := Margen+Mm(108), Mm(12)
	colPrecio, anchoPrecio := Margen+Mm(136), Mm(26)
	colIva, anchoIva := Margen+Mm(150), Mm(11)
	colSubtotal, anchoSubtotal := derecha, Mm(30)

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
	// se sepa de qué es, y el pie fiscal queda en la última. El detalle llega
	// hasta abajo de cada hoja; el lugar del pie se guarda solo en la que
	// lleva los totales.
	limite := Margen + Mm(12)
	limitePie := Margen + Mm(46)
	otraHoja := func() {
		h.NuevaPagina()
		marcas()
		y := AltoA4 - Margen - 10
		h.Escribir(comprobanteNombre(c.Tipo)+" "+comprobanteNumero(c.PuntoVenta, c.Numero)+" (continuación)",
			Opciones{X: Margen, Y: y, Tamano: 9, Fuente: Negrita})
		cursor = y - Mm(10)
	}
	espacioHasta := func(necesario, limite float64, detalle bool) {
		if cursor-necesario >= limite {
			return
		}
		otraHoja()
		if detalle {
			encabezarDetalle()
		}
	}
	espacio := func(necesario float64, detalle bool) { espacioHasta(necesario, limite, detalle) }

	for _, item := range c.Items {
		renglones := len(Renglones(item.Descripcion, Helvetica, 8.5, anchoDescripcion))
		// La unidad concordada con la cantidad y la media placa como medias
		// (UnidadPara): la A decía «1 placa» de una media (M2S3-096).
		unidad := UnidadPara(item.Unidad, num(item.Cantidad), item.Descripcion)
		renglonesUnidad := len(Renglones(unidad, Helvetica, 8, anchoUnidad))
		espacio(maximo(maximo(float64(renglones)*8.5*1.35, float64(renglonesUnidad)*10), 12)+4, true)
		alto := h.EscribirParrafo(item.Descripcion, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 8.5}, Ancho: anchoDescripcion})
		h.EscribirNumero(numeroJS(num(item.Cantidad)), Opciones{X: colCantidad, Y: cursor, Tamano: 8.5, Fuente: Mono, Derecha: true}, anchoCantidad)
		alto = maximo(alto, h.EscribirParrafo(unidad, Parrafo{Opciones: Opciones{X: colUnidad, Y: cursor, Tamano: 8, Derecha: true}, Ancho: anchoUnidad, Interlineado: 10}))
		h.EscribirNumero(precioImpreso(item, discrimina), Opciones{X: colPrecio, Y: cursor, Tamano: 8.5, Fuente: Mono, Derecha: true}, anchoPrecio)
		if discrimina {
			h.EscribirNumero(numeroJS(num(item.AlicuotaIva))+"%", Opciones{X: colIva, Y: cursor, Tamano: 8, Derecha: true}, anchoIva)
		}
		subtotal := item.Subtotal
		if discrimina && item.Neto != "" {
			subtotal = item.Neto
		}
		h.EscribirNumero(Moneda2De(subtotal), Opciones{X: colSubtotal, Y: cursor, Tamano: 8.5, Fuente: Mono, Derecha: true}, anchoSubtotal)

		cursor -= maximo(alto, 12) + 4
		h.Raya(cursor+8, 0, Color{})
	}

	// Totales
	// La etiqueta a la izquierda y el importe a la derecha, cada uno en su
	// ancho: una percepción con nombre largo baja de renglón y un importe
	// grande se achica, pero no se pisan.
	cursor -= Mm(6)
	xEtiqueta := derecha - Mm(80)
	anchoEtiqueta, anchoImporte := Mm(44), Mm(34)

	var totales [][2]string
	if discrimina {
		totales = append(totales, [2]string{"Neto gravado", Moneda2De(c.Neto)})
		if num(c.Iva21) > 0 {
			totales = append(totales, [2]string{"IVA 21%", Moneda2De(c.Iva21)})
		}
		if num(c.Iva105) > 0 {
			totales = append(totales, [2]string{"IVA 10,5%", Moneda2De(c.Iva105)})
		}
		if num(c.Iva27) > 0 {
			totales = append(totales, [2]string{"IVA 27%", Moneda2De(c.Iva27)})
		}
	}
	if num(c.Exento) > 0 {
		totales = append(totales, [2]string{"Exento", Moneda2De(c.Exento)})
	}
	for _, t := range c.Tributos {
		totales = append(totales, [2]string{t.Descripcion + " " + numeroJS(num(t.Alicuota)) + "%", Moneda2De(t.Importe)})
	}
	// Los totales van juntos (y con la leyenda de transparencia, si la hay):
	// partirlos entre dos hojas confunde.
	renglonesTotal := make([]int, len(totales))
	bloque := 24 + Mm(10) + Mm(28)
	for i, f := range totales {
		renglonesTotal[i] = max(1, len(Renglones(f[0], Normal, 8.5, anchoEtiqueta)))
		bloque += 12 + float64(renglonesTotal[i]-1)*10
	}
	if c.Observaciones != "" {
		bloque += maximo(Mm(12), float64(len(Renglones(c.Observaciones, Normal, 8, Mm(120))))*8*1.35)
	}
	espacioHasta(bloque, limitePie, false)
	for i, f := range totales {
		h.EscribirParrafo(f[0], Parrafo{Opciones: Opciones{X: xEtiqueta, Y: cursor, Tamano: 8.5, Color: TintaSuave}, Ancho: anchoEtiqueta, Interlineado: 10})
		h.EscribirNumero(f[1], Opciones{X: derecha, Y: cursor, Tamano: 8.5, Fuente: Mono, Derecha: true}, anchoImporte)
		cursor -= 12 + float64(renglonesTotal[i]-1)*10
	}

	h.Pagina.DibujarLinea(Linea{X1: xEtiqueta, Y1: cursor + 4, X2: derecha, Y2: cursor + 4, Grosor: 1.5, Color: Naranja})
	cursor -= 12

	h.Escribir("TOTAL", Opciones{X: xEtiqueta, Y: cursor, Tamano: 12, Fuente: Negrita})
	h.EscribirNumero(Moneda2De(c.Total), Opciones{X: derecha, Y: cursor, Tamano: 13, Fuente: Negrita, Derecha: true}, Mm(62))

	cursor -= Mm(10)

	// Régimen de Transparencia Fiscal al Consumidor (ley 27.743, RG 5614):
	// la factura B a un consumidor final dice el IVA que lleva adentro el
	// precio y los otros impuestos nacionales indirectos (acá no hay).
	if comprobanteLetra(c.Tipo) == "B" && c.ReceptorCondicionIva == "consumidor_final" {
		ivaContenido := num(c.Iva21) + num(c.Iva105) + num(c.Iva27)
		h.Escribir("Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)", Opciones{X: Margen, Y: cursor, Tamano: 7.5, Fuente: Negrita})
		cursor -= 11
		h.Escribir("IVA contenido: "+Moneda2(ivaContenido), Opciones{X: Margen, Y: cursor, Tamano: 8})
		cursor -= 10
		h.Escribir("Otros impuestos nacionales indirectos: "+Moneda2(0), Opciones{X: Margen, Y: cursor, Tamano: 8})
		cursor -= Mm(7)
	}

	// La A a un monotributista lleva la leyenda de la Ley 27.618 (RG 5003/2021;
	// fiscal.LeyendaMonotributo, H207).
	if comprobanteLetra(c.Tipo) == "A" && c.ReceptorCondicionIva == "monotributista" {
		cursor -= h.EscribirParrafo(leyendaMonotributo, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 7.5, Fuente: Negrita}, Ancho: Mm(170)})
		cursor -= Mm(3)
	}

	if c.Observaciones != "" {
		cursor -= h.EscribirParrafo(c.Observaciones, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 8, Color: TintaSuave}, Ancho: Mm(120)})
	}

	// Pie fiscal
	yPie := Margen + Mm(24)
	// La raya va arriba del QR: a 6 mm del pie cruzaba el QR y tachaba
	// «Comprobante autorizado por ARCA».
	h.Raya(yPie+Mm(20), 0, Color{})

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

// leyendaMonotributo es fiscal.LeyendaMonotributo (pdf no importa fiscal).
const leyendaMonotributo = "El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de " +
	"Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618"
