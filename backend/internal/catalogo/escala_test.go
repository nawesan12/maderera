package catalogo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"testing"

	"mjbj/internal/pruebas"
)

// La tanda T8: la página del catálogo filtra y ordena con las claves y busca
// fotos solo para lo que muestra. Tiene que dar exactamente lo mismo que el
// listado entero recortado, en cada orden, con cada filtro y en cada página.

// sembrarMuchos arma 150 productos en tres categorías, con precios que
// empatan, ofertas, stock en una u otra sucursal, marcas y fotos.
func (e *entorno) sembrarMuchos(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO categories (slug, name, sort_order) VALUES ('placas', 'Placas', 1), ('pisos', 'Pisos', 2), ('herrajes', 'Herrajes', 3);
		INSERT INTO branches (slug, name) VALUES ('casa-central', 'Casa Central'), ('aserradero', 'Aserradero');
		INSERT INTO price_lists (slug, name, is_default) VALUES ('general', 'General', true);
		INSERT INTO products (slug, name, category_id, description, brand, featured)
		SELECT 'p-' || i,
		       -- Nombres repetidos a propósito: el orden tiene que desempatar
		       -- igual en el listado y en la página.
		       CASE WHEN i % 7 = 0 THEN 'Repetido' ELSE 'Producto ' || lpad((i * 37 % 150)::text, 3, '0') END,
		       (SELECT id FROM categories ORDER BY sort_order OFFSET i % 3 LIMIT 1),
		       'Descripción del ' || i,
		       CASE WHEN i % 4 = 0 THEN 'Moldava' WHEN i % 4 = 1 THEN 'Otra' END,
		       i % 5 = 0
		FROM generate_series(1, 150) i;
		INSERT INTO product_variants (product_id, sku, label, sort_order)
		SELECT p.id, p.slug || '-' || v, v || ' mm', v FROM products p, generate_series(1, 2) v;
		-- Precios que se repiten (i % 9), algunos sin precio, y ofertas
		-- vigentes y vencidas.
		INSERT INTO price_list_items (price_list_id, variant_id, price, precio_anterior, oferta_hasta)
		SELECT (SELECT id FROM price_lists), v.id, 1000 * (1 + (substr(p.slug, 3)::int % 9)) + v.sort_order,
		       CASE WHEN substr(p.slug, 3)::int % 6 = 0 THEN 99999 END,
		       CASE WHEN substr(p.slug, 3)::int % 12 = 0 THEN now() - interval '1 day' END
		FROM product_variants v JOIN products p ON p.id = v.product_id
		WHERE substr(p.slug, 3)::int % 10 <> 3;
		INSERT INTO inventory (variant_id, branch_id, qty, min_qty)
		SELECT v.id, b.id, (substr(p.slug, 3)::int * 13 + v.sort_order) % 8, 2
		FROM product_variants v JOIN products p ON p.id = v.product_id, branches b
		WHERE (substr(p.slug, 3)::int + length(b.slug)) % 3 <> 0;
		INSERT INTO product_images (product_id, url, sort_order)
		SELECT id, '/fotos/' || slug || '-' || n || '.jpg', n FROM products, generate_series(1, 2) n
		WHERE substr(slug, 3)::int % 4 <> 2;`); err != nil {
		t.Fatal(err)
	}
}

func TestPaginaIgualAlListadoRecortado(t *testing.T) {
	e := armar(t)
	e.sembrarMuchos(t)
	ctx := context.Background()
	s := Nuevo(e.pool)
	general, err := s.General(ctx)
	if err != nil {
		t.Fatal(err)
	}
	casos := []Filtros{
		{}, {Categoria: "placas"}, {Stock: "en-stock"}, {Stock: "casa-central"}, {Stock: "aserradero"},
		{SoloOfertas: true}, {Marca: "moldava"}, {Busqueda: "repetido"}, {Categoria: "pisos", Stock: "en-stock"},
	}
	for _, orden := range []string{"relevancia", "precio-asc", "precio-desc", "nombre"} {
		for _, base := range casos {
			f := base
			f.Orden = orden
			todos, err := s.Productos(ctx, f, general)
			if err != nil {
				t.Fatal(err)
			}
			for pagina := 1; pagina <= TopePaginas; pagina++ {
				quiero := Recortar(todos, pagina)
				claves, err := s.Claves(ctx, f, general)
				if err != nil {
					t.Fatal(err)
				}
				tengo := Recortar(claves, pagina)
				if err := s.Hidratar(ctx, tengo.Productos); err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(quiero, tengo) {
					t.Fatalf("%+v página %d: distinta del listado recortado", f, pagina)
				}
			}
			// Y el resumen, contra lo que hacía el metadata con el listado
			// entero: cuántos, el menor precio positivo y la primera foto.
			r, err := s.ResumenDe(ctx, todos)
			if err != nil {
				t.Fatal(err)
			}
			if r.Cantidad != len(todos) || fmt.Sprint(deref64(r.Desde)) != fmt.Sprint(menorPrecio(todos)) ||
				deref(r.Imagen) != primeraFoto(todos) {
				t.Errorf("%+v: resumen %d %v %v", f, r.Cantidad, deref64(r.Desde), deref(r.Imagen))
			}
		}
	}
	if len(mustProductos(t, s, Filtros{})) != 150 {
		t.Fatal("hacen falta los 150")
	}
}

// El bot pide seis: los mismos seis primeros del listado entero.
func TestElBotPideSeis(t *testing.T) {
	e := armar(t)
	e.sembrarMuchos(t)
	ctx := context.Background()
	s := Nuevo(e.pool)
	general, _ := s.General(ctx)
	todos, err := s.Productos(ctx, Filtros{Busqueda: "producto"}, general)
	if err != nil {
		t.Fatal(err)
	}
	seis, err := s.Claves(ctx, Filtros{Busqueda: "producto", Limite: 6}, general)
	if err != nil {
		t.Fatal(err)
	}
	if len(seis) != 6 {
		t.Fatalf("%d", len(seis))
	}
	for i := range seis {
		if seis[i].ID != todos[i].ID || !reflect.DeepEqual(seis[i].Labels, todos[i].Labels) {
			t.Errorf("el %d: %s, antes %s", i, seis[i].Name, todos[i].Name)
		}
	}
}

// El resumen por HTTP: con la tienda apagada no dice desde cuánto (es un
// precio) ni cuenta ofertas.
func TestResumenConLaTiendaApagada(t *testing.T) {
	e := armar(t)
	e.sembrarMuchos(t)
	u := e.srv.URL + "/api/v1/catalogo/productos/resumen"
	leer := func(q string) Resumen {
		t.Helper()
		code, b := pedir(t, &http.Client{}, u+"?"+q)
		if code != 200 {
			t.Fatalf("%s: %d %s", q, code, b)
		}
		var r Resumen
		if err := json.Unmarshal([]byte(b), &r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	if r := leer("categoria=placas&publico=true"); r.Cantidad != 50 || r.Desde == nil || r.Imagen == nil {
		t.Errorf("encendida: %+v", r)
	}
	pruebas.TiendaApagada(t, e.pool)
	if r := leer("categoria=placas&publico=true"); r.Cantidad != 50 || r.Desde != nil {
		t.Errorf("apagada: %+v", r)
	}
	if r := leer("soloOfertas=true&publico=true"); r.Cantidad != 0 {
		t.Errorf("ofertas con la tienda apagada: %+v", r)
	}
}

// La búsqueda libre tiene tope por IP para quien llega de afuera; el sitio
// con el secreto y un pedido sin IP de visitante, no.
func TestLaBusquedaTieneTope(t *testing.T) {
	e := armar(t)
	e.sembrar(t)
	u := e.srv.URL + "/api/v1/catalogo/productos/pagina?busqueda=" + url.QueryEscape("fenolico")
	pedirDesde := func(ip string) int {
		req, _ := http.NewRequest("GET", u, nil)
		req.Header.Set("X-Forwarded-For", ip)
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		return r.StatusCode
	}
	for range 120 {
		if c := pedirDesde("200.1.1.1"); c != 200 {
			t.Fatalf("antes del tope: %d", c)
		}
	}
	if c := pedirDesde("200.1.1.1"); c != 429 {
		t.Errorf("la 121: %d", c)
	}
	if c := pedirDesde("200.1.1.2"); c != 200 {
		t.Errorf("otra IP: %d", c)
	}
	// Sin la IP del visitante (un pedido que no pasó por Caddy) no hay tope:
	// si no, todas las visitas compartirían uno.
	for range 3 {
		if c, _ := pedir(t, &http.Client{}, u); c != 200 {
			t.Errorf("sin IP: %d", c)
		}
	}
}

func mustProductos(t *testing.T, s *Servicio, f Filtros) []ProductoListado {
	t.Helper()
	general, _ := s.General(context.Background())
	ps, err := s.Productos(context.Background(), f, general)
	if err != nil {
		t.Fatal(err)
	}
	return ps
}

func menorPrecio(ps []ProductoListado) any {
	var m *float64
	for _, p := range ps {
		if p.PrecioDesde == nil {
			continue
		}
		if n := numero(*p.PrecioDesde); n > 0 && (m == nil || n < *m) {
			m = &n
		}
	}
	return deref64(m)
}

func primeraFoto(ps []ProductoListado) string {
	for _, p := range ps {
		if p.Image != nil {
			return *p.Image
		}
	}
	return ""
}

func deref64(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}
