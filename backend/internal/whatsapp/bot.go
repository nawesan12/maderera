package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"mjbj/internal/asistente"
	"mjbj/internal/formato"
	"mjbj/internal/numeracion"
	"mjbj/internal/push"
)

// El bot de WhatsApp (10/11/2026, Nahuel: «quieren contestar menos
// whatsapps»). Usa el mismo motor sin IA que el asistente del sitio
// (internal/asistente) y hace una de dos cosas: contesta con datos —horarios,
// envíos, pagos, qué hay en el catálogo, el corte armado— o pasa a una
// persona, mandándole al cliente un wa.me al número humano con lo que pidió ya
// escrito. Una vez derivada, la conversación es de la persona y el bot se
// calla hasta que alguien lo reactive desde la bandeja.
//
// **No da precios.** Ningún precio sale sin que alguien lo mire: la pregunta
// de precio se deriva con el producto en el resumen.
//
// Responder es puro (se prueba sin base); atenderTurno (turno.go) es lo que
// lee y escribe, y contesta una vez por ráfaga de mensajes.

// ProductoBot es lo que el bot necesita de un producto del catálogo.
type ProductoBot struct {
	Nombre  string
	Slug    string
	Medidas []string
	Central bool
	Aserr   bool
}

// Buscador busca en el catálogo. Lo pone cmd/mjbj: el paquete no conoce el
// catálogo para no atarse a él.
type Buscador func(ctx context.Context, consulta, rubro string) ([]ProductoBot, error)

// VarianteBot es una medida de un producto, con el precio de la lista
// general: va al presupuesto que revisa una persona, nunca al cliente.
type VarianteBot struct {
	ID        string
	Label     string
	EspesorMm int
	LargoMm   int
	AnchoMm   int
	Precio    string // vacío: sin precio cargado
}

// FichaBot es lo que el bot necesita para presupuestar un producto.
type FichaBot struct {
	Nombre    string
	Unidad    string
	Variantes []VarianteBot
}

// Ficheador trae las medidas de un producto por su slug.
type Ficheador func(ctx context.Context, slug string) (*FichaBot, error)

// ConBuscador conecta el catálogo: la búsqueda y la ficha de cada producto.
func (s *Servicio) ConBuscador(b Buscador, f Ficheador) *Servicio {
	s.buscar, s.ficha = b, f
	return s
}

// Corteador guarda un despiece como consulta de corte (la misma que manda el
// cortador del sitio) y devuelve el token, la placa elegida por el material y,
// si no se pudo, por qué —«hay una pieza que no entra»— o vacío si no se
// reconoció la placa.
type Corteador func(ctx context.Context, d asistente.Despiece) (token, placa, motivo string, err error)

// ConCortes conecta las consultas de corte.
func (s *Servicio) ConCortes(c Corteador) *Servicio { s.cortar = c; return s }

// Presupuestar es el pedido de presupuesto que sacó el bot de la charla.
type Presupuestar struct {
	Slug     string           `json:"slug"`
	Medida   asistente.Medida `json:"medida"`
	Cantidad float64          `json:"cantidad"`
	// Unidad es la que dijo el cliente: "m2", "m" o vacío (unidades). Un
	// pendiente guardado antes de que existiera se lee vacío, como antes.
	Unidad string `json:"unidad,omitempty"`
	Texto  string `json:"texto"`
}

// EstadoBot es lo que el bot recuerda de una conversación.
type EstadoBot struct {
	Fallos   int
	Consulta string
	// Pendiente: el presupuesto que espera la medida.
	Pendiente *Presupuestar
}

// DatosBot es lo que el bot sabe del negocio.
type DatosBot struct {
	// Ahora es la hora del mensaje: fuera del horario, al derivar se dice
	// cuándo contesta la persona. Cero: no se dice nada.
	Ahora        time.Time
	Sitio        string // https://mjbj.iamnaw.dev
	NumeroHumano string // 549223…, sin el +
	StockVisible bool
	Envios       []string
	Productos    []ProductoBot // lo que trajo la búsqueda, si se buscó
	// Ahorro: se pasó el 80 % de los mensajes del mes (uso.go). No saluda y
	// deriva a la primera que no entiende: cada mensaje cuenta.
	Ahorro bool
}

// RespuestaBot es lo que decidió.
type RespuestaBot struct {
	Texto string
	// Derivar: se pasa a una persona y el bot se calla.
	Derivar bool
	// Buscar: hace falta el catálogo con esta consulta antes de contestar.
	Buscar   string
	Rubro    string
	Estado   EstadoBot
	Entendio asistente.Intencion
	// Presupuestar: hay un producto elegido y pidieron precio. Lo arma
	// atenderTurno con la ficha, en revisión.
	Presupuestar *Presupuestar
	// Cortar: escribieron un despiece; atenderTurno intenta guardarlo como
	// consulta de corte. Texto ya trae el link al cortador por si no se puede.
	Cortar *asistente.Despiece
	// Motivo: por qué se derivó, si no es obvio («pidió 12 m y se vende
	// por placa»). Va en el aviso a la persona.
	Motivo string
	// NoEntendio: el «no lo encontré» de la primera vez. En una ráfaga con
	// algo que sí se entendió, se descarta.
	NoEntendio bool
}

// TopeBotPorHora es cuántas respuestas da el bot en una conversación en una
// hora antes de frenarse. Una charla de verdad no llega: son 15 mensajes.
const TopeBotPorHora = 15

// TopeBotDiezMinutos es el freno rápido: con las ráfagas juntadas, una
// persona no recibe cinco respuestas en diez minutos; otro contestador
// automático, sí.
const TopeBotDiezMinutos = 5

const pieDerivar = "Escribile acá y seguís con una persona del mostrador:"

