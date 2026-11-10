// Package asistente es el motor sin IA que entiende lo que escribe la gente
// en el sitio y en el WhatsApp.
//
// Es el port de `lib/asistente/lenguaje.ts` (10/11/2026): el bot de WhatsApp
// corre en Go, donde llegan los mensajes, y tiene que entender exactamente lo
// mismo que el asistente del sitio. Los casos de prueba son los mismos que los
// de vitest; si se toca uno de los dos lados, se toca el otro.
//
// **Dónde está el límite, dicho de frente.** Esto no entiende: reconoce. Con
// una pregunta que no se parezca a nada de lo previsto, la salida es
// `SinIdea`, y ahí lo honesto es buscar en el catálogo y, si no aparece nada,
// pasar a una persona. Nunca inventa una respuesta.
//
// Todo acá es puro y sin base de datos.
package asistente

import (
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Intencion es qué quiso decir quien escribió.
type Intencion string

const (
	Saludo        Intencion = "saludo"
	Buscar        Intencion = "buscar"
	Precio        Intencion = "precio"
	Stock         Intencion = "stock"
	Envios        Intencion = "envios"
	Horarios      Intencion = "horarios"
	Pagos         Intencion = "pagos"
	Cortes        Intencion = "cortes"
	Cuenta        Intencion = "cuenta"
	Calcular      Intencion = "calcular"
	ArmarCorte    Intencion = "armar_corte"
	Moldava       Intencion = "moldava"
	Documentacion Intencion = "documentacion"
	Devoluciones  Intencion = "devoluciones"
	Acopio        Intencion = "acopio"
	Factura       Intencion = "factura"
	Eventos       Intencion = "eventos"
	Persona       Intencion = "persona"
	Gracias       Intencion = "gracias"
	SinIdea       Intencion = "sin_idea"
)

// Medida es lo que dijeron de tamaño. Cero es «no lo dijeron».
type Medida struct {
	EspesorMm int
	LargoMm   int
	AnchoMm   int
}

// Cantidad son metros cuadrados o lineales, si los dijeron.
type Cantidad struct {
	Valor  float64
	Unidad string // "m2" o "m"
}

// Pieza es una pieza de un despiece escrito con palabras.
type Pieza struct {
	LargoMm    int
	AnchoMm    int
	Cantidad   int
	CantoLargo int
	CantoAncho int
}

// Despiece es «4 de 600x400 en melamina blanca con canto».
type Despiece struct {
	Piezas []Pieza
	// Material es lo que dijeron del material, para elegir la placa.
	Material string
}

// Entendido es lo que se sacó del texto.
type Entendido struct {
	Intencion Intencion
	// Puntaje es qué tan seguro está. Cero es no haber reconocido nada.
	Puntaje  int
	Consulta string
	Medida   Medida
	Cantidad *Cantidad
	Rubro    string
	Despiece *Despiece
}

var (
	reFueraDeClase = regexp.MustCompile(`[^A-Za-z0-9_\s.,x/-]`)
	reEspacios     = regexp.MustCompile(`\s+`)
)

// Normalizar pasa a minúsculas y sin acentos, como `f_unaccent` en la base:
// nadie escribe los acentos cuando escribe rápido.
func Normalizar(texto string) string {
	t := strings.ToLower(texto)
	t = norm.NFD.String(t)
	t = strings.Map(func(r rune) rune {
		if r >= 0x300 && r <= 0x36f {
			return -1
		}
		return r
	}, t)
	t = reFueraDeClase.ReplaceAllString(t, " ")
	t = reEspacios.ReplaceAllString(t, " ")
	return strings.TrimSpace(t)
}

type senal struct {
	intencion Intencion
	palabras  []string
	peso      int
}

// Las palabras de cada intención, en el orden en que se prueban. Escritas
// como las dice la gente: «hacen envio», «me lo cortan», «fiado».
var senales = []senal{
	{Saludo, []string{"hola", "buenas", "buen dia", "buenas tardes", "que tal", "hey"}, 1},
	{Gracias, []string{"gracias", "genial", "perfecto", "barbaro", "buenisimo", "dale gracias"}, 1},
	{Envios, []string{"envio", "envios", "envian", "mandan", "entrega", "entregan", "domicilio", "flete", "reparto", "llevan", "traen"}, 1},
	{Horarios, []string{"horario", "horarios", "abren", "cierran", "abierto", "atienden", "direccion", "donde estan", "donde queda", "sucursal", "sucursales", "local", "locales", "telefono"}, 1},
	{Pagos, []string{"pago", "pagar", "pagos", "tarjeta", "credito", "debito", "cuotas", "transferencia", "efectivo", "mercado pago", "financiacion"}, 1},
	{Cortes, []string{"corte", "cortes", "cortar", "cortan", "a medida", "despiece", "aserradero", "me lo cortan"}, 1},
	{Cuenta, []string{"cuenta corriente", "cuenta", "fiado", "credito comercial", "profesional", "mayorista", "descuento por cantidad", "revendedor", "carpintero", "constructor"}, 1},
	{Calcular, []string{"cuanto necesito", "cuanto me sale", "calcular", "calculo", "cuantas placas", "cuanto material", "cuantos metros", "me alcanza", "rinde"}, 1},
	{Moldava, []string{"moldava", "linea propia", "finger joint", "fingerjoint"}, 2},
	{Documentacion, []string{"ficha tecnica", "fichas tecnicas", "tabla de carga", "documentacion", "instructivo", "pliego"}, 1},
	{Devoluciones, []string{"devolucion", "devolver", "cambio", "cambiar", "garantia", "vino fallado", "vino mal"}, 1},
	{Acopio, []string{"acopio", "acopiar", "dejar guardado", "retirar despues", "retiro en partes", "de a poco"}, 1},
	{Factura, []string{"factura a", "factura b", "factura", "facturan", "cuit", "responsable inscripto", "monotributo"}, 1},
	{Eventos, []string{"capacitacion", "capacitaciones", "curso", "cursos", "charla", "charlas", "evento", "eventos", "taller"}, 1},
	{Persona, []string{"hablar con alguien", "una persona", "vendedor", "atienden", "llamar", "whatsapp", "asesor", "humano"}, 1},
	{Stock, []string{"tenes", "tienen", "hay stock", "stock", "disponible", "queda", "quedan"}, 1},
	{Precio, []string{"precio", "cuanto sale", "cuanto vale", "cuanto cuesta", "vale", "sale"}, 1},
	{Buscar, []string{"busco", "necesito", "quiero", "estoy buscando", "me sirve", "para hacer"}, 1},
}

// Rubros por como los nombra la gente: nadie escribe «construcción en seco»,
// escribe «durlock». El slug es el del catálogo.
var rubros = []struct {
	slug     string
	palabras []string
}{
	{"placas", []string{"placa", "placas", "melamina", "melaminico", "mdf", "fenolico", "aglomerado", "terciado", "terciados", "chapadur", "enchapado", "enchapados", "ranurado", "ranurados", "osb", "fibrofacil", "tablero", "tableros"}},
	{"techos", []string{"techo", "techos", "tirante", "tirantes", "machimbre", "cabreada"}},
	{"pisos", []string{"piso", "pisos", "flotante", "zocalo", "zocalos", "parquet"}},
	{"molduras", []string{"moldura", "molduras", "marco", "cornisa", "varilla"}},
	{"ferreteria", []string{"tornillo", "tornillos", "bisagra", "bisagras", "clavo", "clavos", "cola", "laca", "herraje", "corredera"}},
	{"decks-y-escaleras", []string{"deck", "decks", "escalera", "escaleras", "grandis"}},
	{"construccion-en-seco", []string{"durlock", "yeso", "montante", "solera", "lana de vidrio", "construccion en seco"}},
	{"cubiertas", []string{"chapa", "chapas", "cubierta", "cubiertas", "curvin", "teja", "tejas"}},
}

// Palabras que no aportan nada a la búsqueda del catálogo.
var vacias = map[string]bool{}

func init() {
	for _, p := range strings.Fields(`hola buenas gracias por favor quiero queria necesito
		busco buscando estoy tenes tienen hay el la los las un una unos unas de del para con y o
		que cual cuanto cuanta sale vale cuesta precio me mi es en a al se su algo alguna algun
		sirve puede podrian ustedes tengo hacer haria mm tardes dia dias noches che ah eh ok si no`) {
		vacias[p] = true
	}
}

var (
	reMedidaPorPor = regexp.MustCompile(`(\d{2,4})\s*[x×]\s*(\d{2,4})`)
	reEspesorMm    = regexp.MustCompile(`(\d{1,3})\s*mm\b`)
	reEspesorDe    = regexp.MustCompile(`\bde\s+(\d{1,2})\b`)
	// «¿y en 18?»: con «en», solo si el número cierra la frase; «lo
	// necesito en 15 días» no es un espesor.
	reEspesorEn = regexp.MustCompile(`\ben\s+(\d{1,2})\s*(?:mm)?\s*[?!.]*$`)
	reM2        = regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros? cuadrados?)`)
	reMetros    = regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*(?:m|metros?|ml)\b`)
)

