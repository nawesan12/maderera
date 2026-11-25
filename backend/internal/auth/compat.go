// Package auth es la sesión de la plataforma: entrar, registrarse, salir y
// saber quién pide.
//
// **Es compatible con better-auth 1.7, a propósito.** Hasta la mudanza, la
// sesión la manejaba better-auth desde Next; acá se leen y se escriben las
// mismas tablas (user, account, session, profiles), la misma cookie y el
// mismo hash de clave. Así nadie tiene que volver a entrar ni cambiar la
// clave el día que Go toma la sesión, y durante la mudanza Next y Go pueden
// leer la misma cookie. Cada detalle está comprobado contra lo que hace
// better-auth de verdad: ver testdata/golden/auth y scripts/golden/auth.ts.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"

	"golang.org/x/crypto/scrypt"
	"golang.org/x/text/unicode/norm"
)

// --- la cookie ---

const (
	nombreCookie     = "better-auth.session_token"
	nombreNoRecordar = "better-auth.dont_remember"
	prefijoSeguro    = "__Secure-"
	largoFirmaBase64 = 44 // 32 bytes de HMAC-SHA256 en base64, con un '='
	caracteresDeIDs  = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	largoDeIDs       = 32
)

// firmar es signCookieValue de better-call: `valor.firma`, con la firma
// HMAC-SHA256 en base64 estándar, y todo pasado por encodeURIComponent.
func firmar(valor, secreto string) string {
	return codificarComponente(valor + "." + firma(valor, secreto))
}

func firma(valor, secreto string) string {
	m := hmac.New(sha256.New, []byte(secreto))
	m.Write([]byte(valor))
	return base64.StdEncoding.EncodeToString(m.Sum(nil))
}

// leerFirmado es getSignedCookie de better-call: separa en el último punto,
// exige una firma de 44 caracteres terminada en '=' y la compara en tiempo
// constante. Devuelve el valor si la firma es buena.
func leerFirmado(crudo, secreto string) (string, bool) {
	v, err := url.PathUnescape(crudo)
	if err != nil {
		return "", false
	}
	i := strings.LastIndexByte(v, '.')
	if i < 1 {
		return "", false
	}
	valor, f := v[:i], v[i+1:]
	if len(f) != largoFirmaBase64 || !strings.HasSuffix(f, "=") {
		return "", false
	}
	esperada := firma(valor, secreto)
	if subtle.ConstantTimeCompare([]byte(f), []byte(esperada)) != 1 {
		return "", false
	}
	return valor, true
}

// codificarComponente es encodeURIComponent de JS: deja sin tocar letras,
// números y - _ . ! ~ * ' ( ), y codifica todo lo demás en UTF-8 con %XX.
// url.QueryEscape no sirve: cambia el espacio por '+' y codifica '!' y '*'.
func codificarComponente(s string) string {
	const libres = "-_.!~*'()"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.IndexByte(libres, c) >= 0 {
			b.WriteByte(c)
			continue
		}
		b.WriteString("%" + strings.ToUpper(hex.EncodeToString([]byte{c})))
	}
	return b.String()
}

// nuevoID es generateId(32) de better-auth: 32 caracteres de a-z, A-Z y 0-9,
// sin sesgo (se descarta el byte que no entra parejo en 62).
func nuevoID() string {
	out := make([]byte, 0, largoDeIDs)
	var buf [64]byte
	for len(out) < largoDeIDs {
		if _, err := rand.Read(buf[:]); err != nil {
			panic(err) // sin azar del sistema no hay nada seguro que hacer
		}
		for _, b := range buf {
			if b >= 248 { // 248 = 62*4: lo que queda arriba sesgaría
				continue
			}
			out = append(out, caracteresDeIDs[b%62])
			if len(out) == largoDeIDs {
				break
			}
		}
	}
	return string(out)
}

// --- la clave ---

// Los parámetros de scrypt de better-auth (@better-auth/utils/password).
const (
	scryptN     = 16384
	scryptR     = 16
	scryptP     = 1
	scryptLargo = 64
)

// Cada hash usa 16 MB y un núcleo un rato: sin tope, cien intentos de entrar a
// la vez se comen la VPS. Dos a la vez es lo que tiene de núcleos.
var turnoScrypt = make(chan struct{}, 2)

func derivar(clave, sal string) ([]byte, error) {
	turnoScrypt <- struct{}{}
	defer func() { <-turnoScrypt }()
	// La sal es el texto hex tal cual, no los bytes que representa: así la
	// pasa better-auth a node:crypto.scrypt.
	return scrypt.Key([]byte(norm.NFKC.String(clave)), []byte(sal), scryptN, scryptR, scryptP, scryptLargo)
}

// hashearClave es hashPassword de better-auth: `sal:clave`, las dos en hex.
func hashearClave(clave string) (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	sal := hex.EncodeToString(b[:])
	k, err := derivar(clave, sal)
	if err != nil {
		return "", err
	}
	return sal + ":" + hex.EncodeToString(k), nil
}

var errHashInvalido = errors.New("hash de clave inválido")

// verificarClave es verifyPassword de better-auth, con la comparación en
// tiempo constante (better-auth compara strings, que no lo es).
func verificarClave(hash, clave string) (bool, error) {
	sal, esperado, ok := strings.Cut(hash, ":")
	if !ok || sal == "" || esperado == "" {
		return false, errHashInvalido
	}
	k, err := derivar(clave, sal)
	if err != nil {
		return false, err
	}
	return subtle.ConstantTimeCompare([]byte(hex.EncodeToString(k)), []byte(esperado)) == 1, nil
}

// Un hash de verdad para gastar el mismo tiempo cuando el correo no existe:
// si no, lo rápido de la respuesta dice qué correos tienen cuenta.
const hashDeRelleno = "8f3c5a1e9b2d4f6a7c8e0b1d3f5a7c9e:" +
	"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
