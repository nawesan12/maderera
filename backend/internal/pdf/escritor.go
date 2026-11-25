// Package pdf arma los documentos del sistema (remitos, comprobantes,
// recibos, listas de precios…) igual que lib/pdf/** con pdf-lib.
//
// # Por qué una escritura propia y no go-pdf/fpdf
//
// El plan decía fpdf. Se probó el camino contrario —escribir el PDF a mano—
// porque lo que se busca es que el papel salga idéntico al de hoy, y fpdf
// mete sus propias decisiones en el medio: mide con sus tablas de Helvetica
// (sin el kerning que pdf-lib suma al medir), coloca el texto desde la línea
// de arriba y no desde la línea de base, redondea las coordenadas a dos
// decimales, y dibuja rectángulos y líneas con sus propios operadores. Cada
// una de esas cosas mueve un renglón medio punto o corta una línea en otro
// lugar.
//
// Lo que pdf-lib escribe es poco y simple: un flujo de operadores de PDF por
// página (q, BT, Tf, Tm, Tj, m, l, re, cm, Do…), las 14 fuentes estándar sin
// incrustar (Type1 con WinAnsiEncoding) y las imágenes PNG separadas en RGB y
// alfa. Este paquete escribe **los mismos operadores con los mismos números**
// (numberToString de pdf-lib) y mide con las mismas tablas
// (metricas.gen.go, generado desde @pdf-lib/standard-fonts). El resultado
// rasterizado es el mismo píxel a píxel, sin dependencias nuevas, y el
// documento sale en una fracción del tiempo.
package pdf

import (
	"bytes"
	"compress/zlib"
	"errors"
	"fmt"
	"image/color"
	"image/png"
	"math"
	"strconv"
	"strings"
)

// Fuente es una de las fuentes estándar de PDF.
type Fuente int

// Las fuentes estándar con WinAnsi. El valor cero es Helvetica, que es la
// fuente por omisión de los documentos.
const (
	Helvetica Fuente = iota
	HelveticaBold
	HelveticaOblique
	HelveticaBoldOblique
	Courier
	CourierBold
	CourierOblique
	CourierBoldOblique
	TimesRoman
	TimesBold
	TimesItalic
	TimesBoldItalic
)

type metrica struct {
	nombre string
	ancho  [256]int16
	kern   map[uint16]int16
}

// Codificar pasa un texto a WinAnsi. Igual que pdf-lib, un carácter que la
// codificación no tiene es un error (por eso los documentos limpian antes).
func Codificar(texto string) ([]byte, error) {
	b := make([]byte, 0, len(texto))
	for _, r := range texto {
		c, ok := winAnsi[r]
		if !ok {
			return nil, fmt.Errorf("WinAnsi cannot encode %q (0x%04x)", string(r), r)
		}
		b = append(b, c)
	}
	return b, nil
}

// Ancho es widthOfTextAtSize de pdf-lib: la suma de los anchos de los glifos
// más el kerning de cada par, por el tamaño sobre mil. Los caracteres que
// WinAnsi no tiene no se cuentan (pdf-lib tiraría un error).
func (f Fuente) Ancho(texto string, tamano float64) float64 {
	m := metricas[f]
	total := 0
	var anterior int = -1
	for _, r := range texto {
		c, ok := winAnsi[r]
		if !ok {
			continue
		}
		if anterior >= 0 {
			total += int(m.kern[uint16(anterior)<<8|uint16(c)])
		}
		total += int(m.ancho[c])
		anterior = int(c)
	}
	escala := tamano / 1000
	return float64(total) * escala
}

// Color es un color RGB de 0 a 1. El valor cero significa «el de siempre»
// (cada función dice cuál); para el negro está Negro.
type Color struct {
	R, G, B  float64
	definido bool
}

// RGB arma un color, como rgb() de pdf-lib.
func RGB(r, g, b float64) Color { return Color{R: r, G: g, B: b, definido: true} }

// Negro es rgb(0, 0, 0).
var Negro = RGB(0, 0, 0)

// Definido dice si el color se eligió (y no es el valor cero).
func (c Color) Definido() bool { return c.definido }

func (c Color) o(otro Color) Color {
	if c.definido {
		return c
	}
	return otro
}

