package contenido

import (
	"net/http"
	"strings"
	"testing"
)

// H211 (mes simulado): sin correo conectado, la página dejaba escribir
// todo y recién al enviar decía que no iba a llegar. Ahora lo sabe antes.
func TestEstadoDelContacto(t *testing.T) {
	e := armar(t)
	u := e.srv.URL + "/api/v1/contenido/contacto"
	if c, b := pedir(t, &http.Client{}, "GET", u, nil); c != 200 || !strings.Contains(string(b), `"correo":true`) {
		t.Errorf("con correo: %d %s", c, b)
	}
	e.correo.Simular = true
	if _, b := pedir(t, &http.Client{}, "GET", u, nil); !strings.Contains(string(b), `"correo":false`) {
		t.Errorf("sin correo: %s", b)
	}
}
