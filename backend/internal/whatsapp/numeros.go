package whatsapp

import (
	"regexp"
	"strings"
)

// Los números de teléfono, de como los tipea la gente a como los quiere
// WhatsApp (lib/whatsapp/numeros.ts). Una sola forma canónica: el número
// nacional de diez dígitos (`2235903118`); de ahí sale el `wa_id` (`549` +
// nacional) y contra eso se compara con las fichas. Ver el TS para el
// problema del 9.

// CaracteristicaLocal es la que se asume si el número viene sin ella: Mar del Plata.
const CaracteristicaLocal = "223"

// SoloDigitos es `replace(/\D/g, "")`.
func SoloDigitos(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

// sinQuince saca el 15 de celular que va entre la característica y el abonado.
func sinQuince(d string) string {
	if len(d) != 12 {
		return d
	}
	for _, largo := range []int{2, 3, 4} {
		if d[largo:largo+2] == "15" {
			return d[:largo] + d[largo+2:]
		}
	}
	return d
}

// NumeroNacional es el número nacional de diez dígitos, o "" si no es un
// número argentino reconocible.
func NumeroNacional(telefono string) string { return numeroNacional(telefono, CaracteristicaLocal) }

func numeroNacional(telefono, caracteristica string) string {
	crudo := trimJS(telefono)
	d := SoloDigitos(crudo)
	if len(d) < 6 {
		return ""
	}
	if strings.HasPrefix(d, "0054") {
		d = d[2:]
	}
	conPais := strings.HasPrefix(crudo, "+") || strings.HasPrefix(d, "54")
	if conPais {
		if !strings.HasPrefix(d, "54") {
			return ""
		}
		d = d[2:]
		if len(d) == 11 && d[0] == '9' {
			d = d[1:]
		}
		if len(d) == 11 && d[0] == '0' {
			d = d[1:]
		}
		d = sinQuince(d)
		if len(d) == 10 {
			return d
		}
		return ""
	}
	if strings.HasPrefix(d, "0") {
		d = d[1:]
	}
	d = sinQuince(d)
	if len(d) == 9 && strings.HasPrefix(d, "15") {
		d = d[2:]
	}
	if len(d) == 6 || len(d) == 7 || len(d) == 8 {
		completo := caracteristica + d
		if len(completo) == 10 {
			return completo
		}
		return ""
	}
	if len(d) == 10 {
		return d
	}
	return ""
}

// AWaId es el identificador de WhatsApp de un número, o "" si no se entiende.
func AWaId(telefono string) string {
	if n := NumeroNacional(telefono); n != "" {
		return "549" + n
	}
	crudo := trimJS(telefono)
	d := SoloDigitos(crudo)
	if (strings.HasPrefix(crudo, "+") || strings.HasPrefix(crudo, "00")) && !strings.HasPrefix(d, "54") {
		sinCeros := strings.TrimPrefix(d, "00")
		if len(sinCeros) >= 8 && len(sinCeros) <= 15 {
			return sinCeros
		}
	}
	return ""
}

// WaIdDeMeta lleva lo que llega de Meta (`wa_id`, `from`) a la forma canónica.
func WaIdDeMeta(waID string) string {
	d := SoloDigitos(waID)
	if strings.HasPrefix(d, "54") {
		if w := AWaId("+" + d); w != "" {
			return w
		}
	}
	return d
}

// JidDeWaId es la clave de la conversación: «5492235903118@s.whatsapp.net».
func JidDeWaId(waID string) string { return WaIdDeMeta(waID) + "@s.whatsapp.net" }

// WaIdDeJid son los dígitos de la clave.
func WaIdDeJid(jid string) string {
	antes, _, _ := strings.Cut(jid, "@")
	return SoloDigitos(antes)
}

// MismoNumero dice si dos teléfonos, escritos como sea, son el mismo número.
func MismoNumero(a, b string) bool {
	na, nb := NumeroNacional(a), NumeroNacional(b)
	if na != "" && nb != "" {
		return na == nb
	}
	return SoloDigitos(a) != "" && SoloDigitos(a) == SoloDigitos(b)
}

// NumeroLegible es «+54 9 223 590-3118».
func NumeroLegible(waIDOJid string) string {
	d := WaIdDeJid(waIDOJid)
	nacional := ""
	if strings.HasPrefix(d, "54") {
		nacional = NumeroNacional("+" + d)
	}
	if nacional == "" {
		if d != "" {
			return "+" + d
		}
		return waIDOJid
	}
	area := nacional[:3]
	if strings.HasPrefix(nacional, "11") {
		area = nacional[:2]
	}
	abonado := nacional[len(area):]
	return "+54 9 " + area + " " + abonado[:len(abonado)-4] + "-" + abonado[len(abonado)-4:]
}

const prefijoBsuid = "bsuid:"

var reBsuid = regexp.MustCompile(`^[A-Z]{2}\.[A-Za-z0-9]{1,128}$`)

// EsBsuid dice si es un BSUID de Meta («AR.1A2B…»).
func EsBsuid(v string) bool { return reBsuid.MatchString(v) }

// JidDeBsuid es la clave de la conversación de alguien que llegó sin número.
func JidDeBsuid(b string) string { return prefijoBsuid + b }

// DestinoDeJid es a quién se le manda: el `wa_id` o el BSUID.
func DestinoDeJid(jid string) string {
	if strings.HasPrefix(jid, prefijoBsuid) {
		return jid[len(prefijoBsuid):]
	}
	return WaIdDeJid(jid)
}

// SinNumero dice si la conversación es de alguien sin teléfono conocido.
func SinNumero(jid string) bool { return strings.HasPrefix(jid, prefijoBsuid) }

// AJid pasa un teléfono tipeado a mano a la clave de la bandeja, o "".
func AJid(telefono string) string {
	if w := AWaId(telefono); w != "" {
		return w + "@s.whatsapp.net"
	}
	return ""
}