// Responder decide la respuesta a un texto. Si hace falta el catálogo,
// devuelve Buscar y hay que llamarla de nuevo con DatosBot.Productos lleno.
func Responder(texto string, est EstadoBot, d DatosBot, conBusqueda bool) RespuestaBot {
	// La respuesta automática de otro negocio («Gracias por comunicarte, te
	// responderemos a la brevedad»): contestarla es empezar un ida y vuelta
	// entre dos bots que Meta cobra de un solo lado.
	if esAutorespuesta(texto) {
		return RespuestaBot{Entendio: asistente.Gracias, Estado: est}
	}
	// Si estaba esperando la medida de un presupuesto y la medida llegó, se
	// completa; si escribieron otra cosa, el pendiente se olvida.
	if p := est.Pendiente; p != nil && !nombraAlgo(texto) {
		if m := medidaSuelta(texto); m.EspesorMm != 0 || m.LargoMm != 0 {
			q := *p
			q.Medida = m
			if c, u := cantidadPedida(texto, asistente.Entender(texto)); c != 1 || u != "" {
				q.Cantidad, q.Unidad = c, u
			}
			return RespuestaBot{Entendio: asistente.Precio, Presupuestar: &q, Estado: EstadoBot{Consulta: est.Consulta}}
		}
	}
	consulta := asistente.ConContexto(texto, est.Consulta)
	e := asistente.Entender(consulta)
	r := RespuestaBot{Entendio: e.Intencion, Estado: EstadoBot{Consulta: est.Consulta}}
	sitio := strings.TrimRight(d.Sitio, "/")

	switch e.Intencion {
	case asistente.Saludo:
		if d.Ahorro {
			// Un «hola» solo no necesita respuesta: la pregunta viene atrás.
			return r
		}
		r.Texto = "¡Hola! Soy el asistente de la Maderera Juan B. Justo. Contame qué buscás —«melamina blanca de 18», «4 de 600x400 en MDF con canto»— o preguntame horarios, envíos o formas de pago."
	case asistente.Gracias:
		// Sin respuesta: un «gracias» no necesita otro mensaje (que Meta
		// cobra), y contestarlo es lo que hace que dos bots no terminen nunca.
		return r
	case asistente.Horarios:
		var b strings.Builder
		b.WriteString("Estamos en:\n")
		for _, s := range Sucursales {
			fmt.Fprintf(&b, "\n*%s*\n%s\n%s\n", s.Nombre, s.Direccion, s.Horario)
		}
		r.Texto = strings.TrimSpace(b.String())
	case asistente.Envios:
		r.Texto = "Entregamos en Mar del Plata y la zona."
		if len(d.Envios) > 0 {
			r.Texto += "\n\n" + strings.Join(d.Envios, "\n")
		}
	case asistente.Pagos:
		r.Texto = "Se puede pagar con:\n• Efectivo\n• Transferencia\n• Débito y crédito\n• Cuenta corriente, si sos cliente profesional aprobado"
	case asistente.Cortes:
		r.Texto = "Sí, cortamos placas a medida en el aserradero. Pasame el despiece acá —por ejemplo «4 de 600x400 en melamina blanca con canto»— o armalo vos en " + sitio + "/corte"
	case asistente.ArmarCorte:
		dp := e.Despiece
		n := 0
		for _, p := range dp.Piezas {
			n += p.Cantidad
		}
		material := ""
		if dp.Material != "" {
			material = " en " + dp.Material
		}
		r.Texto = fmt.Sprintf("Te armé el corte: %d %s%s. Abrilo para ver cómo entra en la placa, elegí la sucursal y mandalo:\n%s%s",
			n, plural(n, "pieza", "piezas"), material, sitio, asistente.EnlaceDelDespiece(*dp))
		r.Cortar = dp
	case asistente.Cuenta:
		r.Texto = "Si trabajás del rubro —carpintería, construcción, arquitectura— pedí la cuenta profesional: lista propia, cuenta corriente y descuentos por cantidad.\n" + sitio + "/profesionales"
	case asistente.Moldava:
		r.Texto = "Moldava es nuestra línea propia: molduras y listonería en pino finger joint, sin nudos, en piezas de 3,05 m.\n" + sitio + "/moldava"
	case asistente.Documentacion:
		r.Texto = "Las fichas técnicas y tablas de carga están acá:\n" + sitio + "/documentacion"
	case asistente.Eventos:
		r.Texto = "Las capacitaciones y charlas están en la agenda:\n" + sitio + "/eventos"
	case asistente.Factura:
		r.Texto = "Facturamos A o B según tu condición frente al IVA. Para la A, pasanos el CUIT cuando compres."
	case asistente.Devoluciones:
		r.Texto = "Los cambios y devoluciones se hacen en la sucursal donde compraste, con el comprobante. Las condiciones:\n" + sitio + "/cambios-y-devoluciones"
	case asistente.Calcular:
		r.Texto = "Te hago la cuenta: si son placas, pasame las piezas («4 de 600x400 en melamina») y te armo el corte. Para techos, pisos o decks, contame los metros y lo que querés usar."
	case asistente.Persona, asistente.Acopio:
		return derivar(r, d, texto)
	default: // buscar, stock, sin_idea
		// «ok», «dale», «👍», «ya transferí»: no es una consulta, es la charla
		// de un pedido o un pago. El bot no se mete; lo ve una persona.
		if (e.Consulta == "" && e.Rubro == "") || esAcuse(texto) {
			return r
		}
		if !conBusqueda {
			r.Buscar, r.Rubro = e.Consulta, e.Rubro
			return r
		}
		ps := filtrarPorEspesor(d.Productos, e.Medida.EspesorMm)
		if len(ps) == 0 {
			// Ninguno en esa medida: se muestran igual, como en el sitio.
			// Decir «no hay» teniendo el producto en otro espesor pierde la venta.
			ps = d.Productos
		}
		if len(ps) == 0 {
			return noEntendio(r, est, d, texto)
		}
		r.Estado = EstadoBot{Consulta: e.Consulta}
		if preguntaPrecio(texto) {
			if len(ps) == 1 {
				// Un producto: se arma el presupuesto y lo revisa una persona.
				cant, unidad := cantidadPedida(texto, e)
				r.Presupuestar = &Presupuestar{Slug: ps[0].Slug, Medida: e.Medida, Cantidad: cant, Unidad: unidad, Texto: texto}
				return r
			}
			r.Texto = listarProductos(ps, sitio, d.StockVisible) + "\n\n¿De cuál te paso el presupuesto? Decime el nombre y la medida."
			return r
		}
		r.Texto = listarProductos(ps, sitio, d.StockVisible)
		return r
	}
	return r
}

