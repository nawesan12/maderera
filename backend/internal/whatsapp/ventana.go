package whatsapp

import (
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// La ventana de 24 horas (lib/whatsapp/ventana.ts): desde el último mensaje
// del cliente hay 24 h para contestarle lo que sea; pasado eso, solo una
// plantilla aprobada. Solo un mensaje del cliente la abre: los ecos del
// teléfono no la tocan.

// VentanaMs es la ventana en milisegundos.
const VentanaMs = 24 * 3_600_000

// ms es el instante en milisegundos, como un Date de JS.
func ms(t time.Time) int64 { return t.UnixMilli() }

// VentanaAbierta dice si todavía se puede contestar con mensaje libre.
func VentanaAbierta(ultimoEntrante *time.Time, ahora time.Time) bool {
	if ultimoEntrante == nil {
		return false
	}
	pasado := ms(ahora) - ms(*ultimoEntrante)
	if pasado >= 0 {
		return pasado < VentanaMs
	}
	return true
}

// CierreDeVentana es cuándo se cierra, o nil si ya está cerrada.
func CierreDeVentana(ultimoEntrante *time.Time, ahora time.Time) *time.Time {
	if !VentanaAbierta(ultimoEntrante, ahora) {
		return nil
	}
	c := time.UnixMilli(ms(*ultimoEntrante) + VentanaMs).UTC()
	return &c
}

// RestanteLegible es lo que queda de ventana: «3 h», «40 min»; "" si cerró.
func RestanteLegible(ultimoEntrante *time.Time, ahora time.Time) string {
	c := CierreDeVentana(ultimoEntrante, ahora)
	if c == nil {
		return ""
	}
	resta := ms(*c) - ms(ahora)
	minutos := max(floorDiv(resta, 60_000), 0)
	if minutos < 60 {
		return strconv.FormatInt(minutos, 10) + " min"
	}
	return strconv.FormatInt(minutos/60, 10) + " h"
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// Decision es cómo sale un aviso automático: «texto», «plantilla» u
// «omitir» (con Motivo «baja», «sin-plantilla» o «apagado»).
type Decision struct {
	Como   string `json:"como"`
	Motivo string `json:"motivo,omitempty"`
}

// DecidirEnvio es decidirEnvio.
func DecidirEnvio(activo, baja, ventanaAbierta, hayTextoLibre, hayPlantilla bool) Decision {
	switch {
	case !activo:
		return Decision{"omitir", "apagado"}
	case baja:
		return Decision{"omitir", "baja"}
	case ventanaAbierta && hayTextoLibre:
		return Decision{Como: "texto"}
	case hayPlantilla:
		return Decision{Como: "plantilla"}
	}
	return Decision{"omitir", "sin-plantilla"}
}

var (
	reNoLetra      = regexp.MustCompile(`[^a-z0-9ñ ]+`)
	reEspaciosJS   = regexp.MustCompile(`[` + claseEspacioJS + `]+`)
	reAlta         = regexp.MustCompile(`^(alta|start|darme de alta|quiero recibir (los )?avisos)$`)
	patronesDeBaja = []*regexp.Regexp{
		regexp.MustCompile(`^(baja|stop|parar|basta|cancelar suscripcion|desuscribir(me)?)$`),
		regexp.MustCompile(`^(dar(me)? de baja|darse de baja|quiero (darme de )?baja|quiero la baja|baja por favor|por favor baja)$`),
		regexp.MustCompile(`^no (me )?(manden|envien|escriban|mandes|envies|escribas) mas( (avisos|mensajes|nada))?( por favor)?$`),
		regexp.MustCompile(`^no quiero (recibir )?mas (avisos|mensajes)( por favor)?$`),
	}
)

// normalizar: sin tildes, en minúsculas, solo letras y números.
func normalizar(texto string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(texto) {
		if r >= 0x300 && r <= 0x36f {
			continue
		}
		b.WriteRune(unicode.ToLower(r))
	}
	s := reNoLetra.ReplaceAllString(b.String(), " ")
	s = reEspaciosJS.ReplaceAllString(s, " ")
	return trimJS(s)
}

// EsPedidoDeBaja: «BAJA», «STOP», «no me manden más»… y nada más que eso.
func EsPedidoDeBaja(texto string) bool {
	limpio := normalizar(texto)
	if limpio == "" || largoJS(limpio) > 40 {
		return false
	}
	for _, p := range patronesDeBaja {
		if p.MatchString(limpio) {
			return true
		}
	}
	return false
}

// reBajaEnFrase: la baja dicha dentro de una frase («Hola, no quiero recibir
// más mensajes de ustedes. BAJA»). EsPedidoDeBaja es la del TS y pide el
// mensaje solo; el WhatsApp también toma estas (M3S4-010).
var (
	reBajaMayuscula = regexp.MustCompile(`(^|[^\p{L}])(BAJA|STOP)([^\p{L}]|$)`)
	reBajaEnFrase   = regexp.MustCompile(`\b(no (quiero|deseo) (recibir|que me (manden|envien|escriban)) mas (mensajes|avisos|nada)|no (me )?(manden|envien|escriban) mas (mensajes|avisos)|(darme|dame|denme) de baja de (los |sus )?(mensajes|avisos|whatsapp))\b`)
)

// PideLaBaja es EsPedidoDeBaja más la baja dentro de una frase: la palabra
// BAJA o STOP en mayúsculas, o «no quiero recibir más mensajes». «¿Me das de
// baja el pedido de ayer?» sigue sin ser una baja.
func PideLaBaja(texto string) bool {
	if EsPedidoDeBaja(texto) {
		return true
	}
	return reBajaMayuscula.MatchString(texto) || reBajaEnFrase.MatchString(normalizar(texto))
}

// EsPedidoDeAlta: «ALTA» vuelve a habilitar los avisos.
func EsPedidoDeAlta(texto string) bool { return reAlta.MatchString(normalizar(texto)) }
