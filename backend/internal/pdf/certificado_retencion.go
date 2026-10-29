package pdf

import (
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// El certificado de retención que se le entrega al proveedor
// (lib/pdf/certificado-retencion.ts). Es el comprobante con el que el
// proveedor computa la retención en su declaración: número propio, código
// del régimen y la base del cálculo. Uno por hoja.
//
// Espera a la tanda 8 (compras y retenciones): lo arma
// app/admin/compras/pagos/certificado/[numero]/route.ts.

// EmisorDelCertificado es el emisor del certificado. La razón social va con
// puntero porque el TS la usa con `??`: una tira vacía no se reemplaza.
type EmisorDelCertificado struct {
	RazonSocial    *string `json:"razonSocial"`
	NombreFantasia string  `json:"nombreFantasia"`
	Domicilio      string  `json:"domicilio"`
	Cuit           string  `json:"cuit"`
}

// DatosDelCertificado es DatosDelCertificado del TS.
type DatosDelCertificado struct {
	Numero        string                `json:"numero"`
	Fecha         time.Time             `json:"fecha"`
	Impuesto      string                `json:"impuesto"`
	CodigoRegimen string                `json:"codigoRegimen"`
	NombreRegimen string                `json:"nombreRegimen"`
	Base          float64               `json:"base"`
	Alicuota      float64               `json:"alicuota"`
	Importe       float64               `json:"importe"`
	Emisor        *EmisorDelCertificado `json:"emisor"`
	Proveedor     struct {
		Nombre      string `json:"nombre"`
		RazonSocial string `json:"razonSocial"`
		Cuit        string `json:"cuit"`
		Domicilio   string `json:"domicilio"`
	} `json:"proveedor"`
	Pago struct {
		Fecha      time.Time `json:"fecha"`
		Medio      string    `json:"medio"`
		Referencia string    `json:"referencia"`
	} `json:"pago"`
}

var certificadoImpuestos = map[string]string{
	"ganancias": "Impuesto a las Ganancias",
	"iva":       "Impuesto al Valor Agregado",
	"suss":      "Sistema Único de Seguridad Social",
	"iibb":      "Ingresos Brutos",
}

// CertificadoDeRetencion arma el PDF del certificado.
func CertificadoDeRetencion(d DatosDelCertificado, _ time.Time) ([]byte, error) {
	h := NuevaHoja()

	var emisor *Emisor
	if e := d.Emisor; e != nil {
		emisor = &Emisor{NombreFantasia: e.NombreFantasia, Domicilio: e.Domicilio, Cuit: e.Cuit}
		if e.RazonSocial != nil {
			emisor.RazonSocial = *e.RazonSocial
		}
	}

	y := AltoA4 - Margen
	y = h.EncabezadoEmisor(emisor, y)
	y -= Mm(6)

	h.EscribirCentrado("CERTIFICADO DE RETENCIÓN", AnchoA4/2, Opciones{Y: y, Tamano: 15, Fuente: Negrita})
	y -= Mm(7)

	impuesto, ok := certificadoImpuestos[d.Impuesto]
	if !ok {
		impuesto = d.Impuesto
	}
	h.EscribirCentrado(impuesto, AnchoA4/2, Opciones{Y: y, Tamano: 10, Color: TintaSuave})
	y -= Mm(10)

	h.Raya(y, 0, Color{})
	y -= Mm(8)

	columna := AnchoA4 / 2

	h.Escribir("Certificado n.º", Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
	h.Escribir(d.Numero, Opciones{X: Margen, Y: y - Mm(5), Tamano: 13, Fuente: Negrita})

	h.Escribir("Fecha", Opciones{X: columna, Y: y, Tamano: 8, Color: TintaSuave})
	h.Escribir(FechaLocal(d.Fecha), Opciones{X: columna, Y: y - Mm(5), Tamano: 13, Fuente: Negrita})

	y -= Mm(14)

	h.Escribir("Agente de retención", Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
	y -= Mm(5)
	razon := "Maderera Juan B. Justo"
	if d.Emisor != nil && d.Emisor.RazonSocial != nil {
		razon = *d.Emisor.RazonSocial
	}
	h.Escribir(razon, Opciones{X: Margen, Y: y, Tamano: 10})
	if d.Emisor != nil && d.Emisor.Cuit != "" {
		h.Escribir("CUIT "+Cuit(d.Emisor.Cuit), Opciones{X: AnchoA4 - Margen, Y: y, Tamano: 10, Derecha: true, Color: TintaSuave})
	}

	y -= Mm(10)

	h.Escribir("Sujeto retenido", Opciones{X: Margen, Y: y, Tamano: 8, Color: TintaSuave})
	y -= Mm(5)
	sujeto := d.Proveedor.RazonSocial
	if sujeto == "" {
		sujeto = d.Proveedor.Nombre
	}
	h.Escribir(sujeto, Opciones{X: Margen, Y: y, Tamano: 10})
	if d.Proveedor.Cuit != "" {
		h.Escribir("CUIT "+Cuit(d.Proveedor.Cuit), Opciones{X: AnchoA4 - Margen, Y: y, Tamano: 10, Derecha: true, Color: TintaSuave})
	}
	if d.Proveedor.Domicilio != "" {
		y -= Mm(5)
		h.Escribir(d.Proveedor.Domicilio, Opciones{X: Margen, Y: y, Tamano: 8.5, Color: TintaSuave})
	}

	y -= Mm(12)

	// El cuadro del cálculo: base, alícuota e importe, en ese orden.
	altoCuadro := Mm(34)
	h.Recuadro(Margen, y-altoCuadro, AnchoA4-Margen*2, altoCuadro, 0.7, ColorLinea)

	cuadro := y - Mm(8)
	izq := Margen + Mm(5)
	der := AnchoA4 - Margen - Mm(5)

	h.Escribir("Régimen", Opciones{X: izq, Y: cuadro, Tamano: 8, Color: TintaSuave})
	h.Escribir(d.CodigoRegimen+" · "+d.NombreRegimen, Opciones{X: der, Y: cuadro, Tamano: 9, Derecha: true})
	cuadro -= Mm(8)

	h.Escribir("Base de cálculo", Opciones{X: izq, Y: cuadro, Tamano: 8, Color: TintaSuave})
	h.Escribir(Moneda(d.Base), Opciones{X: der, Y: cuadro, Tamano: 9, Derecha: true})
	cuadro -= Mm(8)

	h.Escribir("Alícuota aplicada", Opciones{X: izq, Y: cuadro, Tamano: 8, Color: TintaSuave})
	h.Escribir(strings.Replace(jsmath.ToFixed(d.Alicuota, 2), ".", ",", 1)+" %", Opciones{X: der, Y: cuadro, Tamano: 9, Derecha: true})
	cuadro -= Mm(9)

	h.Escribir("IMPORTE RETENIDO", Opciones{X: izq, Y: cuadro, Tamano: 9, Fuente: Negrita})
	h.Escribir(Moneda(d.Importe), Opciones{X: der, Y: cuadro, Tamano: 13, Fuente: Negrita, Derecha: true})

	y -= altoCuadro + Mm(10)

	ref := ""
	if d.Pago.Referencia != "" {
		ref = " (" + d.Pago.Referencia + ")"
	}
	h.Escribir("Retención practicada sobre el pago del "+FechaLocal(d.Pago.Fecha)+" por "+d.Pago.Medio+ref+".",
		Opciones{X: Margen, Y: y, Tamano: 8.5, Color: TintaSuave})

	y -= Mm(24)

	// La firma va abajo y con espacio: este papel se firma a mano.
	h.Pagina.DibujarLinea(Linea{X1: Margen, Y1: y, X2: Margen + Mm(70), Y2: y, Grosor: 0.5, Color: ColorLinea})
	h.Escribir("Firma y sello del agente de retención", Opciones{X: Margen, Y: y - Mm(5), Tamano: 7.5, Color: TintaSuave})

	h.EscribirCentrado("Conserve este comprobante: le permite computar la retención en su declaración jurada.",
		AnchoA4/2, Opciones{Y: Margen + Mm(6), Tamano: 7.5, Color: TintaSuave})

	return h.Bytes()
}