func leerMedida(texto string) Medida {
	var m Medida
	if g := reMedidaPorPor.FindStringSubmatch(texto); g != nil {
		m.LargoMm, _ = strconv.Atoi(g[1])
		m.AnchoMm, _ = strconv.Atoi(g[2])
	}
	// Se acota a lo que es un espesor creíble para no confundir el «2600» de
	// una medida con un grosor de placa.
	if g := reEspesorMm.FindStringSubmatch(texto); g != nil {
		m.EspesorMm, _ = strconv.Atoi(g[1])
		return m
	}
	g := reEspesorDe.FindStringSubmatch(texto)
	if g == nil {
		g = reEspesorEn.FindStringSubmatch(texto)
	}
	if g != nil {
		if v, _ := strconv.Atoi(g[1]); v >= 3 && v <= 50 {
			m.EspesorMm = v
		}
	}
	return m
}

func numero(s string) float64 {
	v, _ := strconv.ParseFloat(strings.Replace(s, ",", ".", 1), 64)
	return v
}

func leerCantidad(texto string) *Cantidad {
	if g := reM2.FindStringSubmatch(texto); g != nil {
		return &Cantidad{Valor: numero(g[1]), Unidad: "m2"}
	}
	if g := reMetros.FindStringSubmatch(texto); g != nil {
		return &Cantidad{Valor: numero(g[1]), Unidad: "m"}
	}
	return nil
}

