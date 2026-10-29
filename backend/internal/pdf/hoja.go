package pdf

import (
	_ "embed"
	"math"
	"strings"
	"sync"
)

// Lo de lib/pdf/hoja.ts: la hoja A4, los márgenes, los colores y las
// funciones para escribir que usan todos los documentos.
//
// Las cuentas van como en el TS, operación por operación: una suma de una
// multiplicación se escribe float64(a*b)+c para que el compilador no la
// fusione en una FMA (en arm64 lo hace, y el último bit cambia).

// Mm pasa milímetros a puntos.
func Mm(valor float64) float64 { return valor * 72 / 25.4 }

// La hoja A4 y el margen, en puntos.
var (
	AnchoA4 = Mm(210)
	AltoA4  = Mm(297)
	Margen  = Mm(14)
)

// Los colores de los documentos.
var (
	Tinta      = RGB(0.1, 0.1, 0.1)
	TintaSuave = RGB(0.42, 0.4, 0.38)
	ColorLinea = RGB(0.9, 0.88, 0.86)
	Naranja    = RGB(0.945, 0.416, 0)
)

// Las tres fuentes de los documentos.
const (
	Normal  = Helvetica
	Negrita = HelveticaBold
	Mono    = Courier
)

// El logo de los documentos (lib/empresa.ts, LOGO_DOCUMENTOS). Es una copia
// de public/marca/logo-maderera.png: el binario de Go no tiene public/ al
// lado. Una prueba vigila que sean el mismo archivo.
//
//go:embed logo-maderera.png
var logoPNG []byte

const (
	logoAncho = 463
	logoAlto  = 89
)

// El logo se decodifica y se comprime una sola vez por proceso: cada PDF lo
// incrusta de nuevo, pero ya preparado.
var logoListo = sync.OnceValue(func() *imagenCruda {
	cr, err := prepararPNG(logoPNG)
	if err != nil {
		return nil // sin logo el documento sale con el nombre en texto
	}
	return cr
})

// Hoja es una hoja en armado: el documento, la página actual y el cursor.
type Hoja struct {
	Doc    *Documento
	Pagina *Pagina
	// Logo es el logo ya incrustado; nil si no se pudo leer.
	Logo *Imagen
	// Y es la posición vertical del cursor, desde abajo (como en PDF).
	Y float64
}

// NuevaHoja es nuevaHoja(): un documento con una página A4 y el logo.
func NuevaHoja() *Hoja {
	doc := Nuevo()
	h := &Hoja{Doc: doc, Pagina: doc.AgregarPagina(AnchoA4, AltoA4), Y: AltoA4 - Margen}
	if cr := logoListo(); cr != nil {
		h.Logo = doc.incrustar(cr)
	}
	return h
}

// NuevaPagina suma una página A4 y la deja como actual.
func (h *Hoja) NuevaPagina() *Pagina {
	h.Pagina = h.Doc.AgregarPagina(AnchoA4, AltoA4)
	return h.Pagina
}

var comillas = strings.NewReplacer(
	"‘", "'", "’", "'", "‛", "'",
	"“", `"`, "”", `"`, "‟", `"`,
	"–", "-", "—", "-", "―", "-",
	"…", "...",
	" ", " ",
)

