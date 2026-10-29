package pdf

import (
	"time"

	"mjbj/internal/jsmath"
)

// El presupuesto en PDF (lib/pdf/presupuesto.ts), con el modelo del papel
// que la maderera imprime hoy: número, vendedor, código de cliente,
// condición de IVA, neto e IVA discriminados para un inscripto o un
// monotributista, las leyendas de la casa y el pie con las dos sucursales y
// los datos para transferir.
//
// Espera a la tanda 5 (ventas): hoy lo llaman
// app/api/presupuestos/[id]/pdf/route.ts y lib/whatsapp/documentos.ts, con
// consultarPresupuesto de lib/dal/admin/ventas.ts.

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

	cabecera := []string{"Fecha " + FechaSolaCorta(p.CreatedAt), "", ""}
	if p.Sucursal != "" {
		cabecera[1] = "Emitido en " + p.Sucursal
	}
	if p.ValidoHasta != nil {
		cabecera[2] = "Vale hasta el " + FechaSolaCorta(*p.ValidoHasta)
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
	altoCaja := Mm(24)
	h.Recuadro(Margen, cursor-altoCaja, AnchoA4-Margen*2, altoCaja, 0.5, ColorLinea)
	h.Escribir("CLIENTE", Opciones{X: Margen + 8, Y: cursor - 12, Tamano: 6, Fuente: Negrita, Color: TintaSuave})

	o := func(s, def string) string {
		if s == "" {
			return def
		}
		return s
	}
	columna := (AnchoA4 - Margen*2) / 3
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
	datos := [][2]string{
		{"Cliente", cliente},
		{"Cód. cliente", o(p.ClienteCodigo, "—")},
		{"Vendedor", o(p.Vendedor, o(p.Asesor, "—"))},
		{"Domicilio", o(p.ClienteDireccion, "—")},
		{"CUIT", o(p.ClienteCuit, "—")},
		{"IVA", iva},
	}
	for i, dato := range datos {
		x := Margen + 8 + float64(float64(i%3)*columna)
		yFila := cursor - 26 - float64(i/3*20)
		h.Escribir(dato[0], Opciones{X: x, Y: yFila, Tamano: 6, Color: TintaSuave})
		h.Escribir(dato[1], Opciones{X: x, Y: yFila - 9, Tamano: 8.5, Fuente: Negrita})
	}

	cursor -= altoCaja + Mm(6)

	// Detalle
	colCantidad := Margen + Mm(16)
	colUnidad := Margen + Mm(34)
	colDescripcion := Margen + Mm(38)
	colPrecio := derecha - Mm(28)
	anchoDescripcion := colPrecio - colDescripcion - Mm(30)

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
		cursor = presupuestoEspacio(h, cursor, Mm(14))
		if cursor != antes {
			cursor = encabezado(cursor)
		}

		h.Escribir(numeroJS(num(item.Cantidad)), Opciones{X: colCantidad, Y: cursor, Tamano: 9, Fuente: Mono, Derecha: true})
		h.Escribir(Unidad(item.Unidad), Opciones{X: colUnidad, Y: cursor, Tamano: 7, Color: TintaSuave, Derecha: true})
		alto := h.EscribirParrafo(item.Descripcion, Parrafo{Opciones: Opciones{X: colDescripcion, Y: cursor, Tamano: 9}, Ancho: anchoDescripcion})
		h.Escribir(MonedaDe(item.PrecioUnitario), Opciones{X: colPrecio, Y: cursor, Tamano: 9, Fuente: Mono, Derecha: true})
		h.Escribir(MonedaDe(item.Subtotal), Opciones{X: derecha, Y: cursor, Tamano: 9, Fuente: Mono, Derecha: true})

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
		filas = append(filas, filaTotal{"Subtotal", Moneda(subtotal), false}, filaTotal{"Descuento", "-" + Moneda(descuento), false})
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
		filas = append(filas, filaTotal{"Neto gravado", Moneda(neto), false}, filaTotal{"IVA", Moneda(ivaTotal), false})
	}
	filas = append(filas, filaTotal{"TOTAL", Moneda(total), true})

	for _, f := range filas {
		et := Opciones{X: colPrecio, Y: cursor, Tamano: 8.5, Fuente: Normal, Color: TintaSuave, Derecha: true}
		va := Opciones{X: derecha, Y: cursor, Tamano: 9, Fuente: Mono, Derecha: true}
		baja := 12.0
		if f.fuerte {
			et.Tamano, et.Fuente, et.Color = 10, Negrita, Tinta
			va.Tamano, va.Fuente = 11, Negrita
			baja = 16
		}
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

	for i, s := range sucursalesPublicadas {
		x := Margen + float64(float64(i)*anchoPie)
		h.Escribir(s.nombre, Opciones{X: x, Y: yPie - 8, Tamano: 7, Fuente: Negrita})
		h.Escribir(s.direccion, Opciones{X: x, Y: yPie - 17, Tamano: 6.5, Color: TintaSuave})
		h.Escribir("Tel: "+s.telefono, Opciones{X: x, Y: yPie - 25, Tamano: 6.5, Color: TintaSuave})
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