// num es numberToString de pdf-lib: String(n) de JS, salvo que los números
// muy chicos o muy grandes se escriben sin exponente (lo que en JS es
// «1e-7» pdf-lib lo escribe «0.0000001»).
func num(n float64) string {
	if n == 0 {
		return "0" // también el -0, como String(-0)
	}
	return strconv.FormatFloat(n, 'f', -1, 64)
}

// Documento es un PDF en armado.
type Documento struct {
	objetos  [][]byte // el objeto n está en objetos[n-1]
	paginas  []*Pagina
	fuentes  map[Fuente]int
	err      error
	raizPags int
}

// Nuevo arranca un documento vacío.
func Nuevo() *Documento {
	d := &Documento{fuentes: map[Fuente]int{}}
	d.raizPags = d.reservar()
	return d
}

func (d *Documento) reservar() int {
	d.objetos = append(d.objetos, nil)
	return len(d.objetos)
}

func (d *Documento) poner(n int, obj []byte) { d.objetos[n-1] = obj }

func (d *Documento) agregar(obj []byte) int {
	n := d.reservar()
	d.poner(n, obj)
	return n
}

func (d *Documento) fallar(err error) {
	if d.err == nil {
		d.err = err
	}
}

// Err devuelve el primer error del armado (un texto que no se pudo codificar).
func (d *Documento) Err() error { return d.err }

func (d *Documento) fuente(f Fuente) int {
	if n, ok := d.fuentes[f]; ok {
		return n
	}
	n := d.agregar([]byte(fmt.Sprintf("<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /%s\n/Encoding /WinAnsiEncoding\n>>", metricas[f].nombre)))
	d.fuentes[f] = n
	return n
}

// AgregarPagina suma una página del tamaño pedido, en puntos.
func (d *Documento) AgregarPagina(ancho, alto float64) *Pagina {
	p := &Pagina{doc: d, Ancho: ancho, Alto: alto, recursos: map[string]map[string]int{}}
	d.paginas = append(d.paginas, p)
	return p
}

// Paginas dice cuántas páginas lleva.
func (d *Documento) Paginas() int { return len(d.paginas) }

// Imagen es una imagen ya incrustada en un documento.
type Imagen struct {
	num           int
	Ancho, Alto   float64
	ancho0, alto0 int
}

// imagenCruda es una PNG ya separada y comprimida, lista para incrustarse
// en cualquier documento (el logo se prepara una sola vez por proceso).
type imagenCruda struct {
	ancho, alto int
	rgb, alfa   []byte // comprimidos con Flate; alfa es nil si es opaca
}

// prepararPNG decodifica una PNG como pdf-lib (UPNG.toRGBA8): ocho bits por
// canal, sin premultiplicar, y el alfa aparte solo si algún píxel no es opaco.
func prepararPNG(datos []byte) (*imagenCruda, error) {
	img, err := png.Decode(bytes.NewReader(datos))
	if err != nil {
		return nil, err
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	rgb := make([]byte, 0, w*h*3)
	alfa := make([]byte, 0, w*h)
	conAlfa := false
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
			rgb = append(rgb, c.R, c.G, c.B)
			alfa = append(alfa, c.A)
			if c.A < 255 {
				conAlfa = true
			}
		}
	}
	cr := &imagenCruda{ancho: w, alto: h, rgb: comprimir(rgb)}
	if conAlfa {
		cr.alfa = comprimir(alfa)
	}
	return cr, nil
}

func comprimir(b []byte) []byte {
	var buf bytes.Buffer
	z := zlib.NewWriter(&buf)
	_, _ = z.Write(b)
	_ = z.Close()
	return buf.Bytes()
}

func flujo(dicc string, datos []byte) []byte {
	var b bytes.Buffer
	fmt.Fprintf(&b, "<<\n%s/Length %d\n/Filter /FlateDecode\n>>\nstream\n", dicc, len(datos))
	b.Write(datos)
	b.WriteString("\nendstream")
	return b.Bytes()
}

func (d *Documento) incrustar(cr *imagenCruda) *Imagen {
	smask := ""
	if cr.alfa != nil {
		n := d.agregar(flujo(fmt.Sprintf("/Type /XObject\n/Subtype /Image\n/Height %d\n/Width %d\n/BitsPerComponent 8\n/ColorSpace /DeviceGray\n/Decode [ 0 1 ]\n", cr.alto, cr.ancho), cr.alfa))
		smask = fmt.Sprintf("/SMask %d 0 R\n", n)
	}
	n := d.agregar(flujo(fmt.Sprintf("/Type /XObject\n/Subtype /Image\n/BitsPerComponent 8\n/Width %d\n/Height %d\n/ColorSpace /DeviceRGB\n%s", cr.ancho, cr.alto, smask), cr.rgb))
	return &Imagen{num: n, Ancho: float64(cr.ancho), Alto: float64(cr.alto), ancho0: cr.ancho, alto0: cr.alto}
}