var rePrecio = regexp.MustCompile(`\b(precio|precios|cuanto sale|cuanto salen|cuanto vale|cuanto valen|cuanto cuesta|cuanto cuestan|cuanto esta|cuanto estan|presupuesto|cotizacion|cotizame|pasame (?:el )?precio|pasame (?:un )?presupuesto)\b`)

// reCantidad es «10 placas», «5 u», «3 tirantes», «1.000 placas»: un número
// seguido de una unidad. No lee el «18» de un espesor ni el «600» de una
// medida. El prefijo evita empezar en medio de un número: con «\b», en
// «1.000 placas» se leía el «000».
var reCantidad = regexp.MustCompile(`(?:^|[^\d.,])(\d{1,3}(?:\.\d{3})+|\d{1,4})\s*(?:u|un|unid|unidades|placas?|tirantes?|tablas?|piezas?|rollos?|bolsas?|chapas?|barras?|listones?|varillas?|cajas?|latas?)\b`)

// nombraAlgo: el texto trae un producto o un rubro, no solo una medida. Con
// un presupuesto esperando la medida, «de 18» la completa y «mejor pasame
// precio de mdf de 18» es otro pedido.
func nombraAlgo(texto string) bool {
	e := asistente.Entender(texto)
	return e.Rubro != "" || strings.TrimSpace(reConectoresBot.ReplaceAllString(e.Consulta, "")) != ""
}

// Los m² y los metros también: «de 18, 6 m2» completa la medida con la
// cantidad, no pide otra cosa.
var reConectoresBot = regexp.MustCompile(`\b(la|el|y|en|de|con|esa|ese|medida|espesor|grosor|mm|m2|m|metros?|cuadrados?)\b`)

// esAcuse: lo que se dice en la charla de un pedido o un pago y no es una
// consulta: «dale», «listo», «ya transferí», «te mando el comprobante».
var (
	// Solas, son todo el mensaje: «si tienen mdf?» no es un acuse.
	reAcuseCorto = regexp.MustCompile(`^(ok|oka|okey|okis|oki|okas|okk|dale|listo|joya|genial|perfecto|bueno|buenisimo|barbaro|si|no|claro|de una|vale|entendido|ahi va|ya esta|re bien|todo bien|de nada|saludos|abrazo|ja(ja)+|je(je)+)( (gracias|muchas gracias|mil gracias|che|genial|perfecto|dale|ja(ja)+))?$`)
	// En cualquier parte: la charla de un pago o un envío.
	reAcusePago = regexp.MustCompile(`\b(transferi|transferencia hecha|comprobante|ya pague|pague|deposite|te mande|te mando|aguardo|quedo atento|cuando llega|cuando me llega|cuando sale)\b`)
)

func esAcuse(texto string) bool {
	t := strings.Trim(asistente.Corregir(asistente.Normalizar(texto)), " .,")
	return reAcuseCorto.MatchString(t) || reAcusePago.MatchString(t)
}

// reAutorespuesta son las respuestas automáticas de WhatsApp Business y de
// los contestadores: lo que manda una máquina, no una persona.
var reAutorespuesta = regexp.MustCompile(`\b(mensaje automatico|respuesta automatica|auto ?respuesta|te responderemos|le responderemos|responderemos a la brevedad|respondemos a la brevedad|nos comunicaremos|en breve (te|le|nos)|a la brevedad posible|fuera (del|de nuestro) horario|no (estoy|estamos) disponibles?|gracias por (comunicarte|comunicarse|contactarte|contactarnos|escribirnos|tu mensaje|su mensaje)|este numero (ya )?no|no recibe mensajes)\b`)

func esAutorespuesta(texto string) bool {
	return reAutorespuesta.MatchString(asistente.Normalizar(texto))
}

var reNumeroSolo = regexp.MustCompile(`^(\d{1,2})\s*(mm)?$`)

// medidaSuelta lee la medida de una respuesta corta: «18», «de 18», «18mm»,
// «1830x2600».
func medidaSuelta(texto string) asistente.Medida {
	t := asistente.Normalizar(texto)
	if g := reNumeroSolo.FindStringSubmatch(t); g != nil {
		var n int
		fmt.Sscan(g[1], &n)
		if n >= 3 && n <= 50 {
			return asistente.Medida{EspesorMm: n}
		}
	}
	return asistente.Entender(t).Medida
}

// cantidadPedida es cuánto piden y en qué: los metros o los m² si los
// dijeron («m» o «m2»), si no las unidades (sin unidad), y si no una. Las
// medidas se borran antes: el «1.830» de «1.830x2.600» no es una cantidad.
func cantidadPedida(texto string, e asistente.Entendido) (float64, string) {
	if e.Cantidad != nil && e.Cantidad.Valor > 0 {
		return e.Cantidad.Valor, e.Cantidad.Unidad
	}
	if g := reCantidad.FindStringSubmatch(asistente.SinMedidas(asistente.Normalizar(texto))); g != nil {
		if n := asistente.Numero(g[1]); n > 0 {
			return n, ""
		}
	}
	return 1, ""
}

// Los topes de lo que el bot presupuesta solo. Ningún pedido real por
// WhatsApp pasa de esto, y si alguno pasa lo tiene que ver una persona: un
// tipeo («2000 placas» por «20») no puede salir como presupuesto.
const (
	topeUnidadesBot = 200
	topeMetrosBot   = 2000
)

// cantidadCotizada es lo que va al presupuesto, en la unidad de venta.
type cantidadCotizada struct {
	Cantidad float64
	// Convertida: pidieron m² y se vende por placa. Pedido es lo que dijeron
	// («6 m²») y Cubre los m² de las placas enteras: lo que se paga.
	Convertida bool
	Pedido     string
	Cubre      float64
}

