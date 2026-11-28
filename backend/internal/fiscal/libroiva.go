package fiscal

import (
	"archive/zip"
	"bytes"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"mjbj/internal/jsmath"
)

// El Libro IVA Digital (régimen de información de compras y ventas, RG 4597
// de ARCA): los cuatro archivos de ancho fijo que el contador importa en el
// aplicativo. Sin base de datos: facturacion junta los comprobantes y esto
// los escribe.
//
// El diseño de registro es el de la RG 3685 que retomó la 4597:
//
//	VENTAS_CBTE        266 posiciones
//	VENTAS_ALICUOTAS    62
//	COMPRAS_CBTE       325
//	COMPRAS_ALICUOTAS   84
//
// Los numéricos van a la derecha con ceros; los importes en centavos sin
// separador (15 posiciones); las fechas AAAAMMDD en hora argentina; los
// textos a la izquierda con espacios. Una nota de crédito va en positivo: el
// tipo de comprobante ya dice que resta.
//
// Dudas del formato que no se pudieron confirmar contra el diseño oficial (la
// lista está también en la respuesta del cambio, para el contador):
//
//   - Código de operación: «0» cuando hay IVA; «E» si todo es exento y «N» si
//     todo es no gravado. Hay versiones del instructivo que piden un espacio
//     en vez del cero.
//   - Un comprobante A o B sin nada gravado (todo exento) se informa con una
//     alícuota de 0 % (código 3) con neto e impuesto en cero.
//   - Fecha de vencimiento de pago (ventas): en ceros. Solo es obligatoria
//     para servicios y la maderera factura con concepto 1 (productos).
//   - Los tributos de la factura de venta se reparten por su código de WSFE:
//     6 (percepción de IVA) y 1 a nacionales, 2/5/7 a Ingresos Brutos, 3/8 a
//     municipales, 4 a internos, 13 a no categorizados y el resto a «otros
//     tributos».
//   - En compras, una factura de antes de la 00101 tiene las percepciones sin
//     discriminar: van a «otros tributos».
//   - En compras, el neto gravado por alícuota no se guarda: con una sola
//     alícuota es el neto entero; con varias se deduce del IVA (IVA / tasa) y
//     la diferencia de redondeo queda en la de más IVA.
//   - Los textos se pasan a ASCII (sin tildes ni eñes) para que el ancho en
//     bytes sea exacto, y los renglones terminan en CRLF.
//   - Los tiques y los «otros» de compras no tienen un código de ARCA seguro:
//     no van a los archivos y se listan en OMITIDOS.txt dentro del .zip.

// Largos de cada registro.
const (
	LargoVentasCbte       = 266
	LargoVentasAlicuotas  = 62
	LargoComprasCbte      = 325
	LargoComprasAlicuotas = 84
)

// CodigoComprobanteCompra es el código de ARCA de los tipos de compra. Los
// que no están (ticket, otro) no se informan.
var CodigoComprobanteCompra = map[string]int{
	"factura_a": 1, "nota_debito_a": 2, "nota_credito_a": 3,
	"factura_b": 6, "nota_debito_b": 7, "nota_credito_b": 8,
	"factura_c": 11, "nota_debito_c": 12, "nota_credito_c": 13,
	"factura_m": 51,
}

// ComprobanteDelLibro es un comprobante de compra o de venta, con los
// importes en positivo.
type ComprobanteDelLibro struct {
	Fecha      time.Time
	Codigo     int // el tipo de comprobante de ARCA
	PuntoVenta int64
	Numero     int64
	// El documento de la otra parte: el comprador en ventas, el vendedor en
	// compras.
	Documento *string
	Nombre    string

	Total     float64
	NoGravado float64
	Exento    float64

	PercepcionNoCategorizados float64 // solo ventas
	PercepcionIva             float64 // solo compras (en ventas va con nacionales)
	PercepcionNacionales      float64
	PercepcionIibb            float64
	PercepcionMunicipales     float64
	ImpuestosInternos         float64
	OtrosTributos             float64

	// Discrimina: el comprobante lleva el IVA aparte (A y B en ventas; A y M
	// en compras). Si no, no se informan alícuotas.
	Discrimina bool
	// Las alícuotas gravadas (más de cero), en el orden en que se mandaron.
	Alicuotas []IvaDeAlicuota
	// CreditoFiscal es el crédito computable (solo compras).
	CreditoFiscal float64
}

// ArchivosLibroIva son los cuatro archivos ya escritos.
type ArchivosLibroIva struct {
	VentasCbte, VentasAlicuotas, ComprasCbte, ComprasAlicuotas string
}

// --- los campos ---

