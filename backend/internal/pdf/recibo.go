package pdf

import (
	"strings"
	"time"
)

// El recibo en PDF (lib/pdf/recibo.ts): el papel que el cliente se lleva
// cuando paga la cuenta. Quién pagó, cuánto —en números y en letras—, con qué
// (cada cheque con banco, número y fecha) y cómo quedó la cuenta. No es un
// comprobante fiscal: no lleva CAE.
//
// Espera a la tanda 4 (cuenta corriente y cobros): los datos salen de
// lib/dal/recibos.ts.

// ChequeDelRecibo es el cheque de una parte.
type ChequeDelRecibo struct {
	ID        string    `json:"id"`
	Tipo      string    `json:"tipo"`
	Numero    string    `json:"numero"`
	Banco     *string   `json:"banco"` // `?? "Sin banco"`: la tira vacía queda vacía
	Librador  string    `json:"librador"`
	FechaPago time.Time `json:"fechaPago"`
	Estado    string    `json:"estado"`
}

// ParteDelRecibo es ParteDelRecibo de lib/dal/recibos.ts.
type ParteDelRecibo struct {
	Medio      string           `json:"medio"`
	Importe    float64          `json:"importe"`
	Referencia string           `json:"referencia"`
	Cheque     *ChequeDelRecibo `json:"cheque"`
}

// ClienteDelRecibo es el cliente del recibo (null si no tiene ficha).
type ClienteDelRecibo struct {
	ID        string `json:"id"`
	Cuit      string `json:"cuit"`
	Direccion string `json:"direccion"`
}

// ReciboCompleto es ReciboCompleto de lib/dal/recibos.ts.
type ReciboCompleto struct {
	ID              string            `json:"id"`
	Numero          string            `json:"numero"`
	Fecha           time.Time         `json:"fecha"`
	Estado          string            `json:"estado"` // emitido | anulado
	Origen          string            `json:"origen"`
	Concepto        string            `json:"concepto"`
	Total           float64           `json:"total"`
	RecibidoDe      string            `json:"recibidoDe"`
	MotivoAnulacion string            `json:"motivoAnulacion"`
	AnuladoAt       *time.Time        `json:"anuladoAt"`
	Cliente         *ClienteDelRecibo `json:"cliente"`
	Partes          []ParteDelRecibo  `json:"partes"`
	SaldoDespues    *float64          `json:"saldoDespues"`
	EmitidoPor      string            `json:"emitidoPor"`
}

// DatosRecibo son los dos argumentos de reciboPdf(recibo, emisor).
type DatosRecibo struct {
	Recibo ReciboCompleto `json:"recibo"`
	Emisor *Emisor        `json:"emisor"`
}