// cantidadEnUnidadDeVenta pasa lo que pidieron a la unidad en que se vende el
// producto. Los m² de un producto por m² y los metros de uno por metro van
// igual; los m² de una placa se cuentan en placas enteras (es una cantidad de
// placas, no plata: se redondea para arriba). Cualquier otra combinación
// —metros de una placa, m² de algo que se vende por unidad, una placa sin
// medida— da false y lo resuelve una persona: cotizar «12 metros de
// melamina» como 12 placas es lo que pasaba antes.
func cantidadEnUnidadDeVenta(cant float64, unidadDicha, unidadVenta string, v VarianteBot) (cantidadCotizada, bool) {
	if cant <= 0 {
		return cantidadCotizada{}, false
	}
	var c cantidadCotizada
	switch {
	case unidadDicha == "":
		c.Cantidad = cant
	case unidadDicha == "m2" && unidadVenta == "metro_cuadrado", unidadDicha == "m" && unidadVenta == "metro_lineal":
		c.Cantidad = cant
	case unidadDicha == "m2" && unidadVenta == "placa" && v.LargoMm > 0 && v.AnchoMm > 0:
		area := float64(v.LargoMm) * float64(v.AnchoMm) / 1e6
		// El épsilon: que 9,516 m² pedidos en placas de 4,758 no den 3.
		c.Cantidad = math.Ceil(cant/area - 1e-9)
		c.Convertida = true
		c.Pedido = formato.Decimal(cant, 2) + " m²"
		c.Cubre = c.Cantidad * area
	default:
		return cantidadCotizada{}, false
	}
	tope := float64(topeUnidadesBot)
	if unidadVenta == "metro_cuadrado" || unidadVenta == "metro_lineal" {
		tope = topeMetrosBot
	}
	if c.Cantidad > tope {
		return cantidadCotizada{}, false
	}
	return c, true
}

func preguntaPrecio(texto string) bool { return rePrecio.MatchString(asistente.Normalizar(texto)) }

func noEntendio(r RespuestaBot, est EstadoBot, d DatosBot, texto string) RespuestaBot {
	if est.Fallos >= 1 || d.Ahorro {
		return derivar(r, d, texto)
	}
	r.NoEntendio = true
	r.Estado = EstadoBot{Fallos: est.Fallos + 1, Consulta: est.Consulta}
	r.Texto = "No lo encontré. Probá con el nombre del producto y la medida —«fenólico de 18», «machimbre de pino»— o escribí *persona* y te paso con el mostrador."
	return r
}

func derivar(r RespuestaBot, d DatosBot, texto string) RespuestaBot {
	cuando := ""
	if !d.Ahora.IsZero() {
		if p := proximaApertura(d.Ahora); p != "" {
			cuando = " Ahora estamos cerrados: te contestan " + p + "."
		}
	}
	r.Derivar = true
	if d.NumeroHumano == "" {
		r.Texto = "Te va a contestar una persona del mostrador por acá, en el horario de atención." + cuando
		return r
	}
	r.Texto = "Te paso con una persona." + cuando + " " + pieDerivar + "\n" + enlaceHumano(d.NumeroHumano, texto)
	return r
}

// El horario de atención, el mismo de las dos sucursales (Sucursales, en
// avisos.go): lunes a viernes de 8 a 16 y sábados de 8 a 12.
func abierto(t time.Time) bool {
	t = t.In(argentina)
	h := t.Hour()
	switch t.Weekday() {
	case time.Sunday:
		return false
	case time.Saturday:
		return h >= 8 && h < 12
	}
	return h >= 8 && h < 16
}

// proximaApertura dice cuándo abre, si ahora está cerrado: «hoy a las 8»,
// «mañana a las 8», «el lunes a las 8». Vacío si está abierto.
func proximaApertura(t time.Time) string {
	a, d := aperturaSiguiente(t)
	if a.IsZero() {
		return ""
	}
	switch d {
	case 0:
		return "hoy a las 8"
	case 1:
		return "mañana a las 8"
	}
	return "el " + [...]string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}[a.Weekday()] + " a las 8"
}

// aperturaSiguiente es el instante en que vuelve a abrir y en cuántos días;
// cero si está abierto.
func aperturaSiguiente(t time.Time) (time.Time, int) {
	t = t.In(argentina)
	if abierto(t) {
		return time.Time{}, 0
	}
	for d := 0; d < 3; d++ {
		dia := t.AddDate(0, 0, d)
		apertura := time.Date(dia.Year(), dia.Month(), dia.Day(), 8, 0, 0, 0, argentina)
		if dia.Weekday() == time.Sunday || !apertura.After(t) {
			continue
		}
		return apertura, d
	}
	return time.Time{}, 0
}

// enlaceHumano es el wa.me al número humano con la consulta ya escrita, así el
// cliente no tiene que contar todo de nuevo.
func enlaceHumano(numero, texto string) string {
	// Recortado: el texto va entero en la URL, y un mensaje largo pasaría el
	// límite de 4096 de Meta y la respuesta no saldría.
	msg := "Hola, vengo del WhatsApp automático. " + cortarJS(strings.TrimSpace(texto), 400)
	return "https://wa.me/" + numero + "?text=" + url.QueryEscape(msg)
}

func filtrarPorEspesor(ps []ProductoBot, mm int) []ProductoBot {
	if mm == 0 {
		return ps
	}
	re := regexp.MustCompile(fmt.Sprintf(`(^|[^\d])%d\s*mm`, mm))
	var quedan []ProductoBot
	for _, p := range ps {
		var ms []string
		for _, m := range p.Medidas {
			if re.MatchString(m) {
				ms = append(ms, m)
			}
		}
		if len(ms) > 0 {
			p.Medidas = ms
			quedan = append(quedan, p)
		}
	}
	return quedan
}

func listarProductos(ps []ProductoBot, sitio string, stock bool) string {
	if len(ps) > 4 {
		ps = ps[:4]
	}
	var b strings.Builder
	b.WriteString("Esto tenemos:\n")
	for _, p := range ps {
		fmt.Fprintf(&b, "\n*%s*", p.Nombre)
		if len(p.Medidas) > 0 {
			ms := p.Medidas
			if len(ms) > 3 {
				ms = append(ms[:3:3], fmt.Sprintf("y %d más", len(p.Medidas)-3))
			}
			b.WriteString("\n" + strings.Join(ms, " · "))
		}
		if stock {
			switch {
			case p.Central && p.Aserr:
				b.WriteString("\nHay en las dos sucursales")
			case p.Central:
				b.WriteString("\nHay en Casa Central")
			case p.Aserr:
				b.WriteString("\nHay en el Aserradero")
			}
		}
		b.WriteString("\n" + sitio + "/catalogo/" + p.Slug + "\n")
	}
	return strings.TrimSpace(b.String())
}

