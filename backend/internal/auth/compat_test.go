package auth

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// golden es lo que guardó scripts/golden/auth.ts corriendo better-auth.
type golden struct {
	Secreto string `json:"secreto"`
	Hashes  []struct {
		Clave string `json:"clave"`
		Hash  string `json:"hash"`
	} `json:"hashes"`
	Firmas []struct {
		Valor   string `json:"valor"`
		Firmado string `json:"firmado"`
	} `json:"firmas"`
	HTTP  caso `json:"http"`
	HTTPS caso `json:"https"`
}

type caso struct {
	BaseURL        string           `json:"baseURL"`
	Email          string           `json:"email"`
	Clave          string           `json:"clave"`
	UserID         string           `json:"userId"`
	CookiesAlta    []string         `json:"cookiesAlta"`
	CookiesEntrada []string         `json:"cookiesEntrada"`
	User           []map[string]any `json:"user"`
	Account        []map[string]any `json:"account"`
	Session        []map[string]any `json:"session"`
	Profiles       []map[string]any `json:"profiles"`
}

func leerGolden(t *testing.T) golden {
	t.Helper()
	crudo, err := os.ReadFile("../../testdata/golden/auth/better-auth.json")
	if err != nil {
		t.Fatal(err)
	}
	var g golden
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func TestFirmaComoBetterCall(t *testing.T) {
	g := leerGolden(t)
	for _, f := range g.Firmas {
		if got := firmar(f.Valor, g.Secreto); got != f.Firmado {
			t.Errorf("firmar(%q) = %q, better-call da %q", f.Valor, got, f.Firmado)
		}
		v, ok := leerFirmado(f.Firmado, g.Secreto)
		if !ok || v != f.Valor {
			t.Errorf("leerFirmado(%q) = %q %v", f.Firmado, v, ok)
		}
		if _, ok := leerFirmado(f.Firmado, g.Secreto+"x"); ok {
			t.Errorf("aceptó una firma con otro secreto")
		}
	}
}

func TestCookiesDeBetterAuth(t *testing.T) {
	g := leerGolden(t)
	for _, c := range []caso{g.HTTP, g.HTTPS} {
		for _, set := range append(c.CookiesAlta, c.CookiesEntrada...) {
			nombre, resto, _ := strings.Cut(set, "=")
			if !strings.HasSuffix(nombre, nombreCookie) {
				continue
			}
			valor, _, _ := strings.Cut(resto, ";")
			token, ok := leerFirmado(valor, g.Secreto)
			if !ok || len(token) != largoDeIDs {
				t.Fatalf("%s: la cookie %q no se pudo leer", c.BaseURL, valor)
			}
			seguro := strings.HasPrefix(c.BaseURL, "https")
			if strings.HasPrefix(nombre, prefijoSeguro) != seguro {
				t.Errorf("%s: el prefijo __Secure- no coincide: %q", c.BaseURL, nombre)
			}
			for _, attr := range []string{"Max-Age=2592000", "Path=/", "HttpOnly", "SameSite=Lax"} {
				if !strings.Contains(set, attr) {
					t.Errorf("%s: la cookie de better-auth no tiene %s (¿cambió la versión?): %s", c.BaseURL, attr, set)
				}
			}
		}
	}
}

func TestClavesComoBetterAuth(t *testing.T) {
	g := leerGolden(t)
	for _, h := range g.Hashes {
		ok, err := verificarClave(h.Hash, h.Clave)
		if err != nil || !ok {
			t.Errorf("la clave %q no verificó contra el hash de better-auth (%v)", h.Clave, err)
		}
		if ok, _ := verificarClave(h.Hash, h.Clave+"x"); ok {
			t.Errorf("verificó una clave equivocada")
		}
	}
	// NFKC: «é» precompuesta y «e» + acento combinado son la misma clave.
	for _, h := range g.Hashes {
		if h.Clave == "café" {
			if ok, _ := verificarClave(h.Hash, "café"); !ok {
				t.Error("la normalización NFKC no coincide con la de better-auth")
			}
		}
	}
	// Y lo que hashea Go, lo verifica Go (better-auth lo verifica igual: mismo
	// formato y mismos parámetros).
	hash, err := hashearClave("una clave nueva")
	if err != nil {
		t.Fatal(err)
	}
	if ok, _ := verificarClave(hash, "una clave nueva"); !ok {
		t.Error("ida y vuelta de hashearClave falló")
	}
	if sal, k, _ := strings.Cut(hash, ":"); len(sal) != 32 || len(k) != 128 {
		t.Errorf("formato del hash: %q", hash)
	}
}

func TestCodificarComoEncodeURIComponent(t *testing.T) {
	casos := map[string]string{
		"abc.DEF-123_~!*'()": "abc.DEF-123_~!*'()",
		"a+b/c=":             "a%2Bb%2Fc%3D",
		"ñ espacio":          "%C3%B1%20espacio",
	}
	for in, want := range casos {
		if got := codificarComponente(in); got != want {
			t.Errorf("codificarComponente(%q) = %q, JS da %q", in, got, want)
		}
	}
}

func TestNuevoID(t *testing.T) {
	vistos := map[string]bool{}
	for i := 0; i < 1000; i++ {
		id := nuevoID()
		if len(id) != 32 || strings.Trim(id, caracteresDeIDs) != "" || vistos[id] {
			t.Fatalf("id inválido o repetido: %q", id)
		}
		vistos[id] = true
	}
}