func ceros(n int64, largo int) string {
	if n < 0 {
		n = -n
	}
	s := strconv.FormatInt(n, 10)
	if len(s) > largo {
		return s[len(s)-largo:]
	}
	return strings.Repeat("0", largo-len(s)) + s
}

// Centavos es el importe sin separador: 1210.5 → 121050. Va siempre en
// positivo; el tipo de comprobante dice el signo.
func Centavos(v float64) int64 {
	c := jsmath.Round(float64(v * 100))
	if c < 0 {
		c = -c
	}
	return int64(c)
}

func importeLibro(v float64) string { return ceros(Centavos(v), 15) }

// textoLibro pasa a ASCII imprimible, recorta y rellena con espacios.
func textoLibro(s string, largo int) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		switch {
		case unicode.Is(unicode.Mn, r):
			// la tilde que quedó suelta al descomponer
		case r == '\t' || r == '\n' || r == '\r':
			b.WriteByte(' ')
		case r >= 0x20 && r < 0x7f:
			b.WriteRune(r)
		default:
			b.WriteByte(' ')
		}
	}
	t := strings.TrimSpace(b.String())
	if len(t) > largo {
		t = t[:largo]
	}
	return t + strings.Repeat(" ", largo-len(t))
}

// documento: 80 con CUIT, 96 con DNI, 99 consumidor final con número cero.
func documento(doc *string) (string, string) {
	tipo, numero := DocumentoReceptor(doc)
	return ceros(int64(tipo), 2), ceros(int64(numero), 20)
}

// alicuotasAInformar: las gravadas; si el comprobante discrimina y no tiene
// ninguna, una de 0 % en cero (ver las dudas arriba).
func alicuotasAInformar(c ComprobanteDelLibro) []IvaDeAlicuota {
	if !c.Discrimina {
		return nil
	}
	var out []IvaDeAlicuota
	for _, a := range c.Alicuotas {
		if a.Alicuota > 0 {
			out = append(out, a)
		}
	}
	if len(out) == 0 {
		out = []IvaDeAlicuota{{Alicuota: 0}}
	}
	return out
}

func codigoOperacion(c ComprobanteDelLibro, alicuotas []IvaDeAlicuota) string {
	for _, a := range alicuotas {
		if a.Alicuota > 0 {
			return "0"
		}
	}
	switch {
	case c.Exento > 0:
		return "E"
	case c.NoGravado > 0:
		return "N"
	}
	return "0"
}

func codigoAlicuota(a float64) string {
	if v, ok := CodigoAlicuotaArca[a]; ok {
		return ceros(int64(v), 4)
	}
	return ceros(5, 4)
}

const (
	moneda      = "PES"
	tipoCambio  = "0001000000" // 1, con 4 enteros y 6 decimales
	finDeLinea  = "\r\n"
	sinCorredor = "00000000000"
)

// --- los registros ---

// RegistroVentaCbte es un renglón de VENTAS_CBTE.
func RegistroVentaCbte(c ComprobanteDelLibro) string {
	al := alicuotasAInformar(c)
	tipoDoc, nroDoc := documento(c.Documento)
	var b strings.Builder
	b.WriteString(FechaArca(c.Fecha))                        // 1 fecha
	b.WriteString(ceros(int64(c.Codigo), 3))                 // 2 tipo
	b.WriteString(ceros(c.PuntoVenta, 5))                    // 3 punto de venta
	b.WriteString(ceros(c.Numero, 20))                       // 4 número
	b.WriteString(ceros(c.Numero, 20))                       // 5 número hasta
	b.WriteString(tipoDoc)                                   // 6 código de documento del comprador
	b.WriteString(nroDoc)                                    // 7 número de identificación
	b.WriteString(textoLibro(c.Nombre, 30))                  // 8 apellido y nombre o denominación
	b.WriteString(importeLibro(c.Total))                     // 9 total
	b.WriteString(importeLibro(c.NoGravado))                 // 10 no integra el neto gravado
	b.WriteString(importeLibro(c.PercepcionNoCategorizados)) // 11 percepción a no categorizados
	b.WriteString(importeLibro(c.Exento))                    // 12 operaciones exentas
	b.WriteString(importeLibro(c.PercepcionNacionales))      // 13 percepciones nacionales
	b.WriteString(importeLibro(c.PercepcionIibb))            // 14 Ingresos Brutos
	b.WriteString(importeLibro(c.PercepcionMunicipales))     // 15 municipales
	b.WriteString(importeLibro(c.ImpuestosInternos))         // 16 internos
	b.WriteString(moneda)                                    // 17 moneda
	b.WriteString(tipoCambio)                                // 18 tipo de cambio
	b.WriteString(strconv.Itoa(min(len(al), 9)))             // 19 cantidad de alícuotas
	b.WriteString(codigoOperacion(c, al))                    // 20 código de operación
	b.WriteString(importeLibro(c.OtrosTributos))             // 21 otros tributos
	b.WriteString("00000000")                                // 22 vencimiento de pago
	return b.String()
}

