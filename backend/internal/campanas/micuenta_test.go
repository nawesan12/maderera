package campanas

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestMisNovedades(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	if _, err := e.ses.AltaDeCliente(ctx, "web@prueba.test", "una clave larga", "Cliente Web"); err != nil {
		t.Fatal(err)
	}
	// La ficha tiene otra dirección: la baja va a las dos.
	if _, err := e.pool.Exec(ctx, `update customers set email = 'ficha@prueba.test' where user_id is not null`); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	if _, err := e.ses.Entrar(ctx, w, "web@prueba.test", "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	u, _ := url.Parse(e.srv.URL)
	jar.SetCookies(u, w.Result().Cookies())
	c := &http.Client{Jar: jar}
	if st, p := pedir(t, c, "GET", e.srv.URL+"/api/v1/mi-cuenta/novedades", nil); st != 200 || p["recibe"] != true {
		t.Fatalf("antes: %d %v", st, p)
	}
	if st, p := pedir(t, c, "PUT", e.srv.URL+"/api/v1/mi-cuenta/novedades", map[string]bool{"recibir": false}); st != 200 || p["ok"] != "No te vamos a mandar más novedades." {
		t.Fatalf("baja: %d %v", st, p)
	}
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from bajas_de_correo where origen = 'cuenta'`).Scan(&n)
	if n != 2 {
		t.Fatalf("bajas: %d", n)
	}
	if _, p := pedir(t, c, "GET", e.srv.URL+"/api/v1/mi-cuenta/novedades", nil); p["recibe"] != false {
		t.Fatalf("después: %v", p)
	}
	if st, _ := pedir(t, &http.Client{}, "GET", e.srv.URL+"/api/v1/mi-cuenta/novedades", nil); st != 401 {
		t.Fatalf("sin sesión: %d", st)
	}
}
