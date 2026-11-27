package whatsapp

import (
	"regexp"
	"sort"
	"strings"

	"mjbj/internal/asistente"
)

// Lo que el bot reconoce antes de pasarle el texto al motor del asistente
// (internal/asistente). Vive acá y no en el motor porque es del WhatsApp: el
// asistente del sitio no deriva a una persona ni lee reclamos, y su motor
// tiene que entender lo mismo que el de TypeScript (lib/asistente).
//
// Salió del mes simulado (27/11/2026): el bot se callaba ante «gracias, y
// hacen envíos a Batán?», contestaba el catálogo a un reclamo y el servicio
// de corte a quien pedía hablar con una persona.

// reAgradecimiento es el «gracias» del principio, con lo que suele ir antes
// («ok», «dale») y el «y» de lo que sigue. Lo que queda atrás es la pregunta.
var reAgradecimiento = regexp.MustCompile(`(?i)^\s*(?:(?:ok|oka|okey|dale|bueno|listo|perfecto|genial|joya|b[aá]rbaro|buen[ií]simo)[\s,.!]+)?(?:(?:muchas|mil)\s+)?(?:gracias|grax|grasias)[\s,.!¡¿]*(?:(?:y|che)\s+)?`)

// sinAgradecimiento saca el «gracias» del principio si atrás hay algo más:
// «Ok gracias, hacen envíos a Batán?» es la pregunta por el envío. Un
// «gracias» solo queda igual (no se contesta).
func sinAgradecimiento(texto string) string {
	loc := reAgradecimiento.FindStringIndex(texto)
	if loc == nil || loc[1] == 0 {
		return texto
	}
	resto := strings.TrimSpace(texto[loc[1]:])
	if len(asistente.Normalizar(resto)) < 3 {
		return texto
	}
	return resto
}

// rePersona: pidió hablar con alguien. Gana sobre todo lo demás: «quiero
// hablar con una persona por un mueble a medida» no es la pregunta por el
// corte, y «persona, es un reclamo» es la persona.
var rePersona = regexp.MustCompile(`\b(persona|personas|humano|humana|hablar con|con alguien|hay alguien|asesor|asesora|atencion al cliente|vendedor|vendedora|que me llamen|llamame|llamenme)\b`)

func pideUnaPersona(texto string) bool {
	return rePersona.MatchString(asistente.Corregir(asistente.Normalizar(texto)))
}

// Un reclamo o una pregunta sobre su cuenta: no hay respuesta automática que
// sirva, y contestar el catálogo («Esto tenemos: Deck…») a quien le faltó una
// tabla es peor que no contestar. Pasa a una persona con el porqué.
var (
	reReclamo = regexp.MustCompile(`\b(reclamo|reclamar|queja|quejarme|me falto|me faltaron|faltaron|falto una|falto un|faltante|faltan|vino roto|vino rota|vinieron rotos|vinieron rotas|llego roto|llego rota|vino fallado|vino fallada|vino mal|me cobraron|cobraron de mas|cobraron mal|no me llego|nunca llego|no llego)\b`)
	reCuenta  = regexp.MustCompile(`\b(cheque|cheques|echeq|echeqs|e cheq|rechazaron|rechazado|rechazada|mi cuenta|mi saldo|cuanto debo|lo que debo|deuda|estado de cuenta|resumen de cuenta|mail raro|correo raro|nota de credito|factura mal)\b`)
)

// motivoDePersona dice por qué un texto va derecho a una persona, o vacío.
func motivoDePersona(texto string) string {
	t := asistente.Corregir(asistente.Normalizar(texto))
	switch {
	case reReclamo.MatchString(t):
		return "Es un reclamo."
	case reCuenta.MatchString(t):
		return "Pregunta por su cuenta o un cheque."
	}
	return ""
}

// reTokenDeCorte es el enlace de un corte armado en el sitio (/corte/c/…).
var reTokenDeCorte = regexp.MustCompile(`/corte/c/([a-z2-7]{8,40})\b`)

// tokenDeCorteEnTexto es el token del corte que mandó, si mandó el enlace.
func tokenDeCorteEnTexto(texto string) string {
	if g := reTokenDeCorte.FindStringSubmatch(strings.ToLower(texto)); g != nil {
		return g[1]
	}
	return ""
}

// reLugar es el lugar de «hacen envíos a Batán?», «llegan hasta Sierra de
// los Padres?». Dos palabras como mucho, y nunca «domicilio» ni «la obra».
var reLugar = regexp.MustCompile(`\b(?:a|hasta|para|en)\s+([a-z]{3,}(?:\s+[a-z]{2,}){0,3}?)\s*(?:$|,|\.|\bcuanto\b|\bque\b|\by\b|\bsale\b)`)

var noSonLugares = map[string]bool{
	"domicilio": true, "casa": true, "obra": true, "la obra": true, "zona": true, "la zona": true, "mi casa": true,
	"cuanto": true, "que": true, "todo": true, "toda": true, "partir": true, "tiempo": true, "cuantos": true,
}

// lugarDeEnvio es el lugar por el que pregunta, normalizado, o vacío.
func lugarDeEnvio(texto string) string {
	t := asistente.Corregir(asistente.Normalizar(texto))
	for _, g := range reLugar.FindAllStringSubmatch(t, -1) {
		l := strings.TrimSpace(g[1])
		if !noSonLugares[l] && !noSonLugares[strings.Fields(l)[0]] {
			return l
		}
	}
	return ""
}

