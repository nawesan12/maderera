package catalogo

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/catalogoapi"
	"mjbj/internal/auth"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// Las pruebas del catálogo contra una base real y el contrato: cada
// respuesta se valida contra api/catalogo.yaml (pruebas.ConContrato). Las
// formas y los precios se compararon con el TS en sombra (143/143) al mudarlo;
// esto los deja fijos.

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

type entorno struct {
	srv  *httptest.Server
	pool *pgxpool.Pool
	ses  *auth.Servicio
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-del-catalogo-32-caracteres", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	catalogoapi.HandlerWithOptions(
		catalogoapi.NewStrictHandlerWithOptions(NuevaAPI(Nuevo(pool), limites.Nuevo(sqlc.New(pool), silencio)),
			[]catalogoapi.StrictMiddlewareFunc{plataforma.ConPedido[catalogoapi.StrictHandlerFunc]},
			catalogoapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		catalogoapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, err := catalogoapi.GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := catalogoapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	return &entorno{srv: srv, pool: pool, ses: ses}
}

func (e *entorno) cliente(t *testing.T, correo string) *http.Client {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeCliente(ctx, correo, "una clave larga", "Cliente"); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	if _, err := e.ses.Entrar(ctx, w, correo, "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u.URL, w.Result().Cookies())
	return &http.Client{Jar: jar}
}

func pedir(t *testing.T, c *http.Client, url string) (int, string) {
	t.Helper()
	resp, err := c.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

// sembrar: una categoría, dos productos (uno con tilde), la lista general y
// una profesional «general −10 %» sin precios propios salvo uno.
func (e *entorno) sembrar(t *testing.T) (pro string) {
	t.Helper()
	ctx := context.Background()
	q := func(sql string, args ...any) string {
		var id string
		if err := e.pool.QueryRow(ctx, sql, args...).Scan(&id); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	cat := q(`insert into categories (slug, name, description) values ('placas', 'Placas', '') returning id`)
	fen := q(`insert into products (slug, name, category_id, description) values ('fenolico', 'Fenólico', $1, '') returning id`, cat)
	mel := q(`insert into products (slug, name, category_id, description) values ('melamina', 'Melamina blanca', $1, '') returning id`, cat)
	v18 := q(`insert into product_variants (product_id, sku, label) values ($1, 'FEN18', '18 mm') returning id`, fen)
	vm := q(`insert into product_variants (product_id, sku, label) values ($1, 'MEL18', '18 mm') returning id`, mel)
	_ = q(`insert into product_variants (product_id, sku, label) values ($1, 'FEN12', '12 mm') returning id`, fen) // sin precio
	gen := q(`insert into price_lists (slug, name, is_default) values ('general', 'General', true) returning id`)
	pro = q(`insert into price_lists (slug, name, porcentaje_sobre_general) values ('pro', 'Profesional', -10) returning id`)
	_ = q(`insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 84500), ($1, $3, 50000.55) returning id`, gen, v18, vm)
	_ = q(`insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 40000) returning id`, pro, vm)
	return pro
}

func TestCatalogoPorLista(t *testing.T) {
	e := armar(t)
	pro := e.sembrar(t)
	anon := &http.Client{}
	u := e.srv.URL + "/api/v1/catalogo/"

	// Sin sesión: la general.
	if _, b := pedir(t, anon, u+"lista"); !strings.Contains(b, `"esDiferenciada":false`) || !strings.Contains(b, `"nombre":"General"`) {
		t.Errorf("lista sin sesión: %s", b)
	}
	// Con o sin tilde encuentra lo mismo. precioDesde es String(número) del
	// mínimo, como en el TS: sin los decimales de la columna.
	for _, buscar := range []string{"fenolico", "fenólico", "FENOL"} {
		_, b := pedir(t, anon, u+"productos?busqueda="+buscar)
		var ps []struct{ Slug, PrecioDesde string }
		_ = json.Unmarshal([]byte(b), &ps)
		if len(ps) != 1 || ps[0].Slug != "fenolico" || ps[0].PrecioDesde != "84500" {
			t.Errorf("buscar %q: %s", buscar, b)
		}
	}
	if c, _ := pedir(t, anon, u+"productos/no-existe"); c != 404 {
		t.Errorf("ficha inexistente: %d", c)
	}

	// Un profesional con la lista −10 %: el derivado sale del general por el
	// factor, y el precio propio manda sobre el derivado.
	juan := e.cliente(t, "juan@prueba.test")
	_, _ = e.pool.Exec(context.Background(), `update customers set price_list_id = $1 where email = 'juan@prueba.test'`, pro)
	_, b := pedir(t, juan, u+"precios-por-variante")
	var precios map[string]string
	_ = json.Unmarshal([]byte(b), &precios)
	var vistos []string
	for _, p := range precios {
		vistos = append(vistos, p)
	}
	if len(precios) != 2 || !strings.Contains(b, `"76050.00"`) || !strings.Contains(b, `"40000.00"`) {
		t.Errorf("precios del profesional: %s (%v)", b, vistos)
	}
	// publico=true nunca depende de la cookie: es lo que Next guarda en la
	// caché compartida.
	if _, b := pedir(t, juan, u+"productos?busqueda=fenolico&publico=true"); !strings.Contains(b, `"precioDesde":"84500"`) {
		t.Errorf("con publico=true el profesional vio otro precio: %s", b)
	}
	if _, b := pedir(t, juan, u+"productos?busqueda=fenolico"); !strings.Contains(b, `"precioDesde":"76050"`) {
		t.Errorf("el listado del profesional: %s", b)
	}
}

func TestMiLista(t *testing.T) {
	e := armar(t)
	pro := e.sembrar(t)
	u := e.srv.URL + "/api/v1/catalogo/mi-lista"
	if c, _ := pedir(t, &http.Client{}, u); c != 401 {
		t.Errorf("sin sesión: %d", c)
	}
	ana := e.cliente(t, "ana@prueba.test")
	_, b := pedir(t, ana, u)
	var l struct {
		Titulo string
		Filas  []FilaDeLista
	}
	_ = json.Unmarshal([]byte(b), &l)
	if l.Titulo != "Lista de precios" || len(l.Filas) != 3 {
		t.Fatalf("la general: %s", b)
	}
	// El orden es categoría, producto y variante; la de 12 mm no tiene precio.
	if l.Filas[0].SKU != "FEN18" || l.Filas[1].SKU != "FEN12" || l.Filas[1].Precio != nil || *l.Filas[2].Precio != "50000.55" {
		t.Errorf("filas: %s", b)
	}

	// La profesional aplica el factor (el TS lo ignoraba).
	_, _ = e.pool.Exec(context.Background(), `update customers set price_list_id = $1 where email = 'ana@prueba.test'`, pro)
	_, b = pedir(t, ana, u)
	_ = json.Unmarshal([]byte(b), &l)
	if l.Titulo != "Lista Profesional" || *l.Filas[0].Precio != "76050.00" || *l.Filas[2].Precio != "40000.00" {
		t.Errorf("la profesional: %s", b)
	}
	// Diez por hora.
	for range 8 {
		pedir(t, ana, u)
	}
	if c, _ := pedir(t, ana, u); c != 429 {
		t.Errorf("la undécima: %d", c)
	}
}
