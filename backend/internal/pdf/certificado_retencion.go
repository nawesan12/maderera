package pdf

import (
	"math"
	"strings"
	"time"

	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
)

// El certificado de retención que se le entrega al proveedor
// (lib/pdf/certificado-retencion.ts). Es el comprobante con el que el
// proveedor computa la retención en su declaración: número propio, código
// del régimen y la base del cálculo. Uno por hoja.
//
// Lo sirve internal/compras (GET /api/v1/admin/compras/certificados/{numero}/pdf)
// y app/admin/compras/pagos/certificado/[numero]/route.ts lo pasa.
//
// Con Calculo, el cuadro muestra la cuenta entera —base del pago, acumulado
// del mes, mínimo no imponible, monto sujeto, alícuota, lo ya retenido en el
// mes y lo retenido—: la retención sale del acumulado del mes, no de la base
// de este pago, y con la base sola el número no cierra a la vista. Sin
// Calculo (los certificados de antes de la 00089, y el golden del TS) sale
// el cuadro de siempre.

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
	Calculo *CalculoDelCertificado `json:"calculo,omitempty"`
	// Anulado lleva la marca de agua: se anuló el pago que lo originó.
	Anulado bool `json:"anulado,omitempty"`
}

// CalculoDelCertificado es lo que se usó para calcular la retención, tal como
// quedó guardado en ese momento.
type CalculoDelCertificado struct {
	// Acumulado son las bases del mes con la de este pago incluida.
	Acumulado float64 `json:"acumulado"`
	// Imponible es el monto sujeto a retención: el acumulado menos el
	// mínimo no imponible.
	Imponible float64 `json:"imponible"`
	// RetenidoAntes es lo ya retenido en el mes antes de este certificado.
	RetenidoAntes float64 `json:"retenidoAntes"`
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

	if d.Calculo != nil {
		y = cuadroConCalculo(h, d, y)
	} else {
		y = cuadroSimple(h, d, y)
	}

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

	if d.Anulado {
		h.MarcaDeAgua("Anulado")
	}

	return h.Bytes()
}

// pesos es el importe con centavos («$ 176.000,00»): en el cuadro del cálculo
// la cuenta tiene que cerrar al centavo, y Moneda redondea a pesos.
func pesos(v float64) string {
	entero, centavos, _ := strings.Cut(jsmath.Fijo2(math.Abs(v)), ".")
	signo := ""
	if v < 0 {
		signo = "-"
	}
	return signo + "$ " + formato.Miles(entero) + "," + centavos
}

func porcentaje(a float64) string { return strings.Replace(jsmath.ToFixed(a, 2), ".", ",", 1) + " %" }

// cuadroSimple es el cuadro del TS: base, alícuota e importe, en ese orden.
// Devuelve dónde sigue el cursor.
func cuadroSimple(h *Hoja, d DatosDelCertificado, y float64) float64 {
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
	h.Escribir(porcentaje(d.Alicuota), Opciones{X: der, Y: cuadro, Tamano: 9, Derecha: true})
	cuadro -= Mm(9)

	h.Escribir("IMPORTE RETENIDO", Opciones{X: izq, Y: cuadro, Tamano: 9, Fuente: Negrita})
	h.Escribir(Moneda(d.Importe), Opciones{X: der, Y: cuadro, Tamano: 13, Fuente: Negrita, Derecha: true})

	return y - altoCuadro - Mm(10)
}

// cuadroConCalculo es el cuadro con la cuenta entera, renglón por renglón,
// para que el proveedor (y su contador) la puedan rehacer con una
// calculadora:
//
//	acumulado del mes − mínimo no imponible = monto sujeto
//	monto sujeto × alícuota − ya retenido en el mes = importe retenido
func cuadroConCalculo(h *Hoja, d DatosDelCertificado, y float64) float64 {
	c := d.Calculo
	minimo := jsmath.Redondear2(c.Acumulado - c.Imponible)
	anteriores := jsmath.Redondear2(c.Acumulado - d.Base)
	delMes := jsmath.Redondear2(float64(c.Imponible*d.Alicuota) / 100)

	type renglon struct {
		etiqueta, valor string
		raya            bool // una raya fina antes: es un subtotal
	}
	renglones := []renglon{
		{"Base de este pago", pesos(d.Base), false},
		{"Pagos anteriores del mes", pesos(anteriores), false},
		{"Acumulado del mes", pesos(c.Acumulado), true},
		{"Menos mínimo no imponible", "- " + pesos(minimo), false},
		{"Monto sujeto a retención", pesos(c.Imponible), true},
		{"Alícuota aplicada", porcentaje(d.Alicuota), false},
		{"Retención del mes (sujeto × alícuota)", pesos(delMes), true},
		{"Menos ya retenido en el mes", "- " + pesos(c.RetenidoAntes), false},
	}

	paso := Mm(6.5)
	altoCuadro := Mm(8) + paso*float64(len(renglones)+1) + Mm(9)
	h.Recuadro(Margen, y-altoCuadro, AnchoA4-Margen*2, altoCuadro, 0.7, ColorLinea)

	cuadro := y - Mm(8)
	izq := Margen + Mm(5)
	der := AnchoA4 - Margen - Mm(5)

	h.Escribir("Régimen", Opciones{X: izq, Y: cuadro, Tamano: 8, Color: TintaSuave})
	h.Escribir(d.CodigoRegimen+" · "+d.NombreRegimen, Opciones{X: der, Y: cuadro, Tamano: 9, Derecha: true})
	cuadro -= paso + Mm(1.5)

	for _, r := range renglones {
		if r.raya {
			h.Pagina.DibujarLinea(Linea{X1: der - Mm(45), Y1: cuadro + Mm(4.2), X2: der, Y2: cuadro + Mm(4.2), Grosor: 0.4, Color: ColorLinea})
		}
		fuente := Normal
		if r.raya {
			fuente = Negrita
		}
		h.Escribir(r.etiqueta, Opciones{X: izq, Y: cuadro, Tamano: 8.5, Color: TintaSuave})
		h.Escribir(r.valor, Opciones{X: der, Y: cuadro, Tamano: 9, Fuente: fuente, Derecha: true})
		cuadro -= paso
	}
	cuadro -= Mm(2.5)

	h.Escribir("IMPORTE RETENIDO", Opciones{X: izq, Y: cuadro, Tamano: 9, Fuente: Negrita})
	h.Escribir(pesos(d.Importe), Opciones{X: der, Y: cuadro, Tamano: 13, Fuente: Negrita, Derecha: true})

	return y - altoCuadro - Mm(10)
}