// IncrustarPNG es embedPng.
func (d *Documento) IncrustarPNG(datos []byte) (*Imagen, error) {
	cr, err := prepararPNG(datos)
	if err != nil {
		return nil, err
	}
	return d.incrustar(cr), nil
}

// Bytes cierra el documento y lo devuelve.
func (d *Documento) Bytes() ([]byte, error) {
	if d.err != nil {
		return nil, d.err
	}
	// Las páginas.
	kids := make([]string, len(d.paginas))
	for i, p := range d.paginas {
		contenido := d.agregar(flujo("", comprimir(p.cs.Bytes())))
		var rec strings.Builder
		for _, tipo := range []string{"Font", "XObject", "ExtGState"} {
			m := p.recursos[tipo]
			if len(m) == 0 {
				continue
			}
			fmt.Fprintf(&rec, "/%s <<", tipo)
			for _, nombre := range p.orden[tipo] {
				fmt.Fprintf(&rec, " /%s %d 0 R", nombre, m[nombre])
			}
			rec.WriteString(" >>\n")
		}
		n := d.agregar([]byte(fmt.Sprintf("<<\n/Type /Page\n/Parent %d 0 R\n/MediaBox [ 0 0 %s %s ]\n/Contents %d 0 R\n/Resources <<\n/ProcSet [ /PDF /Text /ImageB /ImageC /ImageI ]\n%s>>\n>>",
			d.raizPags, num(p.Ancho), num(p.Alto), contenido, rec.String())))
		kids[i] = fmt.Sprintf("%d 0 R", n)
	}
	d.poner(d.raizPags, []byte(fmt.Sprintf("<<\n/Type /Pages\n/Kids [ %s ]\n/Count %d\n>>", strings.Join(kids, " "), len(kids))))
	catalogo := d.agregar([]byte(fmt.Sprintf("<<\n/Type /Catalog\n/Pages %d 0 R\n>>", d.raizPags)))
	info := d.agregar([]byte("<<\n/Producer (mjbj)\n>>"))

	var out bytes.Buffer
	out.WriteString("%PDF-1.7\n%\x81\x81\x81\x81\n\n")
	desde := make([]int, len(d.objetos))
	for i, obj := range d.objetos {
		if obj == nil {
			return nil, errors.New("pdf: objeto sin escribir")
		}
		desde[i] = out.Len()
		fmt.Fprintf(&out, "%d 0 obj\n", i+1)
		out.Write(obj)
		out.WriteString("\nendobj\n\n")
	}
	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(d.objetos)+1)
	for _, o := range desde {
		fmt.Fprintf(&out, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&out, "trailer\n<<\n/Size %d\n/Root %d 0 R\n/Info %d 0 R\n>>\nstartxref\n%d\n%%%%EOF", len(d.objetos)+1, catalogo, info, xref)
	return out.Bytes(), nil
}

// Pagina es una hoja del documento. Los métodos escriben los mismos
// operadores que los draw* de PDFPage en pdf-lib 1.17.
type Pagina struct {
	doc          *Documento
	Ancho, Alto  float64
	cs           bytes.Buffer
	recursos     map[string]map[string]int
	orden        map[string][]string
	nombresFuent map[Fuente]string
}

func (p *Pagina) op(partes ...string) {
	p.cs.WriteString(strings.Join(partes, " "))
	p.cs.WriteByte('\n')
}

func (p *Pagina) recurso(tipo, prefijo string, n int) string {
	if p.orden == nil {
		p.orden = map[string][]string{}
	}
	m := p.recursos[tipo]
	if m == nil {
		m = map[string]int{}
		p.recursos[tipo] = m
	}
	nombre := fmt.Sprintf("%s%d", prefijo, len(m)+1)
	m[nombre] = n
	p.orden[tipo] = append(p.orden[tipo], nombre)
	return nombre
}

