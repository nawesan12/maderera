package formato

import "strings"

// Telefono escribe un teléfono argentino como lo escribe la gente y como
// están las fichas viejas: «223 555-0483» (M3S1-069, M2S3-071). Toma lo que
// sea solo dígitos —tipeado de corrido, «2235550483», o el número de
// WhatsApp, «5492235550483»— con diez dígitos nacionales; el área es de tres
// dígitos, o «11» para Buenos Aires (la misma regla que NumeroLegible del
// WhatsApp). Lo que ya trae espacios, guiones o paréntesis, o no tiene esa
// forma, queda como vino: ya lo escribió alguien a propósito.
func Telefono(t string) string {
	t = strings.TrimSpace(t)
	d := strings.TrimPrefix(t, "+")
	for _, r := range d {
		if r < '0' || r > '9' {
			return t
		}
	}
	switch {
	case len(d) == 13 && strings.HasPrefix(d, "549"):
		d = d[3:]
	case len(d) == 12 && strings.HasPrefix(d, "54"):
		d = d[2:]
	case len(d) == 11 && strings.HasPrefix(d, "0"):
		d = d[1:]
	}
	if len(d) != 10 {
		return t
	}
	area := d[:3]
	if strings.HasPrefix(d, "11") {
		area = d[:2]
	}
	abonado := d[len(area):]
	return area + " " + abonado[:len(abonado)-4] + "-" + abonado[len(abonado)-4:]
}