// Limpiar saca lo que Helvetica no sabe dibujar, como limpiar() del TS:
// las comillas tipográficas y las rayas pasan a sus versiones simples, y se
// borra todo lo que no esté entre el espacio y la «ÿ» de WinAnsi.
func Limpiar(texto string) string {
	t := comillas.Replace(texto)
	var b strings.Builder
	b.Grow(len(t))
	for _, r := range t {
		if (r >= 0x20 && r <= 0x7e) || (r >= 0xa1 && r <= 0xff) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Opciones son las de escribir(): por omisión, tamaño 9, Helvetica y Tinta.
type Opciones struct {
	X, Y   float64
	Tamano float64
	Fuente Fuente
	Color  Color
	// Derecha alinea a la derecha respecto de X.
	Derecha bool
}

func (o Opciones) tamano() float64 {
	if o.Tamano == 0 {
		return 9
	}
	return o.Tamano
}

// Escribir es escribir(): un renglón, limpio, alineado a la izquierda o a la
// derecha de X.
func (h *Hoja) Escribir(texto string, o Opciones) {
	limpio := Limpiar(texto)
	if limpio == "" {
		return
	}
	tamano := o.tamano()
	ancho := o.Fuente.Ancho(limpio, tamano)
	x := o.X
	if o.Derecha {
		x = o.X - ancho
	}
	h.Pagina.DibujarTexto(limpio, Texto{X: x, Y: o.Y, Tamano: tamano, Fuente: o.Fuente, Color: o.Color.o(Tinta)})
}

// Parrafo son las opciones de EscribirParrafo.
type Parrafo struct {
	Opciones
	Ancho float64
	// Interlineado; por omisión, 1,35 veces el tamaño.
	Interlineado float64
}

// Renglones corta un texto en renglones que entren en el ancho, como
// escribirParrafo: palabra por palabra, y una palabra sola más ancha que
// el renglón va sola en el suyo.
func Renglones(texto string, fuente Fuente, tamano, ancho float64) []string {
	var lineas []string
	actual := ""
	for _, palabra := range strings.Fields(Limpiar(texto)) {
		tentativa := palabra
		if actual != "" {
			tentativa = actual + " " + palabra
		}
		if fuente.Ancho(tentativa, tamano) > ancho && actual != "" {
			lineas = append(lineas, actual)
			actual = palabra
		} else {
			actual = tentativa
		}
	}
	if actual != "" {
		lineas = append(lineas, actual)
	}
	return lineas
}

// EscribirParrafo es escribirParrafo(): corta el texto en renglones y
// devuelve la altura que ocupó.
func (h *Hoja) EscribirParrafo(texto string, o Parrafo) float64 {
	tamano := o.tamano()
	alto := o.Interlineado
	if alto == 0 {
		alto = tamano * 1.35
	}
	lineas := Renglones(texto, o.Fuente, tamano, o.Ancho)
	for i, l := range lineas {
		op := o.Opciones
		op.Y = o.Y - float64(float64(i)*alto)
		h.Escribir(l, op)
	}
	return float64(len(lineas)) * alto
}

// EscribirCentrado es escribirCentrado(): centrado en el eje centroX.
func (h *Hoja) EscribirCentrado(texto string, centroX float64, o Opciones) {
	limpio := Limpiar(texto)
	if limpio == "" {
		return
	}
	tamano := o.tamano()
	ancho := o.Fuente.Ancho(limpio, tamano)
	h.Pagina.DibujarTexto(limpio, Texto{X: centroX - ancho/2, Y: o.Y, Tamano: tamano, Fuente: o.Fuente, Color: o.Color.o(Tinta)})
}

// Raya es linea(): de margen a margen. Grosor 0,5 y ColorLinea por omisión.
func (h *Hoja) Raya(y float64, grosor float64, c Color) {
	if grosor == 0 {
		grosor = 0.5
	}
	h.Pagina.DibujarLinea(Linea{X1: Margen, Y1: y, X2: AnchoA4 - Margen, Y2: y, Grosor: grosor, Color: c.o(ColorLinea)})
}

// Recuadro es recuadro(): solo el borde. Grosor 1 y Tinta por omisión.
func (h *Hoja) Recuadro(x, y, ancho, alto, grosor float64, c Color) {
	if grosor == 0 {
		grosor = 1
	}
	h.Pagina.DibujarRectangulo(Rectangulo{X: x, Y: y, Ancho: ancho, Alto: alto, Grosor: grosor, Borde: c.o(Tinta)})
}

// MarcaDeAgua es marcaDeAgua(): el texto en diagonal, gris claro.
func (h *Hoja) MarcaDeAgua(texto string) {
	const tamano = 54
	limpio := Limpiar(Mayusculas(texto))
	ancho := Negrita.Ancho(limpio, tamano)
	op := 0.55
	h.Pagina.DibujarTexto(limpio, Texto{
		X:        (AnchoA4 - float64(ancho*0.85)) / 2,
		Y:        AltoA4 / 2,
		Tamano:   tamano,
		Fuente:   Negrita,
		Color:    RGB(0.85, 0.85, 0.85),
		Grados:   32,
		Opacidad: &op,
	})
}

// Emisor son los datos legales del encabezado. Un campo vacío es como un
// null en el TS.
type Emisor struct {
	RazonSocial    string `json:"razonSocial"`
	NombreFantasia string `json:"nombreFantasia"`
	Domicilio      string `json:"domicilio"`
	Cuit           string `json:"cuit"`
}

// EncabezadoEmisor es encabezadoEmisor(): el logo y los datos legales arriba
// a la izquierda. Devuelve dónde sigue el cursor.
func (h *Hoja) EncabezadoEmisor(e *Emisor, y float64) float64 {
	if e == nil {
		e = &Emisor{}
	}
	cursor := y
	if h.Logo != nil {
		alto := Mm(10)
		ancho := alto * logoAncho / logoAlto
		h.Pagina.DibujarImagen(h.Logo, Margen, cursor-alto+9, ancho, alto)
		cursor -= alto + 7
	}
	razon := e.RazonSocial
	if razon == "" {
		razon = "Maderera Juan B. Justo"
	}
	tam, baja := 13.0, 13.0
	if h.Logo != nil {
		tam, baja = 9, 11
	}
	h.Escribir(razon, Opciones{X: Margen, Y: cursor, Tamano: tam, Fuente: Negrita})
	cursor -= baja

	if e.NombreFantasia != "" {
		h.Escribir(e.NombreFantasia, Opciones{X: Margen, Y: cursor, Tamano: 8, Color: TintaSuave})
		cursor -= 11
	}
	cuit := ""
	if e.Cuit != "" {
		cuit = "CUIT " + e.Cuit
	}
	for _, dato := range []string{e.Domicilio, cuit} {
		if dato == "" {
			continue
		}
		h.Escribir(dato, Opciones{X: Margen, Y: cursor, Tamano: 7.5, Color: TintaSuave})
		cursor -= 10
	}
	return cursor
}

// Bytes es serializar(): el PDF terminado.
func (h *Hoja) Bytes() ([]byte, error) { return h.Doc.Bytes() }

// minimo y maximo como Math.min y Math.max de dos números comunes.
func minimo(a, b float64) float64 { return math.Min(a, b) }
func maximo(a, b float64) float64 { return math.Max(a, b) }

// Mayusculas es toUpperCase de JS para lo que puede llegar a un documento:
// como strings.ToUpper, salvo la «ß», que JS pasa a «SS».
func Mayusculas(s string) string {
	return strings.ToUpper(strings.ReplaceAll(s, "ß", "SS"))
}
