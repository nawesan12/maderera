package pdf

import "time"

// La orden de pago a un proveedor: el papel que acompaña la transferencia o
// los cheques y que el proveedor firma de recibido. Dice qué facturas se
// cancelan, qué se retuvo (con el número de cada certificado) y con qué sale
// la plata. Va con el molde del recibo (encabezado, la suma en números y en
// letras, los renglones) y lo sirve internal/compras
// (GET /api/v1/admin/compras/pagos/{id}/pdf).

// FacturaDeLaOrden es una factura que el pago cancela, con cuánto.
type FacturaDeLaOrden struct {
	Comprobante string
	Fecha       time.Time
	Aplicado    float64
}

// RetencionDeLaOrden es un certificado que salió con el pago.
type RetencionDeLaOrden struct {
	Certificado string
	Regimen     string
	Importe     float64
}

// MedioDeLaOrden es un renglón de con qué sale la plata.
type MedioDeLaOrden struct {
	Medio   string
	Detalle string
	Importe float64
}

// DatosOrdenDePago es todo lo que va en el papel.
type DatosOrdenDePago struct {
	Fecha      time.Time
	Total      float64
	Neto       float64
	Referencia string
	Emisor     *Emisor
	Proveedor  struct {
		Nombre, RazonSocial, Cuit string
	}
	Facturas    []FacturaDeLaOrden
	Retenciones []RetencionDeLaOrden
	Medios      []MedioDeLaOrden
	Anulado     bool
}

// OrdenDePago arma el PDF.
func OrdenDePago(d DatosOrdenDePago) ([]byte, error) {
	h := NuevaHoja()
	anchoUtil := AnchoA4 - Margen*2
	derecha := AnchoA4 - Margen

	y := AltoA4 - Margen
	y = h.EncabezadoEmisor(d.Emisor, y)
	y -= Mm(6)
	h.EscribirCentrado("ORDEN DE PAGO", AnchoA4/2, Opciones{Y: y, Tamano: 15, Fuente: Negrita})
	y -= Mm(10)
	h.Raya(y, 0, Color{})
	y -= Mm(8)

	h.Escribir("Fecha", Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
	h.Escribir(FechaLocal(d.Fecha), Opciones{X: Margen, Y: y - Mm(5), Tamano: 12, Fuente: Negrita})
	if d.Referencia != "" {
		h.Escribir("Referencia", Opciones{X: AnchoA4 / 2, Y: y, Tamano: 8, Color: TintaSuave})
		h.Escribir(d.Referencia, Opciones{X: AnchoA4 / 2, Y: y - Mm(5), Tamano: 12, Fuente: Negrita})
	}
	y -= Mm(14)

	h.Escribir("A la orden de", Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
	y -= Mm(5)
	nombre := d.Proveedor.RazonSocial
	if nombre == "" {
		nombre = d.Proveedor.Nombre
	}
	h.Escribir(nombre, Opciones{X: Margen, Y: y, Tamano: 10.5})
	if d.Proveedor.Cuit != "" {
		h.Escribir("CUIT "+Cuit(d.Proveedor.Cuit), Opciones{X: derecha, Y: y, Tamano: 10, Derecha: true, Color: TintaSuave})
	}
	y -= Mm(10)

	// Cuánto sale, en números y en letras.
	h.Pagina.DibujarRectangulo(Rectangulo{X: Margen, Y: y - Mm(17), Ancho: anchoUtil, Alto: Mm(19), Relleno: RGB(0.98, 0.97, 0.95)})
	h.Escribir("La suma de", Opciones{X: Margen + Mm(4), Y: y - Mm(5), Tamano: 8, Color: TintaSuave})
	h.EscribirNumero(Moneda2(d.Neto), Opciones{X: Margen + Mm(4), Y: y - Mm(12), Tamano: 17, Fuente: Negrita}, Mm(64))
	h.EscribirParrafo("Son pesos "+ImporteEnLetras(d.Neto)+".", Parrafo{
		Opciones: Opciones{X: Margen + Mm(70), Y: y - Mm(8.5), Tamano: 8.5},
		Ancho:    anchoUtil - Mm(74),
	})
	y -= Mm(26)

	seccion := func(titulo string) {
		if y < Margen+Mm(50) {
			h.NuevaPagina()
			y = AltoA4 - Margen - 10
		}
		h.Escribir(titulo, Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
		y -= 6
		h.Pagina.DibujarLinea(Linea{X1: Margen, Y1: y, X2: derecha, Y2: y, Grosor: 0.5, Color: ColorLinea})
		y -= 13
	}
	renglon := func(izq, medio string, importe float64) {
		if y < Margen+Mm(30) {
			h.NuevaPagina()
			y = AltoA4 - Margen - 10
		}
		h.Escribir(izq, Opciones{X: Margen, Y: y, Tamano: 9.5})
		if medio != "" {
			h.Escribir(Elipsis(medio, Normal, 8.5, Mm(80)), Opciones{X: Margen + Mm(62), Y: y, Tamano: 8.5, Color: TintaSuave})
		}
		h.Escribir(Moneda2(importe), Opciones{X: derecha, Y: y, Tamano: 9.5, Derecha: true})
		y -= Mm(6)
	}

	if len(d.Facturas) > 0 {
		seccion("Facturas que se cancelan")
		for _, f := range d.Facturas {
			renglon(f.Comprobante, "del "+FechaLocal(f.Fecha), f.Aplicado)
		}
		y -= Mm(4)
	}
	if len(d.Retenciones) > 0 {
		seccion("Retenciones practicadas")
		for _, r := range d.Retenciones {
			renglon("Certificado "+r.Certificado, r.Regimen, r.Importe)
		}
		y -= Mm(4)
	}
	seccion("Con qué se paga")
	for _, m := range d.Medios {
		renglon(m.Medio, m.Detalle, m.Importe)
	}
	y -= Mm(2)
	h.Pagina.DibujarLinea(Linea{X1: derecha - Mm(60), Y1: y + Mm(4), X2: derecha, Y2: y + Mm(4), Grosor: 0.5, Color: ColorLinea})
	h.Escribir("Total cancelado", Opciones{X: Margen, Y: y, Tamano: 9.5, Fuente: Negrita})
	h.Escribir(Moneda2(d.Total), Opciones{X: derecha, Y: y, Tamano: 11, Fuente: Negrita, Derecha: true})
	y -= Mm(28)

	// Dos firmas: quien autoriza el pago y el proveedor que lo recibe.
	if y < Margen+Mm(20) {
		h.NuevaPagina()
		y = AltoA4 - Margen - Mm(30)
	}
	h.Pagina.DibujarLinea(Linea{X1: Margen, Y1: y, X2: Margen + Mm(70), Y2: y, Grosor: 0.5, Color: ColorLinea})
	h.Escribir("Autorizó", Opciones{X: Margen, Y: y - Mm(5), Tamano: 7.5, Color: TintaSuave})
	h.Pagina.DibujarLinea(Linea{X1: derecha - Mm(70), Y1: y, X2: derecha, Y2: y, Grosor: 0.5, Color: ColorLinea})
	h.Escribir("Recibí conforme: firma, aclaración y fecha", Opciones{X: derecha - Mm(70), Y: y - Mm(5), Tamano: 7.5, Color: TintaSuave})

	if d.Anulado {
		h.MarcaDeAgua("Anulada")
	}
	return h.Bytes()
}
