package whatsapp

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

// FirmaValida valida `X-Hub-Signature-256: sha256=<hmac>` contra el secreto
// de la app (lib/whatsapp/firma.ts). Sin secreto o sin cabecera, no: el
// webhook es público y escribe en la base. Se calcula sobre los bytes crudos
// del cuerpo, y la comparación es de tiempo constante.
func FirmaValida(cuerpo []byte, cabecera, secreto string) bool {
	if secreto == "" || cabecera == "" || !strings.HasPrefix(cabecera, "sha256=") {
		return false
	}
	recibida := []byte(strings.ToLower(trimJS(cabecera[len("sha256="):])))
	calculada := []byte(firmaHex(cuerpo, secreto))
	if len(recibida) != len(calculada) {
		return false
	}
	return subtle.ConstantTimeCompare(recibida, calculada) == 1
}

// Firmar es la cabecera que pondría Meta (para el simulador y las pruebas).
func Firmar(cuerpo []byte, secreto string) string { return "sha256=" + firmaHex(cuerpo, secreto) }

func firmaHex(cuerpo []byte, secreto string) string {
	m := hmac.New(sha256.New, []byte(secreto))
	m.Write(cuerpo)
	return hex.EncodeToString(m.Sum(nil))
}