// RegistroVentaAlicuota es un renglón de VENTAS_ALICUOTAS.
func RegistroVentaAlicuota(c ComprobanteDelLibro, a IvaDeAlicuota) string {
	return ceros(int64(c.Codigo), 3) + ceros(c.PuntoVenta, 5) + ceros(c.Numero, 20) +
		importeLibro(a.Base) + codigoAlicuota(a.Alicuota) + importeLibro(a.Importe)
}

// RegistroCompraCbte es un renglón de COMPRAS_CBTE.
func RegistroCompraCbte(c ComprobanteDelLibro) string {
	al := alicuotasAInformar(c)
	tipoDoc, nroDoc := documento(c.Documento)
	var b strings.Builder
	b.WriteString(FechaArca(c.Fecha))                    // 1 fecha
	b.WriteString(ceros(int64(c.Codigo), 3))             // 2 tipo
	b.WriteString(ceros(c.PuntoVenta, 5))                // 3 punto de venta
	b.WriteString(ceros(c.Numero, 20))                   // 4 número
	b.WriteString(strings.Repeat(" ", 16))               // 5 despacho de importación
	b.WriteString(tipoDoc)                               // 6 código de documento del vendedor
	b.WriteString(nroDoc)                                // 7 número de identificación
	b.WriteString(textoLibro(c.Nombre, 30))              // 8 apellido y nombre o denominación
	b.WriteString(importeLibro(c.Total))                 // 9 total
	b.WriteString(importeLibro(c.NoGravado))             // 10 no integra el neto gravado
	b.WriteString(importeLibro(c.Exento))                // 11 operaciones exentas
	b.WriteString(importeLibro(c.PercepcionIva))         // 12 percepciones de IVA
	b.WriteString(importeLibro(c.PercepcionNacionales))  // 13 otros nacionales
	b.WriteString(importeLibro(c.PercepcionIibb))        // 14 Ingresos Brutos
	b.WriteString(importeLibro(c.PercepcionMunicipales)) // 15 municipales
	b.WriteString(importeLibro(c.ImpuestosInternos))     // 16 internos
	b.WriteString(moneda)                                // 17 moneda
	b.WriteString(tipoCambio)                            // 18 tipo de cambio
	b.WriteString(strconv.Itoa(min(len(al), 9)))         // 19 cantidad de alícuotas
	b.WriteString(codigoOperacion(c, al))                // 20 código de operación
	b.WriteString(importeLibro(c.CreditoFiscal))         // 21 crédito fiscal computable
	b.WriteString(importeLibro(c.OtrosTributos))         // 22 otros tributos
	b.WriteString(sinCorredor)                           // 23 CUIT del emisor/corredor
	b.WriteString(strings.Repeat(" ", 30))               // 24 denominación del emisor/corredor
	b.WriteString(importeLibro(0))                       // 25 IVA comisión
	return b.String()
}

// RegistroCompraAlicuota es un renglón de COMPRAS_ALICUOTAS.
func RegistroCompraAlicuota(c ComprobanteDelLibro, a IvaDeAlicuota) string {
	tipoDoc, nroDoc := documento(c.Documento)
	return ceros(int64(c.Codigo), 3) + ceros(c.PuntoVenta, 5) + ceros(c.Numero, 20) + tipoDoc + nroDoc +
		importeLibro(a.Base) + codigoAlicuota(a.Alicuota) + importeLibro(a.Importe)
}

// EscribirLibroIva arma los cuatro archivos.
func EscribirLibroIva(ventas, compras []ComprobanteDelLibro) ArchivosLibroIva {
	var vc, va, cc, ca strings.Builder
	for _, c := range ventas {
		vc.WriteString(RegistroVentaCbte(c) + finDeLinea)
		for _, a := range alicuotasAInformar(c) {
			va.WriteString(RegistroVentaAlicuota(c, a) + finDeLinea)
		}
	}
	for _, c := range compras {
		cc.WriteString(RegistroCompraCbte(c) + finDeLinea)
		for _, a := range alicuotasAInformar(c) {
			ca.WriteString(RegistroCompraAlicuota(c, a) + finDeLinea)
		}
	}
	return ArchivosLibroIva{VentasCbte: vc.String(), VentasAlicuotas: va.String(), ComprasCbte: cc.String(), ComprasAlicuotas: ca.String()}
}