// leerRubro: gana el que aparece primero en la frase. En «busco chapa para el
// techo» se viene a comprar una chapa; el techo es para qué. Si empatan, la
// palabra más larga, que es la más específica.
func leerRubro(texto string) string {
	mejor, dondeMejor, largoMejor := "", -1, 0
	for _, r := range rubros {
		for _, p := range r.palabras {
			donde := strings.Index(texto, p)
			if donde == -1 {
				continue
			}
			if dondeMejor == -1 || donde < dondeMejor || (donde == dondeMejor && len(p) > largoMejor) {
				mejor, dondeMejor, largoMejor = r.slug, donde, len(p)
			}
		}
	}
	return mejor
}

var (
	rePuntuacion = regexp.MustCompile(`[.,;:!?]`)
	reSoloNumero = regexp.MustCompile(`^\d+(mm|cm|m)?$`)
	reSoloPorPor = regexp.MustCompile(`^\d+[x×]\d+$`)
	reEspacioJS  = regexp.MustCompile(`\s+`)
)

// ConsultaLimpia es lo que queda del texto sin muletillas ni números: el
// catálogo busca por nombre, no por la medida de la variante, y la medida se
// aplica después como filtro.
func ConsultaLimpia(texto string) string {
	t := rePuntuacion.ReplaceAllString(Normalizar(texto), " ")
	var quedan []string
	for _, p := range reEspacioJS.Split(t, -1) {
		if len(p) > 1 && !vacias[p] && !reSoloNumero.MatchString(p) && !reSoloPorPor.MatchString(p) {
			quedan = append(quedan, p)
		}
	}
	if len(quedan) > 6 {
		quedan = quedan[:6]
	}
	return strings.TrimSpace(strings.Join(quedan, " "))
}

// Preguntar por un servicio le gana a preguntar un precio, mientras no hayan
// nombrado un rubro: «cuánto sale el flete» son las zonas de envío.
var servicios = []Intencion{Envios, Horarios, Pagos, Cortes, Cuenta, Persona, Calcular, Documentacion, Devoluciones, Acopio, Factura, Eventos}

