package catalogo

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"mjbj/internal/pruebas"
	"mjbj/internal/reglas"
)

// H086: con la regla «precios_profesional_sin_tienda» en «si», el
// profesional aprobado ve su lista propia aunque la tienda esté apagada (en
// el catálogo y en el PDF). El público, la lista general, un cliente que no
// es profesional aunque tenga la misma lista, y el sitio pidiendo una lista
// que no es de ningún profesional siguen sin precios.
func TestPreciosDelProfesionalSinTienda(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	pro := e.sembrar(t)
	pruebas.TiendaApagada(t, e.pool)
	anon := &http.Client{}
	juan := e.cliente(t, "juan@prueba.test")
	ana := e.cliente(t, "ana@prueba.test")
	_, _ = e.pool.Exec(ctx, `update customers set price_list_id = $1 where email in ('juan@prueba.test', 'ana@prueba.test')`, pro)
	_, _ = e.pool.Exec(ctx, `update customers set tipo = 'profesional' where email = 'juan@prueba.test'`)
	u := e.srv.URL + "/api/v1/catalogo/"
	interno := func(ruta string) string {
		req, _ := http.NewRequest("GET", u+ruta, nil)
		req.Header.Set("Authorization", "Bearer interno-de-prueba")
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		return string(b)
	}

	// Arranque: «no», nadie ve precios.
	if c, _ := pedir(t, juan, u+"mi-lista"); c != 403 {
		t.Errorf("arranque, mi-lista: %d", c)
	}
	if b := interno("precios-por-variante?lista=" + pro); strings.Contains(b, "76050") {
		t.Errorf("arranque, el sitio: %s", b)
	}

	if err := reglas.Fijar(ctx, e.pool, reglas.PreciosProfesionalSinTienda, "si"); err != nil {
		t.Fatal(err)
	}
	if c, b := pedir(t, juan, u+"mi-lista"); c != 200 || !strings.Contains(b, "76050.00") {
		t.Errorf("el profesional, mi-lista: %d %s", c, b)
	}
	if _, b := pedir(t, juan, u+"productos?busqueda=fenolico"); !strings.Contains(b, `"precioDesde":"76050"`) {
		t.Errorf("el profesional, listado: %s", b)
	}
	if b := interno("precios-por-variante?lista=" + pro); !strings.Contains(b, "76050.00") {
		t.Errorf("el sitio con la lista del profesional: %s", b)
	}
	if b := interno("productos?busqueda=fenolico&lista=" + pro); !strings.Contains(b, `"precioDesde":"76050"`) {
		t.Errorf("el sitio, listado por lista: %s", b)
	}
	// Lo público, nunca.
	precios := []string{"84500", "50000", "76050", "40000"}
	for quien, c := range map[string]*http.Client{"el visitante": anon, "el profesional": juan, "la que no es profesional": ana} {
		for _, ruta := range []string{"productos?publico=true", "productos/fenolico?publico=true", "portada"} {
			_, b := pedir(t, c, u+ruta)
			for _, p := range precios {
				if strings.Contains(b, p) {
					t.Errorf("%s %s mostró %s", quien, ruta, p)
				}
			}
		}
	}
	// Con la misma lista pero sin ser profesional, tampoco.
	if c, _ := pedir(t, ana, u+"mi-lista"); c != 403 {
		t.Errorf("la que no es profesional, mi-lista: %d", c)
	}
	if _, b := pedir(t, ana, u+"productos?busqueda=fenolico"); strings.Contains(b, "76050") {
		t.Errorf("la que no es profesional, listado: %s", b)
	}
	// Una lista que no tiene ningún profesional no sale ni pedida por el sitio.
	_, _ = e.pool.Exec(ctx, `update customers set tipo = 'particular' where email = 'juan@prueba.test'`)
	if b := interno("precios-por-variante?lista=" + pro); strings.Contains(b, "76050") {
		t.Errorf("lista sin profesionales: %s", b)
	}
}