func plural(n int, uno, varios string) string {
	if n == 1 {
		return uno
	}
	return varios
}

// Turno es lo que se contesta a una ráfaga de mensajes: las partes van en un
// solo mensaje, que es lo que Meta cobra.
type Turno struct {
	Partes  []string
	Derivar bool
	Estado  EstadoBot
}

// JuntarRespuestas arma una sola respuesta para varios mensajes seguidos
// («hola» / «tenés fenólico?» / «y hacen envíos?»): cada respuesta una vez,
// sin el saludo si hay algo más que decir, sin el «no lo encontré» si otra
// cosa se entendió, y con el pase a una persona al final, con todo lo que
// escribió en el enlace. `textos` son los mensajes que dieron cada
// respuesta; `extra`, lo que se dice de lo que no es texto (una foto, un
// audio que no se pudo escuchar); `dichos`, lo que el bot ya le contestó
// en las últimas horas, que no se repite.
func JuntarRespuestas(rs []RespuestaBot, textos, extra []string, est EstadoBot, d DatosBot, dichos []string) Turno {
	t := Turno{Estado: est}
	saludo := ""
	noEntendio := ""
	var utiles []string
	for _, r := range rs {
		t.Estado = r.Estado
		switch {
		case r.Derivar:
			t.Derivar = true
		case r.Texto == "":
		case r.Entendio == asistente.Saludo:
			saludo = r.Texto
		case r.NoEntendio:
			noEntendio = r.Texto
		default:
			utiles = append(utiles, r.Texto)
		}
	}
	utiles = append(utiles, extra...)
	if len(utiles) > 0 {
		// Algo se entendió: el «no lo encontré» de otro mensaje no suma un
		// fallo ni se dice.
		t.Estado.Fallos = 0
	}
	vistas := map[string]bool{}
	for _, u := range utiles {
		if u != "" && !vistas[u] && !yaDicho(u, dichos) {
			vistas[u] = true
			t.Partes = append(t.Partes, u)
		}
	}
	if t.Derivar {
		t.Partes = append(t.Partes, derivar(RespuestaBot{}, d, strings.Join(textos, "\n")).Texto)
		t.Estado = EstadoBot{}
	}
	switch {
	case len(t.Partes) == 0 && noEntendio != "" && !yaDicho(noEntendio, dichos):
		t.Partes = []string{noEntendio}
	case len(t.Partes) == 0 && saludo != "" && !yaDicho(saludo, dichos):
		t.Partes = []string{saludo}
	case len(t.Partes) > 0 && saludo != "" && !yaDicho(saludo, dichos):
		t.Partes[0] = "¡Hola! " + t.Partes[0]
	}
	return t
}

// --- lo que lee y escribe ---

type ajustesBot struct {
	encendido    bool
	numeroHumano string
	stockVisible bool
}

func (s *Servicio) ajustesBot(ctx context.Context) (ajustesBot, error) {
	var a ajustesBot
	filas, err := s.pool.Query(ctx, `select clave, valor from site_settings where clave in ('whatsapp_bot', 'whatsapp_numero_humano', 'stock_visible')`)
	if err != nil {
		return a, err
	}
	defer filas.Close()
	for filas.Next() {
		var k, v string
		if err := filas.Scan(&k, &v); err != nil {
			return a, err
		}
		switch k {
		case "whatsapp_bot":
			a.encendido = v == "si"
		case "whatsapp_numero_humano":
			a.numeroHumano = soloDigitos(v)
		case "stock_visible":
			a.stockVisible = v == "si"
		}
	}
	return a, filas.Err()
}

var reNoDigito = regexp.MustCompile(`\D`)

func soloDigitos(s string) string { return reNoDigito.ReplaceAllString(s, "") }

func (s *Servicio) enviosParaBot(ctx context.Context) []string {
	filas, err := s.pool.Query(ctx, `select nombre, demora_estimada from shipping_zones where activa order by orden, nombre`)
	if err != nil {
		return nil
	}
	defer filas.Close()
	var out []string
	for filas.Next() {
		var nombre string
		var demora *string
		if filas.Scan(&nombre, &demora) != nil {
			return nil
		}
		linea := "• " + nombre
		if demora != nil && *demora != "" {
			linea += " — " + *demora
		}
		out = append(out, linea)
	}
	return out
}

// estadoParaElBot es lo que decide si el bot habla en una conversación.
type estadoParaElBot struct {
	EstadoBot
	ajustes ajustesBot
}

// Por qué el bot no habla.
const (
	callaApagado = "apagado"
	// callaPersona: la conversación es de una persona (derivada, asignada o
	// con alguien que escribió hace poco). Fuera de horario puede salir el
	// aviso de cerrado (turno.go).
	callaPersona = "persona"
	callaTope    = "tope"
	callaFrenado = "frenado"
)

