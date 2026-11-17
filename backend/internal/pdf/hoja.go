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
// las comillas tipográficas y las rayas pasan a sus versiones simples (así
// quedan iguales a las de los golden), y se borra lo que WinAnsi no tiene y
// los caracteres de control. El TS borraba todo lo que no estuviera entre
// el espacio y la «ÿ», y se llevaba puestos «€», «•» y «™», que WinAnsi sí
// tiene (en 0x80, 0x95 y 0x99).
func Limpiar(texto string) string {
	t := comillas.Replace(texto)
	var b strings.Builder
	b.Grow(len(t))
	for _, r := range t {
		if _, ok := winAnsi[r]; ok && r >= 0x20 && r != 0xa0 {
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

// TamanoQueEntra es el tamaño, a lo sumo tamano y no menos de minimo, con
// el que el texto entra en el ancho. Se redondea para abajo a la centésima:
// justo en el borde, el ancho medido con ese tamaño podía pasarse por el
// último decimal.
func TamanoQueEntra(texto string, fuente Fuente, tamano, ancho, minimo float64) float64 {
	a := fuente.Ancho(Limpiar(texto), tamano)
	if a <= ancho || a == 0 {
		return tamano
	}
	return maximo(minimo, math.Floor(tamano*ancho/a*100)/100)
}

// EscribirNumero escribe un importe o una cantidad en una columna de ancho
// fijo: si no entra se achica, hasta la mitad del tamaño, pero nunca se
// corta (un número cortado dice otro número). Con Derecha, el ancho se
// cuenta hacia la izquierda de X.
func (h *Hoja) EscribirNumero(texto string, o Opciones, ancho float64) {
	o.Tamano = TamanoQueEntra(texto, o.Fuente, o.tamano(), ancho, o.tamano()/2)
	h.Escribir(texto, o)
}

// EscribirEnAncho escribe un renglón de texto que no puede pasar de ancho
// (el de su columna): primero se achica un poco, hasta el 85 % del tamaño,
// y si así tampoco entra se corta con puntos suspensivos.
func (h *Hoja) EscribirEnAncho(texto string, o Opciones, ancho float64) {
	o.Tamano = TamanoQueEntra(texto, o.Fuente, o.tamano(), ancho, float64(o.tamano()*0.85))
	h.Escribir(Elipsis(texto, o.Fuente, o.Tamano, ancho), o)
}

// Elipsis corta el texto con «...» para que entre en el ancho. Si ya entra,
// lo devuelve limpio y entero.
func Elipsis(texto string, fuente Fuente, tamano, ancho float64) string {
	limpio := Limpiar(texto)
	if fuente.Ancho(limpio, tamano) <= ancho {
		return limpio
	}
	r := []rune(limpio)
	for len(r) > 0 {
		r = r[:len(r)-1]
		corto := strings.TrimRight(string(r), " ") + "..."
		if fuente.Ancho(corto, tamano) <= ancho {
			return corto
		}
	}
	return ""
}

// Dato es un par etiqueta y valor de CuadroDeDatos.
type Dato struct{ Etiqueta, Valor string }

// CuadroDeDatos es el recuadro con los datos del destinatario, del cliente
// o de quien retira: un título chico y los datos en columnas, la etiqueta
// arriba y el valor en negrita abajo. El valor va en párrafo dentro de su
// columna, así una razón social o un domicilio largos bajan de renglón en
// vez de pisar el dato de al lado, y el recuadro crece lo que haga falta.
// Devuelve el alto del recuadro.
func (h *Hoja) CuadroDeDatos(titulo string, datos []Dato, y float64, columnas int) float64 {
	const (
		tamanoValor  = 8.5
		interlineado = 10.0
	)
	anchoColumna := (AnchoA4 - Margen*2) / float64(columnas)
	anchoValor := anchoColumna - 12

	// Cuántos renglones lleva cada fila: los del valor más largo.
	var altos []float64
	total := 0.0
	for i := 0; i < len(datos); i += columnas {
		renglones := 1
		for _, d := range datos[i:min(i+columnas, len(datos))] {
			renglones = max(renglones, len(Renglones(d.Valor, Negrita, tamanoValor, anchoValor)))
		}
		alto := 20 + float64(float64(renglones-1)*interlineado)
		altos = append(altos, alto)
		total += alto
	}
	altoCuadro := 22 + total

	h.Recuadro(Margen, y-altoCuadro, AnchoA4-Margen*2, altoCuadro, 0.5, ColorLinea)
	h.Escribir(titulo, Opciones{X: Margen + 8, Y: y - 12, Tamano: 6, Fuente: Negrita, Color: TintaSuave})

	yFila := y - 26
	for i, d := range datos {
		x := Margen + 8 + float64(float64(i%columnas)*anchoColumna)
		h.Escribir(d.Etiqueta, Opciones{X: x, Y: yFila, Tamano: 6, Color: TintaSuave})
		h.EscribirParrafo(d.Valor, Parrafo{Opciones: Opciones{X: x, Y: yFila - 9, Tamano: tamanoValor, Fuente: Negrita},
			Ancho: anchoValor, Interlineado: interlineado})
		if i%columnas == columnas-1 {
			yFila -= altos[i/columnas]
		}
	}
	return altoCuadro
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