func (p *Pagina) claveFuente(f Fuente) string {
	if p.nombresFuent == nil {
		p.nombresFuent = map[Fuente]string{}
	}
	if k, ok := p.nombresFuent[f]; ok {
		return k
	}
	k := p.recurso("Font", "F", p.doc.fuente(f))
	p.nombresFuent[f] = k
	return k
}

// estado incrusta un ExtGState con la opacidad, como maybeEmbedGraphicsState
// (uno nuevo por cada dibujo que la pide).
func (p *Pagina) estado(relleno, borde *float64) string {
	if relleno == nil && borde == nil {
		return ""
	}
	var b strings.Builder
	b.WriteString("<<\n/Type /ExtGState\n")
	if relleno != nil {
		fmt.Fprintf(&b, "/ca %s\n", num(*relleno))
	}
	if borde != nil {
		fmt.Fprintf(&b, "/CA %s\n", num(*borde))
	}
	b.WriteString(">>")
	return p.recurso("ExtGState", "GS", p.doc.agregar([]byte(b.String())))
}

func rg(c Color) string { return num(c.R) + " " + num(c.G) + " " + num(c.B) }

// Texto son las opciones de DibujarTexto.
type Texto struct {
	X, Y       float64
	Tamano     float64
	Fuente     Fuente
	Color      Color // por omisión, negro
	Grados     float64
	Opacidad   *float64
	Interlinea float64 // por omisión 24, como pdf-lib
}

var reTab = strings.NewReplacer("\t", "    ", "\u0085", "    ", " ", "    ", " ", "    ", "\b", "", "\v", "")

// DibujarTexto es drawText: parte en renglones por los saltos de línea y
// escribe cada uno con Tj.
func (p *Pagina) DibujarTexto(texto string, o Texto) {
	renglones := partirRenglones(reTab.Replace(texto))
	codificados := make([][]byte, len(renglones))
	for i, r := range renglones {
		c, err := Codificar(r)
		if err != nil {
			p.doc.fallar(err)
			return
		}
		codificados[i] = c
	}
	tamano := o.Tamano
	if tamano == 0 {
		tamano = 24
	}
	inter := o.Interlinea
	if inter == 0 {
		inter = 24
	}
	gs := p.estado(o.Opacidad, nil)
	clave := p.claveFuente(o.Fuente)

	p.op("q")
	if gs != "" {
		p.op("/"+gs, "gs")
	}
	p.op("BT")
	p.op(rg(o.Color.o(Negro)), "rg")
	p.op("/"+clave, num(tamano), "Tf")
	p.op(num(inter), "TL")
	r := o.Grados * math.Pi / 180
	p.op(num(math.Cos(r)), num(math.Sin(r)+math.Tan(0)), num(-math.Sin(r)+math.Tan(0)), num(math.Cos(r)), num(o.X), num(o.Y), "Tm")
	for _, c := range codificados {
		p.cs.WriteByte('<')
		p.cs.WriteString(strings.ToUpper(fmt.Sprintf("%x", c)))
		p.cs.WriteString("> Tj\nT*\n")
	}
	p.op("ET")
	p.op("Q")
}

// partirRenglones es lineSplit de pdf-lib: split(/[\n\f\r\v]/), que
// conserva los renglones vacíos.
func partirRenglones(s string) []string {
	var out []string
	inicio := 0
	for i, r := range s {
		if r == '\n' || r == '\f' || r == '\r' || r == '\v' {
			out = append(out, s[inicio:i])
			inicio = i + 1
		}
	}
	return append(out, s[inicio:])
}

// Linea son las opciones de DibujarLinea.
type Linea struct {
	X1, Y1, X2, Y2 float64
	Grosor         float64 // por omisión 1
	Color          Color   // por omisión negro
	Opacidad       *float64
}

// DibujarLinea es drawLine.
func (p *Pagina) DibujarLinea(o Linea) {
	gs := p.estado(nil, o.Opacidad)
	grosor := o.Grosor
	if grosor == 0 {
		grosor = 1
	}
	p.op("q")
	if gs != "" {
		p.op("/"+gs, "gs")
	}
	p.op(rg(o.Color.o(Negro)), "RG")
	p.op(num(grosor), "w")
	p.op("[]", "0", "d")
	p.op(num(o.X1), num(o.Y1), "m")
	p.op(num(o.X1), num(o.Y1), "m")
	p.op(num(o.X2), num(o.Y2), "l")
	p.op("S")
	p.op("Q")
}