// ZipLibroIva es el .zip que se baja: los cuatro archivos con el período en
// el nombre y, si algo de compras no se pudo informar, OMITIDOS.txt.
func ZipLibroIva(clave string, a ArchivosLibroIva, omitidos []string) ([]byte, error) {
	sufijo := "_" + strings.ReplaceAll(clave, "-", "") + ".txt"
	archivos := [][2]string{
		{"VENTAS_CBTE" + sufijo, a.VentasCbte},
		{"VENTAS_ALICUOTAS" + sufijo, a.VentasAlicuotas},
		{"COMPRAS_CBTE" + sufijo, a.ComprasCbte},
		{"COMPRAS_ALICUOTAS" + sufijo, a.ComprasAlicuotas},
	}
	if len(omitidos) > 0 {
		archivos = append(archivos, [2]string{"OMITIDOS.txt", strings.Join(omitidos, finDeLinea) + finDeLinea})
	}
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for _, f := range archivos {
		// Un archivo vacío no va: el de ventas de un mes sin nada autorizado
		// bajaba en 0 bytes y quien recibía el .zip no sabía por qué
		// (M2S4-045). Lo que no se informó está en OMITIDOS.txt.
		if f[1] == "" {
			continue
		}
		w, err := z.Create(f[0])
		if err != nil {
			return nil, err
		}
		if _, err := w.Write([]byte(f[1])); err != nil {
			return nil, err
		}
	}
	if err := z.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// AgruparIva suma un renglón a la alícuota que le toca, en el orden en que
// aparecen: lo mismo que se manda a ARCA en el AlicIva (y por eso el libro
// cierra con lo autorizado). Un renglón sin alícuota no suma.
func AgruparIva(lista []IvaDeAlicuota, alicuota, neto, iva float64) []IvaDeAlicuota {
	if alicuota <= 0 {
		return lista
	}
	i := -1
	for k, x := range lista {
		if x.Alicuota == alicuota {
			i = k
		}
	}
	if i < 0 {
		lista = append(lista, IvaDeAlicuota{Alicuota: alicuota})
		i = len(lista) - 1
	}
	lista[i].Base = Redondear(lista[i].Base + neto)
	lista[i].Importe = Redondear(lista[i].Importe + iva)
	return lista
}

// NetosDeCompra reparte el neto de una factura de compra entre sus
// alícuotas, que no se guardan por separado: con una sola es el neto entero;
// con varias, cada base es el IVA sobre la tasa y la diferencia de redondeo
// queda en la de más IVA (así las bases suman el neto cargado).
func NetosDeCompra(neto, iva21, iva105, iva27 float64) []IvaDeAlicuota {
	var out []IvaDeAlicuota
	for _, x := range []IvaDeAlicuota{{Alicuota: 21, Importe: iva21}, {Alicuota: 10.5, Importe: iva105}, {Alicuota: 27, Importe: iva27}} {
		if x.Importe > 0 {
			out = append(out, x)
		}
	}
	switch len(out) {
	case 0:
		return nil
	case 1:
		out[0].Base = neto
		return out
	}
	mayor := 0
	for i := range out {
		if out[i].Importe > out[mayor].Importe {
			mayor = i
		}
	}
	resto := neto
	for i := range out {
		if i == mayor {
			continue
		}
		out[i].Base = Redondear(out[i].Importe / (out[i].Alicuota / 100))
		resto = Redondear(resto - out[i].Base)
	}
	out[mayor].Base = resto
	return out
}

// TributosDeVenta reparte los tributos de una factura de venta en los campos
// del libro según el código de WSFE (FEParamGetTiposTributos).
func TributosDeVenta(c *ComprobanteDelLibro, codigo string, importe float64) {
	n, _ := strconv.Atoi(strings.TrimSpace(codigo))
	switch n {
	case 1, 6:
		c.PercepcionNacionales += importe
	case 2, 5, 7:
		c.PercepcionIibb += importe
	case 3, 8:
		c.PercepcionMunicipales += importe
	case 4:
		c.ImpuestosInternos += importe
	case 13:
		c.PercepcionNoCategorizados += importe
	default:
		c.OtrosTributos += importe
	}
}

// OrdenarLibro deja los comprobantes por fecha, tipo, punto de venta y
// número, que es como el aplicativo los espera.
func OrdenarLibro(l []ComprobanteDelLibro) {
	sort.SliceStable(l, func(i, j int) bool {
		a, b := l[i], l[j]
		if fa, fb := FechaArca(a.Fecha), FechaArca(b.Fecha); fa != fb {
			return fa < fb
		}
		if a.Codigo != b.Codigo {
			return a.Codigo < b.Codigo
		}
		if a.PuntoVenta != b.PuntoVenta {
			return a.PuntoVenta < b.PuntoVenta
		}
		return a.Numero < b.Numero
	})
}
