package correo

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/emersion/go-imap/v2"
)

// Las etiquetas («Presupuesto», «Pedido abierto») son palabras clave de
// IMAP: viven en el servidor, junto al mensaje, y las ve cualquier programa
// que entre a la casilla. Una palabra clave es un átomo ASCII sin espacios,
// así que el nombre se guarda codificado: el espacio como «_» y lo que no es
// ASCII (las tildes, la ñ) como «&<hexadecimal>-». «Pedido abierto» es
// `Pedido_abierto` y «Reclamación» es `Reclamaci&f3-n`.
//
// Las palabras clave del sistema y las que ponen otros programas
// ($Forwarded, $MDNSent, NonJunk…) empiezan con «$» o son conocidas: no se
// muestran como etiquetas.

const largoEtiqueta = 40

var palabrasAjenas = map[string]bool{
	"nonjunk": true, "junk": true, "notjunk": true, "$junk": true, "$notjunk": true,
	"$forwarded": true, "$mdnsent": true, "$label1": true, "$label2": true,
	"$label3": true, "$label4": true, "$label5": true, "$phishing": true,
}

// palabraClave codifica el nombre de una etiqueta. Falso si está vacío o es
// muy largo.
func palabraClave(nombre string) (imap.Flag, bool) {
	nombre = strings.Join(strings.Fields(nombre), " ")
	if nombre == "" || utf8.RuneCountInString(nombre) > largoEtiqueta {
		return "", false
	}
	var b strings.Builder
	for _, r := range nombre {
		switch {
		case r == ' ':
			b.WriteByte('_')
		case r < 0x80 && esAtomo(byte(r)) && r != '_' && r != '&' && r != '$':
			b.WriteRune(r)
		default:
			fmt.Fprintf(&b, "&%x-", r)
		}
	}
	return imap.Flag(b.String()), true
}

func esAtomo(c byte) bool {
	if c <= 0x20 || c >= 0x7f {
		return false
	}
	return !strings.ContainsRune(`(){%*"\]`, rune(c))
}

// etiquetaDe decodifica una palabra clave; falso si no es una etiqueta.
func etiquetaDe(f imap.Flag) (string, bool) {
	s := string(f)
	if s == "" || strings.HasPrefix(s, `\`) || strings.HasPrefix(s, "$") || palabrasAjenas[strings.ToLower(s)] {
		return "", false
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		switch c := s[i]; c {
		case '_':
			b.WriteByte(' ')
		case '&':
			fin := strings.IndexByte(s[i:], '-')
			if fin < 0 {
				b.WriteByte(c)
				continue
			}
			n, err := strconv.ParseUint(s[i+1:i+fin], 16, 32)
			if err != nil {
				b.WriteByte(c)
				continue
			}
			b.WriteRune(rune(n))
			i += fin
		default:
			b.WriteByte(c)
		}
	}
	return b.String(), true
}