// botPuedeHablar dice si al bot le toca contestar en esta conversación, y con
// qué memoria; si no, por qué. No le toca si está apagado, si la
// conversación está derivada o asignada a alguien, si una persona escribió o
// salió un aviso automático en las últimas 12 horas (es la charla de un
// pedido), si se llegó a un tope del mes, o si ya contestó demasiado en la
// última hora o en los últimos diez minutos (el freno contra otro
// contestador automático).
func (s *Servicio) botPuedeHablar(ctx context.Context, convID string) (*estadoParaElBot, string, error) {
	aj, err := s.ajustesBot(ctx)
	if err != nil || !aj.encendido {
		return nil, callaApagado, err
	}
	var estado string
	var fallos, deLaHora, deDiezMinutos int
	var consulta, pendiente, asignado *string
	var personaReciente bool
	err = s.pool.QueryRow(ctx, `
		select c.bot_estado, c.bot_fallos, c.bot_consulta, c.bot_pendiente::text, c.asignado_a_user_id,
			exists (select 1 from whatsapp_mensajes m where m.conversacion_id = c.id and m.direccion = 'saliente'
				and coalesce(m.origen, '') in ('panel', 'telefono', 'aviso') and m.ocurrido_at > now() - interval '12 hours'),
			(select count(*) from whatsapp_mensajes m where m.conversacion_id = c.id and m.origen = 'bot'
				and m.ocurrido_at > now() - interval '1 hour'),
			(select count(*) from whatsapp_mensajes m where m.conversacion_id = c.id and m.origen = 'bot'
				and m.ocurrido_at > now() - interval '10 minutes')
		  from whatsapp_conversaciones c where c.id = $1`, convID).Scan(&estado, &fallos, &consulta, &pendiente, &asignado, &personaReciente, &deLaHora, &deDiezMinutos)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, callaApagado, nil
	}
	if err != nil {
		return nil, "", err
	}
	if estado != "activo" || asignado != nil || personaReciente {
		return nil, callaPersona, nil
	}
	if s.TopeAlcanzado(ctx) {
		return nil, callaTope, nil
	}
	if deLaHora >= TopeBotPorHora || deDiezMinutos >= TopeBotDiezMinutos {
		if _, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_estado = 'derivada', bot_derivada_at = now(), bot_pendiente = null where id = $1`, convID); err != nil {
			return nil, "", err
		}
		cuerpo := fmt.Sprintf("Contestó %d veces en una hora en la misma conversación. Sigue una persona.", deLaHora)
		if deLaHora < TopeBotPorHora {
			cuerpo = fmt.Sprintf("Contestó %d veces en diez minutos: puede ser otro contestador automático. Sigue una persona.", deDiezMinutos)
		}
		s.avisar(ctx, push.Aviso{Titulo: "WhatsApp: el bot se frenó", Cuerpo: cuerpo,
			URL: "/admin/whatsapp?chat=" + convID, Etiqueta: "whatsapp-" + convID, Pantalla: "/admin/whatsapp"})
		return nil, callaFrenado, nil
	}
	e := &estadoParaElBot{EstadoBot: EstadoBot{Fallos: fallos}, ajustes: aj}
	if consulta != nil {
		e.Consulta = *consulta
	}
	if pendiente != nil {
		var p Presupuestar
		if json.Unmarshal([]byte(*pendiente), &p) == nil && p.Slug != "" {
			e.Pendiente = &p
		}
	}
	return e, "", nil
}

// parteDelTurno es lo que el bot contestó a uno de los mensajes de una
// ráfaga, con lo que hay que hacer después de mandarlo.
type parteDelTurno struct {
	r     RespuestaBot
	aviso *push.Aviso
	// pasaAPersona: la persona sigue en la bandeja, por este mismo número:
	// el corte y el presupuesto prometen «te confirmamos por acá», y alguien
	// lo tiene que hacer. No es derivar a otro número.
	pasaAPersona bool
}

// resolverTexto decide la respuesta a un texto con todo lo que hace falta: el
// catálogo, las zonas de envío, el corte guardado y el presupuesto armado.
// No manda nada. entranteID es el mensaje que lo pidió: lo que se crea (el
// corte, el presupuesto) queda anotado ahí, y si el turno se reintenta no se
// crea otra vez.
func (s *Servicio) resolverTexto(ctx context.Context, convID, waJid, entranteID, texto string, est EstadoBot, d DatosBot) (parteDelTurno, error) {
	var p parteDelTurno
	r := Responder(texto, est, d, false)
	if r.Entendio == asistente.Envios {
		d.Envios = s.enviosParaBot(ctx)
		r = Responder(texto, est, d, false)
	}
	if r.Buscar != "" || r.Rubro != "" {
		if s.buscar != nil {
			ps, err := s.buscar(ctx, r.Buscar, r.Rubro)
			if err != nil {
				s.log.Warn("el bot no pudo buscar en el catálogo", "error", err)
			}
			d.Productos = ps
		}
		r = Responder(texto, est, d, true)
	}
	if r.Cortar != nil && s.cortar != nil {
		hecho, err := s.yaCreado(ctx, entranteID, "botCorte")
		if err != nil {
			return p, err
		}
		if hecho == nil {
			texto, aviso, err := s.consultaDeCorte(ctx, convID, *r.Cortar, d.Sitio, r.Texto)
			if err != nil {
				s.log.Warn("el bot no pudo guardar el corte", "error", err)
			} else {
				hecho = &creadoPorElBot{Texto: texto, Aviso: aviso}
				if aviso != nil {
					if err := s.anotarCreado(ctx, s.pool, entranteID, "botCorte", *hecho); err != nil {
						s.log.Warn("el bot no pudo anotar el corte", "error", err)
					}
				}
			}
		}
		if hecho != nil {
			r.Texto, p.aviso = hecho.Texto, hecho.Aviso
			p.pasaAPersona = hecho.Aviso != nil
		}
	}
	if r.Presupuestar != nil {
		texto, consulta, aviso, motivo, err := s.presupuestar(ctx, convID, waJid, entranteID, *r.Presupuestar)
		if err != nil {
			return p, err
		}
		switch {
		case aviso != nil:
			r.Texto, p.aviso = texto, aviso
		case texto != "":
			// Falta la medida: queda pendiente hasta la respuesta.
			r.Texto, r.Estado.Consulta, r.Estado.Pendiente = texto, consulta, r.Presupuestar
		default:
			// Sin precio cargado, sin ficha o una cantidad que no se puede
			// pasar a la unidad de venta: lo resuelve una persona.
			r = derivar(r, d, r.Presupuestar.Texto)
			r.Motivo = motivo
		}
	}
	p.r = r
	return p, nil
}

// ReactivarBot le devuelve la conversación al bot.
func (s *Servicio) ReactivarBot(ctx context.Context, convID string) error {
	_, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_estado = 'activo', bot_fallos = 0, bot_derivada_at = null, bot_pendiente = null where id = $1`, convID)
	return err
}

// creadoPorElBot es lo que el bot creó a partir de un mensaje (un corte, un
// presupuesto), anotado en ese mensaje: si el turno falla antes de contestar
// y se reintenta, se contesta lo mismo sin crearlo de nuevo.
type creadoPorElBot struct {
	Texto string      `json:"texto"`
	Aviso *push.Aviso `json:"aviso"`
}