// zonaDeEnvio busca el lugar entre las zonas («• Mar del Plata — Coordinamos
// al confirmar»): devuelve la línea de la zona, o vacío.
func zonaDeEnvio(lugar string, envios []string) string {
	for _, linea := range envios {
		nombre := strings.TrimPrefix(linea, "• ")
		if i := strings.Index(nombre, " — "); i >= 0 {
			nombre = nombre[:i]
		}
		n := asistente.Normalizar(nombre)
		if n != "" && (strings.Contains(n, lugar) || strings.Contains(lugar, n)) {
			return linea
		}
	}
	return ""
}

// reDia es el día por el que preguntan el horario.
var reDia = regexp.MustCompile(`\b(domingo|domingos|sabado|sabados|feriado|feriados|lunes|martes|miercoles|jueves|viernes)\b`)

// respuestaDelDia es la primera línea de la respuesta al horario cuando
// preguntaron por un día: «El domingo cerramos.» El horario es el de las dos
// sucursales (abierto(), en bot.go).
func respuestaDelDia(texto string) string {
	g := reDia.FindStringSubmatch(asistente.Normalizar(texto))
	if g == nil {
		return ""
	}
	switch strings.TrimSuffix(g[1], "s") {
	case "domingo":
		return "El domingo cerramos."
	case "feriado":
		return "Los feriados cerramos."
	case "sabado":
		return "El sábado abrimos de 8 a 12."
	}
	return "De lunes a viernes abrimos de 8 a 16."
}

// sucursalNombrada es la sucursal por la que preguntan («¿dónde queda el
// aserradero?»), si nombran una.
func sucursalNombrada(texto string) *Sucursal {
	t := asistente.Normalizar(texto)
	for i := range Sucursales {
		n := asistente.Normalizar(Sucursales[i].Nombre)
		if strings.Contains(t, n) || (Sucursales[i].Slug == "casa-central" && strings.Contains(t, "central")) {
			return &Sucursales[i]
		}
	}
	return nil
}

// reCortado: lo quieren cortado. El bot agrega el armador de cortes a la
// respuesta del catálogo.
var reCortado = regexp.MustCompile(`\b(cortad[oa]s?|cortar|cortame|cortarla|cortarlas|a medida|en piezas)\b`)

func pideCortado(texto string) bool { return reCortado.MatchString(asistente.Normalizar(texto)) }

// reSeparador parte «2 placas de melamina blanca 18 y 6 bisagras» en los
// renglones del pedido.
var reSeparador = regexp.MustCompile(`\s*(?:,|;|\by\b|\bmas\b|\+)\s*`)

// renglonesDelPedido son las partes de un pedido de varios productos: cada
// una nombra un rubro distinto («melamina» y «bisagras»). Con una sola, nil.
func renglonesDelPedido(texto string) []string {
	t := asistente.Corregir(asistente.Normalizar(texto))
	var out []string
	vistos := map[string]bool{}
	for _, parte := range reSeparador.Split(t, -1) {
		e := asistente.Entender(parte)
		if e.Rubro == "" || vistos[e.Rubro] {
			continue
		}
		vistos[e.Rubro] = true
		out = append(out, strings.TrimSpace(parte))
	}
	if len(out) < 2 {
		return nil
	}
	return out
}

// mismaPalabra: igual, o una es el plural de la otra («tirantes» y
// «tirante», «tablones» y «tablon»).
func mismaPalabra(a, b string) bool {
	if a == b {
		return true
	}
	if len(a) < len(b) {
		a, b = b, a
	}
	return a == b+"s" || a == b+"es"
}

// rankearProductos ordena lo que trajo el catálogo por cuántas palabras de la
// consulta tiene el nombre, y deja solo los que más tienen: a «melamina
// blanca de 18» le contesta la Melamina Blanca, no el Fenólico que viene
// antes por orden alfabético. Con un solo ganador, se suman los del mismo
// tipo (la primera palabra del nombre: «Tirante»), que son la alternativa.
// Si ninguno nombra nada de la consulta, vuelven como estaban.
func rankearProductos(ps []ProductoBot, consulta string) []ProductoBot {
	var palabras []string
	for _, w := range strings.Fields(asistente.Normalizar(consulta)) {
		if len(w) > 2 {
			palabras = append(palabras, w)
		}
	}
	if len(palabras) == 0 || len(ps) < 2 {
		return ps
	}
	puntaje := func(p ProductoBot) int {
		nombre := strings.Fields(asistente.Normalizar(p.Nombre))
		n := 0
		for _, w := range palabras {
			for _, x := range nombre {
				if mismaPalabra(x, w) {
					n++
					break
				}
			}
		}
		return n
	}
	type conPuntaje struct {
		p ProductoBot
		n int
	}
	cs := make([]conPuntaje, len(ps))
	mejor := 0
	for i, p := range ps {
		cs[i] = conPuntaje{p, puntaje(p)}
		mejor = max(mejor, cs[i].n)
	}
	if mejor == 0 {
		return ps
	}
	sort.SliceStable(cs, func(a, b int) bool { return cs[a].n > cs[b].n })
	var ganadores []ProductoBot
	for _, c := range cs {
		if c.n == mejor {
			ganadores = append(ganadores, c.p)
		}
	}
	if len(ganadores) == 1 {
		tipo := primeraPalabra(ganadores[0].Nombre)
		for _, c := range cs {
			if c.n > 0 && c.n < mejor && primeraPalabra(c.p.Nombre) == tipo {
				ganadores = append(ganadores, c.p)
			}
		}
	}
	return ganadores
}

func primeraPalabra(nombre string) string {
	f := strings.Fields(asistente.Normalizar(nombre))
	if len(f) == 0 {
		return ""
	}
	return strings.TrimSuffix(f[0], "s")
}
