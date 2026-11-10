package catalogo

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"mjbj/internal/pruebas"
)

// Con la tienda apagada (la primera entrega) ninguna ruta pública devuelve un
// precio: ni al visitante, ni al profesional, ni al sitio con el secreto
// interno. El panel sigue con los suyos porque no pasa por acá.
func TestTiendaApagadaNoDevuelvePrecios(t *testing.T) {
	e := armar(t)
	pro := e.sembrar(t)
	pruebas.TiendaApagada(t, e.pool)
	_, _ = e.pool.Exec(context.Background(), `update products set featured = true`)
	anon := &http.Client{}
	juan := e.cliente(t, "juan@prueba.test")
	_, _ = e.pool.Exec(context.Background(), `update customers set price_list_id = $1 where email = 'juan@prueba.test'`, pro)
	u := e.srv.URL + "/api/v1/catalogo/"

	// Ningún número de la lista general ni de la profesional en ningún lado.
	precios := []string{"84500", "50000", "76050", "40000"}
	sinPrecios := func(quien, ruta, b string) {
		t.Helper()
		for _, p := range precios {
			if strings.Contains(b, p) {
				t.Errorf("%s %s mostró %s: %s", quien, ruta, p, b)
			}
		}
	}
	for _, ruta := range []string{"productos", "productos?publico=true", "productos/pagina", "productos/fenolico",
		"productos/fenolico?publico=true", "precios-por-variante", "portada"} {
		for quien, c := range map[string]*http.Client{"el visitante": anon, "el profesional": juan} {
			code, b := pedir(t, c, u+ruta)
			if code != 200 {
				t.Errorf("%s %s: %d %s", quien, ruta, code, b)
			}
			sinPrecios(quien, ruta, b)
		}
	}
	// Las ofertas son un precio rebajado: sin precios no hay ninguna.
	if _, b := pedir(t, anon, u+"productos?soloOfertas=true"); b != "[]\n" {
		t.Errorf("ofertas con la tienda apagada: %q", b)
	}
	// El sitio pidiendo una lista con el secreto tampoco.
	req, _ := http.NewRequest("GET", u+"productos?lista="+pro, nil)
	req.Header.Set("Authorization", "Bearer interno-de-prueba")
	if r, err := http.DefaultClient.Do(req); err == nil {
		b, _ := io.ReadAll(r.Body)
		r.Body.Close()
		sinPrecios("el sitio", "productos?lista=", string(b))
	}
	// La lista en PDF del profesional no se arma.
	if code, _ := pedir(t, juan, u+"mi-lista"); code != 403 {
		t.Errorf("mi-lista con la tienda apagada: %d", code)
	}

	// Encendida vuelve todo.
	_, _ = e.pool.Exec(context.Background(), `update site_settings set valor = 'si' where clave = 'tienda_activa'`)
	if _, b := pedir(t, anon, u+"productos?busqueda=fenolico"); !strings.Contains(b, `"precioDesde":"84500"`) {
		t.Errorf("encendida: %s", b)
	}
}

// El orden no delata lo que no se muestra (revisión del 10/11/2026): con la
// tienda apagada, «precio-asc» y «precio-desc» devolvían el orden de los
// precios ocultos.
func TestTiendaApagadaNoOrdenaPorPrecio(t *testing.T) {
	ps := func() []ProductoListado {
		uno, dos := "100", "50"
		return []ProductoListado{{Name: "B caro", PrecioDesde: &uno}, {Name: "A barato", PrecioDesde: &dos}}
	}
	asc, desc := ps(), ps()
	ordenar(asc, Filtros{Orden: "precio-asc", sinPrecios: true})
	ordenar(desc, Filtros{Orden: "precio-desc", sinPrecios: true})
	if asc[0].Name != desc[0].Name || asc[0].Name != "A barato" {
		t.Errorf("con la tienda apagada ordena por nombre: asc %s, desc %s", asc[0].Name, desc[0].Name)
	}
}