// yaCreado lee lo anotado en el entrante bajo `clave`, si hay.
func (s *Servicio) yaCreado(ctx context.Context, entranteID, clave string) (*creadoPorElBot, error) {
	if entranteID == "" {
		return nil, nil
	}
	var crudo []byte
	err := s.pool.QueryRow(ctx, `select datos->$2 from whatsapp_mensajes where id = $1`, entranteID, clave).Scan(&crudo)
	if errors.Is(err, pgx.ErrNoRows) || len(crudo) == 0 || string(crudo) == "null" {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var c creadoPorElBot
	if err := json.Unmarshal(crudo, &c); err != nil || c.Texto == "" {
		return nil, nil
	}
	return &c, nil
}

// anotarCreado guarda en el entrante lo que se creó por él.
func (s *Servicio) anotarCreado(ctx context.Context, q interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, entranteID, clave string, c creadoPorElBot) error {
	if entranteID == "" {
		return nil
	}
	b, _ := json.Marshal(c)
	_, err := q.Exec(ctx, `update whatsapp_mensajes set datos = coalesce(datos, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb) where id = $1`,
		entranteID, clave, string(b))
	return err
}

// presupuestar elige la medida y arma el presupuesto en revisión. Devuelve:
//   - el texto y el aviso, si lo armó (o si ya lo había armado por este
//     mismo mensaje, en un turno que no llegó a contestar);
//   - solo el texto (y la consulta para seguir) si falta saber la medida;
//   - nada, si no se puede: sin ficha o sin precio, lo ve una persona.
func (s *Servicio) presupuestar(ctx context.Context, convID, waJid, entranteID string, p Presupuestar) (texto, consulta string, aviso *push.Aviso, motivo string, err error) {
	if s.ficha == nil {
		return "", "", nil, "", nil
	}
	if hecho, err := s.yaCreado(ctx, entranteID, "botPresupuesto"); err != nil || hecho != nil {
		if err != nil {
			return "", "", nil, "", err
		}
		return hecho.Texto, "", hecho.Aviso, "", nil
	}
	f, err := s.ficha(ctx, p.Slug)
	if err != nil || f == nil {
		return "", "", nil, "", err
	}
	vs := elegirVariantes(f.Variantes, p.Medida)
	if len(vs) == 0 {
		// Dijeron una medida que no está: se pregunta entre todas, no se
		// cotiza otra sin avisar.
		vs = f.Variantes
		if len(vs) == 1 && (p.Medida.EspesorMm != 0 || p.Medida.LargoMm != 0) {
			return fmt.Sprintf("El *%s* lo tenemos en %s. ¿Te sirve?", f.Nombre, vs[0].Label), asistente.ConsultaLimpia(f.Nombre), nil, "", nil
		}
	}
	if len(vs) > 1 {
		var ms []string
		for _, v := range vs {
			if len(ms) == 6 {
				break
			}
			ms = append(ms, "• "+v.Label)
		}
		return fmt.Sprintf("¿En qué medida querés el *%s*?\n%s", f.Nombre, strings.Join(ms, "\n")), asistente.ConsultaLimpia(f.Nombre), nil, "", nil
	}
	if len(vs) == 0 {
		return "", "", nil, "", nil
	}
	if vs[0].Precio == "" {
		return "", "", nil, "Sin precio cargado: " + strings.TrimSpace(f.Nombre+" "+vs[0].Label) + ".", nil
	}
	v := vs[0]
	cc, ok := cantidadEnUnidadDeVenta(p.Cantidad, p.Unidad, f.Unidad, v)
	if !ok {
		// No se cotiza algo mal: lo resuelve una persona, que ve en el aviso
		// qué pidió y por qué no salió solo.
		return "", "", nil, motivoSinCotizar(p, f.Unidad, v), nil
	}

	var nombre, telefono string
	var clienteID, sucursalID *string
	if err := s.pool.QueryRow(ctx, `
		select coalesce(cu.nombre, c.display_name, 'Cliente de WhatsApp'), c.customer_id, c.branch_id
		  from whatsapp_conversaciones c left join customers cu on cu.id = c.customer_id where c.id = $1`, convID).Scan(&nombre, &clienteID, &sucursalID); err != nil {
		return "", "", nil, "", err
	}
	// El teléfono, solo si el remitente vino con número: con BSUID no lo hay.
	var tel *string
	if n := soloDigitos(WaIdDeJid(waJid)); len(n) >= 10 && len(n) <= 15 {
		telefono = "+" + n
		tel = &telefono
	}
	var variante *string
	if v.ID != "" {
		variante = &v.ID
	}
	descripcion := strings.TrimSpace(f.Nombre + " " + v.Label)
	ahora := s.ahora()
	var id, numero string
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", "", nil, "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if numero, err = numeracion.Presupuesto(ctx, tx, ahora.In(argentina)); err != nil {
		return "", "", nil, "", err
	}
	if err := tx.QueryRow(ctx, `
		insert into quotes (numero, customer_id, contacto_nombre, contacto_telefono, branch_id, estado, origen,
		                    subtotal, total, notas, asesor, valido_hasta)
		values ($1, $2, $3, $4, $5, 'revision', 'whatsapp', round($6::numeric * $7::numeric, 2), round($6::numeric * $7::numeric, 2),
		        $8, 'Bot de WhatsApp', $9)
		returning id`, numero, clienteID, nombre, tel, sucursalID, v.Precio, cc.Cantidad,
		notaDelBot(p, cc), ahora.UTC().AddDate(0, 0, 7)).Scan(&id); err != nil {
		return "", "", nil, "", err
	}
	if _, err := tx.Exec(ctx, `
		insert into quote_items (quote_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, orden)
		values ($1, $2, $3, $4, $5::numeric, $6::numeric, round($5::numeric * $6::numeric, 2), 0)`,
		id, variante, descripcion, f.Unidad, cc.Cantidad, v.Precio); err != nil {
		return "", "", nil, "", err
	}
	cant := formato.Decimal(cc.Cantidad, 2)
	texto = fmt.Sprintf("Listo: te armo el presupuesto de *%s × %s*.%s Una persona lo revisa y te lo manda por acá en un rato.", cant, descripcion, aclaracionDeLaConversion(cc))
	cuerpo := nombre + ": " + cant + " × " + descripcion + ". Revisalo y mandalo."
	if cc.Convertida {
		cuerpo = nombre + ": pidió " + cc.Pedido + ", van " + cant + " × " + descripcion + ". Revisalo y mandalo."
	}
	aviso = &push.Aviso{Titulo: "Presupuesto " + numero + " por WhatsApp", Cuerpo: cuerpo,
		URL: "/admin/presupuestos/" + id, Etiqueta: "presupuesto-" + id, Pantalla: "/admin/presupuestos"}
	// En la misma transacción: o queda el presupuesto y la anotación, o
	// ninguno de los dos.
	if err := s.anotarCreado(ctx, tx, entranteID, "botPresupuesto", creadoPorElBot{Texto: texto, Aviso: aviso}); err != nil {
		return "", "", nil, "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", nil, "", err
	}
	return texto, "", aviso, "", nil
}

// motivoSinCotizar es lo que lee quien atiende en el aviso de la derivación,
// sin abrir la charla: qué pidió y por qué el bot no lo cotizó.
func motivoSinCotizar(p Presupuestar, unidadVenta string, v VarianteBot) string {
	pedido := formato.Decimal(p.Cantidad, 2)
	switch p.Unidad {
	case "m2":
		pedido += " m²"
	case "m":
		pedido += " m"
	}
	que := strings.TrimSpace(v.Label)
	switch {
	case p.Unidad == "m2" && unidadVenta == "placa":
		return "Pidió " + pedido + " y la placa " + que + " no tiene medida cargada: no se cotizó."
	case p.Unidad != "" && unidadVenta != "metro_cuadrado" && unidadVenta != "metro_lineal" || p.Unidad == "m" && unidadVenta == "metro_cuadrado" || p.Unidad == "m2" && unidadVenta == "metro_lineal":
		return "Pidió " + pedido + " y se vende por " + nombreDeUnidad(unidadVenta) + ": no se cotizó."
	}
	return "Pidió " + pedido + ": pasa el tope del bot, revisalo."
}

// nombreDeUnidad es formatearUnidadLarga (lib/unidades.ts).
func nombreDeUnidad(u string) string {
	switch u {
	case "", "unidad":
		return "unidad"
	case "metro_lineal":
		return "metro"
	case "metro_cuadrado":
		return "metro cuadrado"
	case "kg":
		return "kilo"
	}
	return strings.ReplaceAll(u, "_", " ")
}

// aclaracionDeLaConversion le dice al cliente qué cubren las placas enteras:
// pidió 6 m² y dos placas de 1,83 × 2,60 son 9,52 m². Decir «2 placas
// (6 m²)» le haría creer que paga lo que pidió, y la discusión es en el
// mostrador con cola.
func aclaracionDeLaConversion(c cantidadCotizada) string {
	if !c.Convertida {
		return ""
	}
	return fmt.Sprintf(" Pediste %s: %s %s %s m².", c.Pedido, formato.Decimal(c.Cantidad, 2),
		plural(int(c.Cantidad), "placa entera cubre", "placas enteras cubren"), formato.Decimal(c.Cubre, 2))
}

// notaDelBot es la nota del presupuesto: lo que escribió el cliente y, si se
// pasó de m² a placas, la diferencia, para que quien lo revisa la vea antes
// de mandarlo.
func notaDelBot(p Presupuestar, c cantidadCotizada) string {
	nota := "Pedido por WhatsApp: «" + cortarJS(trimJS(p.Texto), 300) + "»"
	if c.Convertida {
		nota += fmt.Sprintf("\nPidió %s; se cotizan %s placas enteras, que cubren %s m².", c.Pedido,
			formato.Decimal(c.Cantidad, 2), formato.Decimal(c.Cubre, 2))
	}
	return nota
}

// elegirVariantes deja las medidas que coinciden con lo que dijeron.
func elegirVariantes(vs []VarianteBot, m asistente.Medida) []VarianteBot {
	if m.EspesorMm == 0 && m.LargoMm == 0 {
		return vs
	}
	var quedan []VarianteBot
	for _, v := range vs {
		if m.EspesorMm != 0 && v.EspesorMm != m.EspesorMm {
			continue
		}
		if m.LargoMm != 0 && !((v.LargoMm == m.LargoMm && v.AnchoMm == m.AnchoMm) || (v.LargoMm == m.AnchoMm && v.AnchoMm == m.LargoMm)) {
			continue
		}
		quedan = append(quedan, v)
	}
	return quedan
}

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// consultaDeCorte guarda el despiece como consulta de corte. Si no reconoce la
// placa, deja el texto con el link al cortador; si una pieza no entra, lo dice.
func (s *Servicio) consultaDeCorte(ctx context.Context, convID string, d asistente.Despiece, sitio, textoSinConsulta string) (string, *push.Aviso, error) {
	token, placa, motivo, err := s.cortar(ctx, d)
	if err != nil {
		return "", nil, err
	}
	sitio = strings.TrimRight(sitio, "/")
	if motivo != "" {
		return motivo + "\n\nPodés corregirlo en el cortador:\n" + sitio + asistente.EnlaceDelDespiece(d), nil, nil
	}
	if token == "" {
		return textoSinConsulta, nil, nil
	}
	n := 0
	for _, p := range d.Piezas {
		n += p.Cantidad
	}
	enlace := sitio + "/corte/c/" + token
	texto := fmt.Sprintf("Te armé el corte: %d %s en *%s*. Ya lo tiene el aserradero: te confirmamos precio y entrega por acá.\n\nEl plano:\n%s",
		n, plural(n, "pieza", "piezas"), placa, enlace)
	var nombre string
	_ = s.pool.QueryRow(ctx, `select coalesce(cu.nombre, c.display_name, 'Cliente de WhatsApp') from whatsapp_conversaciones c
		left join customers cu on cu.id = c.customer_id where c.id = $1`, convID).Scan(&nombre)
	aviso := &push.Aviso{Titulo: "Corte por WhatsApp", Cuerpo: fmt.Sprintf("%s: %d %s en %s. Confirmale precio y entrega.", nombre, n, plural(n, "pieza", "piezas"), placa),
		URL: "/corte/c/" + token, Etiqueta: "corte-" + token, Pantalla: "/admin/cortes"}
	return texto, aviso, nil
}