// Entender lee la intención y los datos de un texto.
func Entender(original string) Entendido {
	texto := Normalizar(original)

	// Un despiece le gana a todo: si escribieron piezas, quieren el corte.
	if d := LeerDespiece(texto); d != nil {
		return Entendido{Intencion: ArmarCorte, Puntaje: 5, Consulta: ConsultaLimpia(original), Rubro: "placas", Despiece: d}
	}

	medida := leerMedida(texto)
	cantidad := leerCantidad(texto)
	rubro := leerRubro(texto)
	consulta := ConsultaLimpia(original)

	mejor, mejorPuntaje := SinIdea, 0
	reconocidas := map[Intencion]int{}
	for _, s := range senales {
		for _, p := range s.palabras {
			if !strings.Contains(texto, p) {
				continue
			}
			// Las frases valen más que las palabras sueltas.
			puntaje := 2
			if strings.Contains(p, " ") {
				puntaje = 3
			}
			puntaje *= s.peso
			if puntaje > reconocidas[s.intencion] {
				reconocidas[s.intencion] = puntaje
			}
			if puntaje > mejorPuntaje {
				mejor, mejorPuntaje = s.intencion, puntaje
			}
		}
	}

	if rubro == "" && (mejor == Precio || mejor == Stock) {
		type cand struct {
			i Intencion
			p int
		}
		var cs []cand
		for _, i := range servicios {
			if p := reconocidas[i]; p > 0 {
				cs = append(cs, cand{i, p})
			}
		}
		sort.SliceStable(cs, func(a, b int) bool { return cs[a].p > cs[b].p })
		if len(cs) > 0 {
			mejor, mejorPuntaje = cs[0].i, cs[0].p
		}
	}

	// Nombrar un producto gana sobre casi todo: la respuesta útil es el
	// producto, no la lista de formas de pago.
	nombraProducto := rubro != "" || len(consulta) >= 3
	deProducto := mejor == Precio || mejor == Stock || mejor == Buscar || mejor == SinIdea
	if nombraProducto && deProducto {
		p := mejorPuntaje
		if rubro != "" && p < 3 {
			p = 3
		} else if p < 1 {
			p = 1
		}
		return Entendido{Intencion: Buscar, Puntaje: p, Consulta: consulta, Medida: medida, Cantidad: cantidad, Rubro: rubro}
	}

	// Moldava es una marca y también un rubro: preguntar por ella es conocer
	// la línea, no buscar un producto suelto.
	if p, ok := reconocidas[Moldava]; ok && medida.EspesorMm == 0 {
		return Entendido{Intencion: Moldava, Puntaje: p, Consulta: consulta, Medida: medida, Cantidad: cantidad, Rubro: rubro}
	}

	// Un saludo con algo más atrás no es un saludo: es la pregunta que sigue.
	if mejor == Saludo && len(consulta) >= 3 {
		return Entendido{Intencion: Buscar, Puntaje: 1, Consulta: consulta, Medida: medida, Cantidad: cantidad, Rubro: rubro}
	}

	return Entendido{Intencion: mejor, Puntaje: mejorPuntaje, Consulta: consulta, Medida: medida, Cantidad: cantidad, Rubro: rubro}
}

var (
	// El patrón del TS sin el «(?!\s*x)» final, que RE2 no tiene: la cola
	// «x 4» de «600x400 x 4» se lee a mano en LeerDespiece.
	reDespiece   = regexp.MustCompile(`(?:\b(\d{1,3})\s+(?:(?:piezas?|unidades|u)\s+)?(?:de\s+)?)?\b(\d{2,4})\s*x\s*(\d{2,4})\b`)
	reColaCant   = regexp.MustCompile(`^\s*(?:mm)?\s*x\s*(\d{1,3})\b`)
	reSigueX     = regexp.MustCompile(`^\s*x`)
	rePideCorte  = regexp.MustCompile(`\b(corte|cortes|cortar|cortame|cortan|despiece|piezas?)\b`)
	reTodoCanto  = regexp.MustCompile(`canto (en )?(todo|todos|los 4|los cuatro|4 lados|cuatro lados)`)
	reConCanto   = regexp.MustCompile(`\b(con canto|con tapacanto|tapacanto|canteado)\b`)
	reSinCanto   = regexp.MustCompile(`\bsin (tapa)?canto\b`)
	reNoMaterial = regexp.MustCompile(`^(piezas?|corte|cortes|cortar|cortame|cortan|despiece|canto|tapacanto|todo|todos|lados|cuatro|unidades|sin|placa|placas|en)$`)
)