// Recibo arma el PDF del recibo.
func Recibo(d DatosRecibo, _ time.Time) ([]byte, error) {
	r := d.Recibo
	h := NuevaHoja()
	anchoUtil := AnchoA4 - Margen*2
	derecha := AnchoA4 - Margen

	y := h.EncabezadoEmisor(d.Emisor, h.Y)

	h.Escribir("RECIBO", Opciones{X: derecha, Y: h.Y, Tamano: 15, Fuente: Negrita, Derecha: true})
	h.Escribir(r.Numero, Opciones{X: derecha, Y: h.Y - 16, Tamano: 11, Fuente: Mono, Derecha: true})
	h.Escribir(FechaLocal(r.Fecha), Opciones{X: derecha, Y: h.Y - 28, Tamano: 8, Color: TintaSuave, Derecha: true})

	y = minimo(y, h.Y-36) - 8
	h.Raya(y, 0, Color{})
	y -= 18

	// Quién pagó.
	h.Escribir("Recibimos de", Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
	y -= 13
	h.Escribir(r.RecibidoDe, Opciones{X: Margen, Y: y, Tamano: 12, Fuente: Negrita})
	y -= 12
	var datosCliente []string
	if r.Cliente != nil {
		cuit := ""
		if r.Cliente.Cuit != "" {
			cuit = "CUIT " + r.Cliente.Cuit
		}
		datosCliente = []string{cuit, r.Cliente.Direccion}
	}
	for _, dato := range datosCliente {
		if dato == "" {
			continue
		}
		h.Escribir(dato, Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
		y -= 11
	}
	y -= 6

	// Cuánto, en números y en letras.
	h.Pagina.DibujarRectangulo(Rectangulo{X: Margen, Y: y - Mm(17), Ancho: anchoUtil, Alto: Mm(19), Relleno: RGB(0.98, 0.97, 0.95)})
	h.Escribir("La suma de", Opciones{X: Margen + Mm(4), Y: y - Mm(5), Tamano: 8, Color: TintaSuave})
	h.Escribir(Pesos(r.Total), Opciones{X: Margen + Mm(4), Y: y - Mm(12), Tamano: 17, Fuente: Negrita})
	h.EscribirParrafo("Son pesos "+ImporteEnLetras(r.Total)+".", Parrafo{
		Opciones: Opciones{X: Margen + Mm(70), Y: y - Mm(8.5), Tamano: 8.5},
		Ancho:    anchoUtil - Mm(74),
	})
	y -= Mm(25)

	if r.Concepto != "" {
		h.Escribir("En concepto de", Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
		y -= 12
		y -= h.EscribirParrafo(r.Concepto, Parrafo{Opciones: Opciones{X: Margen, Y: y, Tamano: 9.5}, Ancho: anchoUtil})
		y -= 8
	}

	// Con qué pagó, parte por parte.
	h.Escribir("Forma de pago", Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
	y -= 6
	h.Pagina.DibujarLinea(Linea{X1: Margen, Y1: y, X2: derecha, Y2: y, Grosor: 0.5, Color: ColorLinea})
	y -= 13

	conCheque := false
	for _, parte := range r.Partes {
		if parte.Cheque != nil {
			conCheque = true
		}
		if y < Margen+Mm(45) {
			h.NuevaPagina()
			y = AltoA4 - Margen
		}
		medio, ok := nombreDelMedio[parte.Medio]
		if !ok {
			medio = parte.Medio
		}
		h.Escribir(medio, Opciones{X: Margen, Y: y, Tamano: 9.5, Fuente: Negrita})
		h.Escribir(Pesos(parte.Importe), Opciones{X: derecha, Y: y, Tamano: 9.5, Derecha: true})
		y -= 11

		if detalle := DetalleDeLaParte(parte); detalle != "" {
			y -= h.EscribirParrafo(detalle, Parrafo{
				Opciones: Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave},
				Ancho:    anchoUtil - Mm(40),
			})
		}
		y -= 6
	}

	h.Pagina.DibujarLinea(Linea{X1: Margen, Y1: y + 2, X2: derecha, Y2: y + 2, Grosor: 0.5, Color: ColorLinea})
	y -= 10
	h.Escribir("Total", Opciones{X: Margen, Y: y, Tamano: 10, Fuente: Negrita})
	h.Escribir(Pesos(r.Total), Opciones{X: derecha, Y: y, Tamano: 10, Fuente: Negrita, Derecha: true})
	y -= 20

	if r.SaldoDespues != nil && r.Estado == "emitido" {
		s := *r.SaldoDespues
		var texto string
		switch {
		case s > 0.005:
			texto = "Saldo de la cuenta después de este pago: " + Pesos(s) + "."
		case s < -0.005:
			texto = "Después de este pago la cuenta queda con " + Pesos(-s) + " a favor."
		default:
			texto = "Con este pago la cuenta queda saldada."
		}
		h.Escribir(texto, Opciones{X: Margen, Y: y, Tamano: 9})
		y -= 14
	}

	if conCheque {
		y -= h.EscribirParrafo("Los cheques se reciben salvo buen cobro: si el banco rechaza alguno, el importe vuelve a la cuenta.",
			Parrafo{Opciones: Opciones{X: Margen, Y: y, Tamano: 7.5, Color: TintaSuave}, Ancho: anchoUtil})
		y -= 6
	}

	// La firma de quien recibe la plata.
	yFirma := maximo(Margen+Mm(20), y-Mm(22))
	h.Pagina.DibujarLinea(Linea{X1: derecha - Mm(70), Y1: yFirma, X2: derecha, Y2: yFirma, Grosor: 0.5, Color: TintaSuave})
	firma := "Firma y aclaración"
	if r.EmitidoPor != "" {
		firma = "Recibió: " + r.EmitidoPor
	}
	h.Escribir(firma, Opciones{X: derecha - Mm(70), Y: yFirma - 10, Tamano: 7.5, Color: TintaSuave})

	h.Escribir("Documento no válido como factura.", Opciones{X: Margen, Y: Margen, Tamano: 7, Color: TintaSuave})

	if r.Estado == "anulado" {
		for _, p := range h.Doc.paginas {
			h.Pagina = p
			h.MarcaDeAgua("Anulado")
		}
		if r.MotivoAnulacion != "" {
			h.Escribir("Anulado: "+r.MotivoAnulacion, Opciones{X: Margen, Y: Margen + 10, Tamano: 7.5, Color: RGB(0.7, 0.15, 0.12)})
		}
	}

	return h.Bytes()
}

// DetalleDeLaParte es detalleDeLaParte: el cheque entero, o la operación.
// Vacío es el null del TS.
func DetalleDeLaParte(p ParteDelRecibo) string {
	if c := p.Cheque; c != nil {
		banco := "Sin banco"
		if c.Banco != nil {
			banco = *c.Banco
		}
		partes := []string{banco + " N° " + c.Numero, "al " + fechaLocalUTC(c.FechaPago)}
		if c.Librador != "" {
			partes = append(partes, "librado por "+c.Librador)
		}
		return strings.Join(partes, " · ")
	}
	if p.Referencia != "" {
		return "Operación " + p.Referencia
	}
	return ""
}