// Rectangulo son las opciones de DibujarRectangulo.
type Rectangulo struct {
	X, Y, Ancho, Alto float64
	Grosor            float64
	Relleno           Color // sin relleno ni borde, pdf-lib lo rellena de negro
	Borde             Color
	Opacidad          *float64
	OpacidadBorde     *float64
}

// DibujarRectangulo es drawRectangle.
func (p *Pagina) DibujarRectangulo(o Rectangulo) {
	gs := p.estado(o.Opacidad, o.OpacidadBorde)
	relleno := o.Relleno
	if !relleno.definido && !o.Borde.definido {
		relleno = Negro
	}
	p.op("q")
	if gs != "" {
		p.op("/"+gs, "gs")
	}
	if relleno.definido {
		p.op(rg(relleno), "rg")
	}
	if o.Borde.definido {
		p.op(rg(o.Borde), "RG")
	}
	p.op(num(o.Grosor), "w")
	p.op("[]", "0", "d")
	p.op("1 0 0 1", num(o.X), num(o.Y), "cm")
	p.op("1 0 0 1 0 0 cm")
	p.op("1 0 0 1 0 0 cm")
	p.op("0 0 m")
	p.op("0", num(o.Alto), "l")
	p.op(num(o.Ancho), num(o.Alto), "l")
	p.op(num(o.Ancho), "0", "l")
	p.op("h")
	switch {
	case relleno.definido && o.Grosor != 0:
		p.op("B")
	case relleno.definido:
		p.op("f")
	case o.Borde.definido:
		p.op("S")
	default:
		p.op("h")
	}
	p.op("Q")
}

// Elipse son las opciones de DibujarElipse (drawCircle es una elipse con
// las dos escalas iguales).
type Elipse struct {
	X, Y, EscalaX, EscalaY float64
	Grosor                 float64
	Relleno, Borde         Color
	Opacidad               *float64
	OpacidadBorde          *float64
}

var kappa = 4.0 * ((math.Sqrt(2) - 1.0) / 3.0)

// DibujarElipse es drawEllipse sin rotación (drawEllipsePath).
func (p *Pagina) DibujarElipse(o Elipse) {
	gs := p.estado(o.Opacidad, o.OpacidadBorde)
	relleno := o.Relleno
	if !relleno.definido && !o.Borde.definido {
		relleno = Negro
	}
	p.op("q")
	if gs != "" {
		p.op("/"+gs, "gs")
	}
	if relleno.definido {
		p.op(rg(relleno), "rg")
	}
	if o.Borde.definido {
		p.op(rg(o.Borde), "RG")
	}
	p.op(num(o.Grosor), "w")
	p.op("[]", "0", "d")
	x := o.X - o.EscalaX
	y := o.Y - o.EscalaY
	ox := o.EscalaX * kappa
	oy := o.EscalaY * kappa
	xe := x + float64(o.EscalaX*2)
	ye := y + float64(o.EscalaY*2)
	xm := x + o.EscalaX
	ym := y + o.EscalaY
	c := func(a ...float64) {
		partes := make([]string, 0, 7)
		for _, v := range a {
			partes = append(partes, num(v))
		}
		p.op(append(partes, "c")...)
	}
	p.op("q")
	p.op(num(x), num(ym), "m")
	c(x, ym-oy, xm-ox, y, xm, y)
	c(xm+ox, y, xe, ym-oy, xe, ym)
	c(xe, ym+oy, xm+ox, ye, xm, ye)
	c(xm-ox, ye, x, ym+oy, x, ym)
	p.op("Q")
	switch {
	case relleno.definido && o.Grosor != 0:
		p.op("B")
	case relleno.definido:
		p.op("f")
	case o.Borde.definido:
		p.op("S")
	default:
		p.op("h")
	}
	p.op("Q")
}

// DibujarImagen es drawImage.
func (p *Pagina) DibujarImagen(img *Imagen, x, y, ancho, alto float64) {
	clave := p.recurso("XObject", "Im", img.num)
	p.op("q")
	p.op("1 0 0 1", num(x), num(y), "cm")
	p.op("1 0 0 1 0 0 cm")
	p.op(num(ancho), "0 0", num(alto), "0 0 cm")
	p.op("1 0 0 1 0 0 cm")
	p.op("/"+clave, "Do")
	p.op("Q")
}