// LeerDespiece lee las piezas de un corte escritas con palabras: «4 de
// 600x400», «4 piezas de 600 x 400», «600x400 x 4», varias en la misma frase.
// Para no confundirlo con la medida de una placa entera hace falta una
// cantidad, la palabra corte/despiece/piezas, o más de una medida.
func LeerDespiece(texto string) *Despiece {
	t := Normalizar(texto)
	type encontrada struct{ largo, ancho, cantidad int }
	var enc []encontrada
	for desde := 0; desde <= len(t); {
		m := reDespiece.FindStringSubmatchIndex(t[desde:])
		if m == nil {
			break
		}
		fin := desde + m[1]
		grupo := func(i int) string {
			if m[2*i] < 0 {
				return ""
			}
			return t[desde+m[2*i] : desde+m[2*i+1]]
		}
		largo, _ := strconv.Atoi(grupo(2))
		ancho, _ := strconv.Atoi(grupo(3))
		cantidad, _ := strconv.Atoi(grupo(1))
		if cola := reColaCant.FindStringSubmatchIndex(t[fin:]); cola != nil && !reSigueX.MatchString(t[fin+cola[1]:]) {
			if cantidad == 0 {
				cantidad, _ = strconv.Atoi(t[fin+cola[2] : fin+cola[3]])
			}
			fin += cola[1]
		}
		if fin == desde {
			fin++
		}
		desde = fin
		if largo < 20 || ancho < 20 || largo > 3000 || ancho > 3000 {
			continue
		}
		enc = append(enc, encontrada{largo, ancho, cantidad})
	}
	if len(enc) == 0 {
		return nil
	}
	conCantidad := false
	for _, e := range enc {
		if e.cantidad > 0 {
			conCantidad = true
		}
	}
	if !rePideCorte.MatchString(t) && !conCantidad && len(enc) < 2 {
		return nil
	}

	todo := reTodoCanto.MatchString(t)
	conCanto := todo || reConCanto.MatchString(t)
	sin := reSinCanto.MatchString(t)

	d := &Despiece{}
	for _, e := range enc {
		p := Pieza{LargoMm: max(e.largo, e.ancho), AnchoMm: min(e.largo, e.ancho), Cantidad: e.cantidad}
		if p.Cantidad == 0 {
			p.Cantidad = 1
		}
		if conCanto && !sin {
			p.CantoLargo = 2
		}
		if todo && !sin {
			p.CantoAncho = 2
		}
		d.Piezas = append(d.Piezas, p)
	}
	var mat []string
	for _, p := range strings.Split(ConsultaLimpia(t), " ") {
		if p != "" && !reNoMaterial.MatchString(p) {
			mat = append(mat, p)
		}
	}
	d.Material = strings.TrimSpace(strings.Join(mat, " "))
	return d
}

var (
	reConectores = regexp.MustCompile(`\b(y|en|de|con)\b`)
	reSigue      = regexp.MustCompile(`^(y|y en|y de|y con|en|de|con|otra|otro|la de|el de)\b`)
)

// ConContexto completa la pregunta que sigue a otra: «¿y en 18?» después de
// hablar de MDF. Si el texto nuevo nombra algo, va solo.
func ConContexto(texto, anterior string) string {
	if anterior == "" {
		return texto
	}
	t := Normalizar(texto)
	nombraAlgo := len(strings.TrimSpace(reConectores.ReplaceAllString(ConsultaLimpia(texto), ""))) >= 3
	traeMedida := strings.IndexFunc(t, unicode.IsDigit) >= 0
	if !nombraAlgo && (traeMedida || reSigue.MatchString(t)) {
		return strings.TrimSpace(anterior + " " + texto)
	}
	return texto
}

// EnlaceDelDespiece es la ruta al cortador con el despiece cargado.
func EnlaceDelDespiece(d Despiece) string {
	var partes []string
	for _, p := range d.Piezas {
		s := strconv.Itoa(p.LargoMm) + "x" + strconv.Itoa(p.AnchoMm) + "x" + strconv.Itoa(p.Cantidad)
		if p.CantoLargo != 0 || p.CantoAncho != 0 {
			s += "c" + strconv.Itoa(p.CantoLargo) + strconv.Itoa(p.CantoAncho)
		}
		partes = append(partes, s)
	}
	// URLSearchParams escribe los espacios como «+», igual que QueryEscape.
	q := "piezas=" + url.QueryEscape(strings.Join(partes, "_"))
	if d.Material != "" {
		q += "&material=" + url.QueryEscape(d.Material)
	}
	return "/corte#" + q
}
