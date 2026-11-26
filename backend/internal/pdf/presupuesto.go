package pdf

import (
	"time"

	"mjbj/internal/jsmath"
	"mjbj/internal/sucursales"
)

// El presupuesto en PDF (lib/pdf/presupuesto.ts), con el modelo del papel
// que la maderera imprime hoy: número, vendedor, código de cliente,
// condición de IVA, neto e IVA discriminados para un inscripto o un
// monotributista, las leyendas de la casa y el pie con las dos sucursales y
// los datos para transferir. Los importes van con centavos (el TS los
// redondeaba a pesos) y las fechas en la hora argentina.
//
// Lo piden los datos de internal/pedidos (tanda 5): la ruta
// /api/v1/presupuestos/{id}/pdf, que usan app/api/presupuestos/[id]/pdf
// y lib/whatsapp/documentos.ts.

// ItemPresupuesto es un renglón (los campos de consultarPresupuesto que usa
// el PDF). AlicuotaIva es nil en las líneas de texto libre, que caen al 21.
type ItemPresupuesto struct {
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       string  `json:"cantidad"`
	PrecioUnitario string  `json:"precioUnitario"`
	Subtotal       string  `json:"subtotal"`
	AlicuotaIva    *string `json:"alicuotaIva"`
}

// PresupuestoCompleto tiene los campos de PresupuestoCompleto del TS que usa
// el PDF; el resto del JSON se ignora. Los null de texto valen lo mismo que
// la tira vacía.
type PresupuestoCompleto struct {
	Numero              string            `json:"numero"`
	Cliente             string            `json:"cliente"`
	Empresa             string            `json:"empresa"`
	ClienteCodigo       string            `json:"clienteCodigo"`
	ClienteCuit         string            `json:"clienteCuit"`
	ClienteCondicionIva string            `json:"clienteCondicionIva"`
	ClienteDireccion    string            `json:"clienteDireccion"`
	Sucursal            string            `json:"sucursal"`
	Vendedor            string            `json:"vendedor"`
	Asesor              string            `json:"asesor"`
	Subtotal            string            `json:"subtotal"`
	Total               string            `json:"total"`
	Notas               string            `json:"notas"`
	ValidoHasta         *time.Time        `json:"validoHasta"`
	CreatedAt           time.Time         `json:"createdAt"`
	Items               []ItemPresupuesto `json:"items"`
}

// DatosParaTransferir es la cuenta de la casa (lib/dal/pagos.ts).
type DatosParaTransferir struct {
	Banco         string `json:"banco"`
	Titular       string `json:"titular"`
	Cuit          string `json:"cuit"`
	Cbu           string `json:"cbu"`
	Alias         string `json:"alias"`
	Instrucciones string `json:"instrucciones"`
}

// DatosPresupuesto son los tres argumentos de presupuestoPdf.
type DatosPresupuesto struct {
	Presupuesto PresupuestoCompleto  `json:"presupuesto"`
	Emisor      *Emisor              `json:"emisor"`
	Banco       *DatosParaTransferir `json:"banco"`
}

var condicionesPresupuesto = map[string]string{
	"responsable_inscripto": "Responsable inscripto",
	"monotributista":        "Monotributista",
	"exento":                "Exento",
	"consumidor_final":      "Consumidor final",
	"no_categorizado":       "No categorizado",
}

var presupuestoPieAlto = Mm(30)

// presupuestoEspacio es asegurarEspacio: corta de página si no entra.
func presupuestoEspacio(h *Hoja, cursor, necesario float64) float64 {
	if cursor-necesario > Margen+presupuestoPieAlto {
		return cursor
	}
	h.NuevaPagina()
	return AltoA4 - Margen
}

// Presupuesto arma el PDF del presupuesto.
func Presupuesto(d DatosPresupuesto, _ time.Time) ([]byte, error) {
	p := d.Presupuesto
	num := jsmath.Numero
	h := NuevaHoja()
	derecha := AnchoA4 - Margen

	finEmisor := h.EncabezadoEmisor(d.Emisor, AltoA4-Margen-10)

	y := AltoA4 - Margen - 10
	h.Escribir("PRESUPUESTO", Opciones{X: derecha, Y: y, Tamano: 15, Fuente: Negrita, Derecha: true})
	y -= 16
	h.Escribir(p.Numero, Opciones{X: derecha, Y: y, Tamano: 13, Fuente: Mono, Derecha: true})
	y -= 13

	// La fecha y el vencimiento son instantes: en la hora argentina (con
	// FechaSolaCorta, en UTC, uno de las 23:30 salía con la de mañana).
	cabecera := []string{"Fecha " + FechaCortaHoy(p.CreatedAt), "", ""}
	if p.Sucursal != "" {
		cabecera[1] = "Emitido en " + p.Sucursal
	}
	if p.ValidoHasta != nil {
		cabecera[2] = "Vale hasta el " + FechaCortaHoy(*p.ValidoHasta)
	}
	for _, t := range cabecera {
		if t == "" {
			continue
		}
		h.Escribir(t, Opciones{X: derecha, Y: y, Tamano: 7.5, Color: TintaSuave, Derecha: true})
		y -= 10
	}

	// Cliente
	cursor := minimo(finEmisor, y) - Mm(8)

	o := func(s, def string) string {
		if s == "" {
			return def
		}
		return s
	}
	cliente := p.Cliente
	if p.Empresa != "" {
		cliente = p.Cliente + " · " + p.Empresa
	}
	iva := "Consumidor final"
	if p.ClienteCondicionIva != "" {
		iva = p.ClienteCondicionIva
		if c, ok := condicionesPresupuesto[p.ClienteCondicionIva]; ok {
			iva = c
		}
	}
	altoCaja := h.CuadroDeDatos("CLIENTE", []Dato{
		{"Cliente", cliente},
		{"Cód. cliente", o(p.ClienteCodigo, "—")},
		{"Vendedor", o(p.Vendedor, o(p.Asesor, "—"))},
		{"Domicilio", o(p.ClienteDireccion, "—")},
		{"CUIT", Cuit(p.ClienteCuit)},
		{"IVA", iva},
	}, cursor, 3)

	cursor -= altoCaja + Mm(6)

	// Detalle
	// Los importes con centavos son más anchos que los redondeados: el precio
	// y el total tienen cada uno su ancho, y lo que no entra se achica.
	colCantidad, anchoCantidad := Margen+Mm(16), Mm(15)
	colUnidad, anchoUnidad := Margen+Mm(34), Mm(16)
	colDescripcion := Margen + Mm(38)
	colPrecio, anchoPrecio := derecha-Mm(34), Mm(30)
	anchoTotal := Mm(32)
	anchoDescripcion := colPrecio - anchoPrecio - Mm(2) - colDescripcion

	encabezado := func(c float64) float64 {
		cab := Opciones{Y: c, Tamano: 6, Fuente: Negrita, Color: TintaSuave}
		con := func(x float64, der bool) Opciones { o := cab; o.X, o.Derecha = x, der; return o }
		h.Escribir("CANT.", con(colCantidad, true))
		h.Escribir("DESCRIPCIÓN", con(colDescripcion, false))
		h.Escribir("PRECIO", con(colPrecio, true))
		h.Escribir("TOTAL", con(derecha, true))
		c -= 6
		h.Raya(c, 1, Tinta)
		return c - 14
	}

	cursor = encabezado(cursor)

	for _, item := range p.Items {
		antes := cursor
		renglones := len(Renglones(item.Descripcion, Helvetica, 9, anchoDescripcion))
		renglonesUnidad := len(Renglones(Unidad(item.Unidad), Helvetica, 7, anchoUnidad))
		cursor = presupuestoEspacio(h, cursor, maximo(Mm(14), maximo(float64(renglones)*9*1.35, float64(renglonesUnidad)*9)+4))
		if cursor != antes {
			cursor = encabezado(cursor)
		}

		h.EscribirNumero(numeroJS(num(item.Cantidad)), Opciones{X: colCantidad, Y: cursor, Tamano: 9, Fuente: Mono, Derecha: true}, anchoCantidad)
		altoUnidad := h.EscribirParrafo(Unidad(item.Unidad), Parrafo{Opciones: Opciones{X: colUnidad, Y: cursor, Tamano: 7, Color: TintaSuave, Derecha: true}, Ancho: anchoUnidad, Interlineado: 9})
		alto := maximo(altoUnidad, h.EscribirParrafo(item.Descripcion, Parrafo{Opciones: Opciones{X: colDescripcion, Y: cursor, Tamano: 9}, Ancho: anchoDescripcion}))
		h.EscribirNumero(Moneda2De(item.PrecioUnitario), Opciones{X: colPrecio, Y: cursor, Tamano: 9, Fuente: Mono, Derecha: true}, anchoPrecio)
		h.EscribirNumero(Moneda2De(item.Subtotal), Opciones{X: derecha, Y: cursor, Tamano: 9, Fuente: Mono, Derecha: true}, anchoTotal)

		cursor -= maximo(alto, 12) + 4
		h.Raya(cursor+8, 0, Color{})
	}

	// Totales
	discrimina := p.ClienteCondicionIva == "responsable_inscripto" || p.ClienteCondicionIva == "monotributista"
	total := num(p.Total)
	subtotal := num(p.Subtotal)
	descuento := subtotal - total

	cursor = presupuestoEspacio(h, cursor, Mm(40)) - Mm(2)

	type filaTotal struct {
		etiqueta, valor string
		fuerte          bool
	}
	var filas []filaTotal
	if descuento > 0.009 {
		filas = append(filas, filaTotal{"Subtotal", Moneda2(subtotal), false}, filaTotal{"Descuento", "-" + Moneda2(descuento), false})
	}
	if discrimina {
		neto, ivaTotal := 0.0, 0.0
		for _, item := range p.Items {
			alicuota := 21.0
			if item.AlicuotaIva != nil {
				alicuota = num(*item.AlicuotaIva)
			}
			parte := Desagregar(num(item.Subtotal), alicuota)
			neto += parte.Neto
			ivaTotal += parte.Iva
		}
		// El descuento se prorratea sobre el neto, como en la factura.
		if descuento > 0.009 && subtotal > 0 {
			factor := total / subtotal
			neto *= factor
			ivaTotal = total - neto
		}
		filas = append(filas, filaTotal{"Neto gravado", Moneda2(neto), false}, filaTotal{"IVA", Moneda2(ivaTotal), false})
	}
	filas = append(filas, filaTotal{"TOTAL", Moneda2(total), true})

	// Las etiquetas se alinean a la derecha de una misma columna, que se
	// corre a la izquierda si el importe más ancho no entra: un total de diez
	// cifras en negrita se metía debajo de «TOTAL».
	opciones := func(f filaTotal) (et, va Opciones, baja float64) {
		et = Opciones{Y: cursor, Tamano: 8.5, Fuente: Normal, Color: TintaSuave, Derecha: true}
		va = Opciones{X: derecha, Y: cursor, Tamano: 9, Fuente: Mono, Derecha: true}
		baja = 12
		if f.fuerte {
			et.Tamano, et.Fuente, et.Color = 10, Negrita, Tinta
			va.Tamano, va.Fuente = 11, Negrita
			baja = 16
		}
		return et, va, baja
	}
	xEtiquetas := colPrecio
	for _, f := range filas {
		_, va, _ := opciones(f)
		xEtiquetas = minimo(xEtiquetas, derecha-va.Fuente.Ancho(Limpiar(f.valor), va.Tamano)-Mm(4))
	}
	for _, f := range filas {
		et, va, baja := opciones(f)
		et.X, et.Y, va.Y = xEtiquetas, cursor, cursor
		h.Escribir(f.etiqueta, et)
		h.Escribir(f.valor, va)
		cursor -= baja
	}

	if !discrimina {
		h.Escribir("Precios finales con IVA incluido", Opciones{X: derecha, Y: cursor, Tamano: 7, Color: TintaSuave, Derecha: true})
		cursor -= 12
	}

	// Las leyendas del papel viejo: las reglas comerciales de la casa.
	cursor -= Mm(4)
	leyendas := []string{"Los precios sólo se fijan cuando se abone la totalidad del presupuesto. Los precios podrían variar sin previo aviso."}
	if discrimina {
		leyendas = append(leyendas, "Los responsables inscriptos y monotributistas verán incrementados estos precios en el importe de la percepción de IIBB Pcia. Bs. As. que les corresponda.")
	}
	for _, l := range leyendas {
		cursor = presupuestoEspacio(h, cursor, Mm(10))
		cursor -= h.EscribirParrafo(l, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 7, Color: TintaSuave}, Ancho: AnchoA4 - Margen*2}) + 4
	}

	if p.Notas != "" {
		cursor -= Mm(2)
		cursor = presupuestoEspacio(h, cursor, Mm(12))
		h.EscribirParrafo(p.Notas, Parrafo{Opciones: Opciones{X: Margen, Y: cursor, Tamano: 8, Color: TintaSuave}, Ancho: AnchoA4 - Margen*2})
	}

	// Pie: las dos sucursales y los datos para transferir.
	yPie := Margen + presupuestoPieAlto - Mm(4)
	h.Raya(yPie+Mm(2), 0.5, Color{})

	columnas := 2.0
	if d.Banco != nil {
		columnas = 3
	}
	anchoPie := (AnchoA4 - Margen*2) / columnas

	for i, s := range sucursales.Publicadas {
		x := Margen + float64(float64(i)*anchoPie)
		h.Escribir(s.Nombre, Opciones{X: x, Y: yPie - 8, Tamano: 7, Fuente: Negrita})
		h.Escribir(s.Direccion, Opciones{X: x, Y: yPie - 17, Tamano: 6.5, Color: TintaSuave})
		h.Escribir("Tel: "+s.Telefono, Opciones{X: x, Y: yPie - 25, Tamano: 6.5, Color: TintaSuave})
	}

	if b := d.Banco; b != nil {
		x := Margen + float64(2*anchoPie)
		h.Escribir("Para depósito o transferencia", Opciones{X: x, Y: yPie - 8, Tamano: 7, Fuente: Negrita})
		var lineas []string
		if b.Banco != "" {
			lineas = append(lineas, b.Banco)
		}
		if b.Cbu != "" {
			lineas = append(lineas, "CBU "+b.Cbu)
		}
		if b.Alias != "" {
			lineas = append(lineas, "Alias "+b.Alias)
		}
		for i, t := range lineas {
			h.Escribir(t, Opciones{X: x, Y: yPie - 17 - float64(i*8), Tamano: 6.5, Color: TintaSuave})
		}
	}

	h.EscribirCentrado("Documento no válido como factura.", AnchoA4/2, Opciones{Y: Margen, Tamano: 6.5, Color: TintaSuave})

	return h.Bytes()
}
