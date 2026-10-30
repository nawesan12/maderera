package checkout

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/checkoutapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

const secretoInterno = "secreto-interno-de-prueba"

type entorno struct {
	srv      *httptest.Server
	pool     *pgxpool.Pool
	ses      *auth.Servicio
	s        *Servicio
	sucursal string
	placa    string // placa entera o media, $84.500, 100 en el depósito
	tirante  string // por unidad, $1.200,50, sin costo
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-checkout-de-32-caracteres", URL: "http://localhost"}, pool)
	s := Nuevo(pool, silencio)
	m := http.NewServeMux()
	checkoutapi.HandlerWithOptions(
		checkoutapi.NewStrictHandlerWithOptions(NuevaAPI(s, plataforma.ConfigInterna{Secreto: secretoInterno}, false),
			[]checkoutapi.StrictMiddlewareFunc{plataforma.ConPedido[checkoutapi.StrictHandlerFunc]},
			checkoutapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		checkoutapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := checkoutapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := checkoutapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	e := &entorno{srv: srv, pool: pool, ses: ses, s: s}
	e.sucursal = e.id(t, `insert into branches (slug, name) values ('casa-central', 'Casa Central') returning id`)
	lista := e.id(t, `insert into price_lists (slug, name, is_default) values ('general', 'General', true) returning id`)
	cat := e.id(t, `insert into categories (slug, name, description) values ('placas', 'Placas', '') returning id`)
	prod := e.id(t, `insert into products (slug, name, category_id, description, alicuota_iva, unit, forma_de_venta, precio_media_pct)
		values ('fenolico', 'Fenólico', $1, '', 21, 'placa', 'entera_o_media', 55) returning id`, cat)
	e.placa = e.id(t, `insert into product_variants (product_id, sku, label) values ($1, 'FEN18', '18 mm') returning id`, prod)
	prod2 := e.id(t, `insert into products (slug, name, category_id, description, alicuota_iva) values ('tirante', 'Tirante', $1, '', 21) returning id`, cat)
	e.tirante = e.id(t, `insert into product_variants (product_id, sku, label) values ($1, 'TIR', '2x4') returning id`, prod2)
	e.exec(t, `insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 84500), ($1, $3, 1200.50)`, lista, e.placa, e.tirante)
	e.exec(t, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 1, 40000.5)`, e.placa)
	e.exec(t, `insert into inventory (variant_id, branch_id, qty) values ($1, $3, 100), ($2, $3, 100)`, e.placa, e.tirante, e.sucursal)
	return e
}

func (e *entorno) id(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var id string
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (e *entorno) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func (e *entorno) numero(t *testing.T, sql string, args ...any) float64 {
	t.Helper()
	var n float64
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (e *entorno) anonimo() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar}
}

func (e *entorno) web(t *testing.T, correo string) (*http.Client, *auth.Sesion) {
	t.Helper()
	if _, err := e.ses.AltaDeCliente(context.Background(), correo, "una clave larga", "Cliente Web"); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	ses, err := e.ses.Entrar(context.Background(), w, correo, "una clave larga", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	c := e.anonimo()
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	c.Jar.SetCookies(u.URL, w.Result().Cookies())
	return c, ses
}

func pedir(t *testing.T, c *http.Client, metodo, url string, cuerpo any, cabeceras ...string) (int, string) {
	t.Helper()
	var r io.Reader
	if cuerpo != nil {
		b, _ := json.Marshal(cuerpo)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(metodo, url, r)
	if cuerpo != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(cabeceras); i += 2 {
		req.Header.Set(cabeceras[i], cabeceras[i+1])
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func leer[T any](t *testing.T, cuerpo string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(cuerpo), &v); err != nil {
		t.Fatalf("%v: %s", err, cuerpo)
	}
	return v
}

func (e *entorno) compra(extra map[string]any) map[string]any {
	m := map[string]any{"nombre": "Juan Pérez", "email": "juan@prueba.test", "telefono": "2235551234", "entrega": "retiro",
		"sucursalId": e.sucursal, "medioPago": "transferencia"}
	for k, v := range extra {
		m[k] = v
	}
	return m
}

func TestCarritoAnonimo(t *testing.T) {
	e := armar(t)
	c := e.anonimo()
	u := e.srv.URL + "/api/v1/carrito"

	// Leer no crea nada.
	if code, b := pedir(t, c, "GET", u, nil); code != 200 || leer[Carrito](t, b).ID != nil {
		t.Fatalf("vacío: %d %s", code, b)
	}
	if n := e.numero(t, `select count(*) from carts`); n != 0 {
		t.Fatalf("leer creó %v carritos", n)
	}
	// El primer agregar crea el carrito y la cookie.
	code, b := pedir(t, c, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": 2})
	if code != 200 || !strings.Contains(b, "va al presupuesto") {
		t.Fatalf("agregar: %d %s", code, b)
	}
	req, _ := http.NewRequest("GET", e.srv.URL, nil)
	if len(c.Jar.Cookies(req.URL)) != 1 {
		t.Fatal("sin la cookie del carrito")
	}
	// Lo mismo otra vez suma; la media es otro renglón, a 55 %.
	if _, b := pedir(t, c, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": "1"}); !strings.Contains(b, "Sumaste 1 a Fenólico 18 mm.") {
		t.Fatalf("sumar: %s", b)
	}
	pedir(t, c, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": 1, "presentacion": "media_largo"})
	// Validaciones como zod y las del producto.
	if _, b := pedir(t, c, "POST", u+"/items", map[string]any{"descripcion": "", "cantidad": 1}); leer[Resultado](t, b).Error != "Too small: expected string to have >=1 characters" {
		t.Fatalf("zod: %s", b)
	}
	if _, b := pedir(t, c, "POST", u+"/items", map[string]any{"variantId": e.tirante, "descripcion": "Tirante", "cantidad": 1.5}); !strings.Contains(b, "Este producto se vende por unidad entera.") {
		t.Fatalf("entera: %s", b)
	}
	if _, b := pedir(t, c, "POST", u+"/items/varios", map[string]any{"items": muchos(41)}); !strings.Contains(b, "Son demasiadas líneas juntas (41)") {
		t.Fatalf("varios: %s", b)
	}
	_, b = pedir(t, c, "GET", u, nil)
	car := leer[Carrito](t, b)
	if len(car.Items) != 2 || car.Items[0].Cantidad != 3 || *car.Items[1].PrecioActual != 46475 || car.Subtotal != 3*84500+46475 {
		t.Fatalf("carrito: %+v", car)
	}
	// Otro visitante no toca este carrito.
	otro := e.anonimo()
	pedir(t, otro, "DELETE", u+"/items/"+car.Items[0].ID, nil)
	if n := e.numero(t, `select count(*) from cart_items`); n != 2 {
		t.Fatalf("otro borró: %v", n)
	}
	pedir(t, c, "PATCH", u+"/items/"+car.Items[0].ID, map[string]any{"cantidad": 5})
	pedir(t, c, "PATCH", u+"/items/"+car.Items[1].ID, map[string]any{"cantidad": 0})
	_, b = pedir(t, c, "GET", u, nil)
	if car = leer[Carrito](t, b); len(car.Items) != 1 || car.Items[0].Cantidad != 5 {
		t.Fatalf("cambiar: %+v", car)
	}
	// Actualizar precios con la media (el TS le ponía el de la entera).
	pedir(t, c, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico", "cantidad": 1, "presentacion": "media_ancho"})
	e.exec(t, `update cart_items set precio_unitario = 1`)
	pedir(t, c, "POST", u+"/precios", nil)
	_, b = pedir(t, c, "GET", u, nil)
	if car = leer[Carrito](t, b); car.ConPrecioDesactualizado != 0 {
		t.Fatalf("después de actualizar quedan %d desactualizados", car.ConPrecioDesactualizado)
	}
	if _, b := pedir(t, c, "DELETE", u, nil); !strings.Contains(b, "Presupuesto vaciado.") {
		t.Fatal(b)
	}
}

func TestAdoptarAlEntrar(t *testing.T) {
	e := armar(t)
	anon := e.anonimo()
	u := e.srv.URL + "/api/v1/carrito"
	pedir(t, anon, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico", "cantidad": 2})
	req, _ := http.NewRequest("GET", e.srv.URL, nil)
	token := anon.Jar.Cookies(req.URL)[0].Value
	web, ses := e.web(t, "ana@prueba.test")
	pedir(t, web, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico", "cantidad": 1})
	if c, _ := pedir(t, web, "POST", e.srv.URL+"/api/v1/interno/carrito/adoptar", map[string]any{"userId": ses.UserID, "token": token}); c != 403 {
		t.Fatal("adoptar sin el secreto")
	}
	if c, b := pedir(t, web, "POST", e.srv.URL+"/api/v1/interno/carrito/adoptar", map[string]any{"userId": ses.UserID, "token": token},
		"Authorization", "Bearer "+secretoInterno); c != 204 {
		t.Fatalf("adoptar: %d %s", c, b)
	}
	_, b := pedir(t, web, "GET", u, nil)
	if car := leer[Carrito](t, b); len(car.Items) != 1 || car.Items[0].Cantidad != 3 {
		t.Fatalf("juntos: %+v", car)
	}
	if n := e.numero(t, `select count(*) from carts`); n != 1 {
		t.Fatalf("quedaron %v carritos", n)
	}
}

func TestConfirmarCompra(t *testing.T) {
	e := armar(t)
	c := e.anonimo()
	u := e.srv.URL + "/api/v1/carrito"
	if code, b := pedir(t, c, "POST", u+"/confirmar", e.compra(nil)); code != 422 || !strings.Contains(b, MsjVacio) {
		t.Fatalf("vacío: %d %s", code, b)
	}
	pedir(t, c, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": 2})
	pedir(t, c, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": 1, "presentacion": "media_largo"})
	pedir(t, c, "POST", u+"/items", map[string]any{"variantId": e.tirante, "descripcion": "Tirante", "cantidad": 10})
	e.exec(t, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta) values ('transferencia', 0, 10, 'Transferencia -10 %')`)

	// La validación y los frenos del medio.
	if code, b := pedir(t, c, "POST", u+"/confirmar", e.compra(map[string]any{"entrega": "envio"})); code != 422 ||
		!strings.Contains(b, "Para el envío necesitamos la zona y la dirección.") {
		t.Fatalf("envío: %d %s", code, b)
	}
	if code, b := pedir(t, c, "POST", u+"/confirmar", e.compra(map[string]any{"medioPago": "cuenta_corriente"})); code != 422 ||
		!strings.Contains(b, "Necesitás iniciar sesión con tu cuenta.") {
		t.Fatalf("cuenta corriente sin sesión: %d %s", code, b)
	}

	code, b := pedir(t, c, "POST", u+"/confirmar", e.compra(nil))
	if code != 200 {
		t.Fatalf("confirmar: %d %s", code, b)
	}
	compra := leer[Compra](t, b)
	if !strings.HasPrefix(compra.Numero, "PED-") || compra.Token == "" {
		t.Fatalf("%+v", compra)
	}
	// 2 × 84.500 + 46.475 + 10 × 1.200,50 = 227.480; −10 % = 204.732.
	var subtotal, descuento, total string
	if err := e.pool.QueryRow(context.Background(), `select subtotal::text, descuento::text, total::text from orders where id = $1`, compra.PedidoID).
		Scan(&subtotal, &descuento, &total); err != nil {
		t.Fatal(err)
	}
	if subtotal != "227480.00" || descuento != "22748.00" || total != "204732.00" {
		t.Fatalf("importes %s %s %s", subtotal, descuento, total)
	}
	// Las líneas: la media con su nombre y medio de stock, el costo congelado.
	var desc, stock, costo string
	if err := e.pool.QueryRow(context.Background(), `select descripcion, stock_por_unidad::text, costo_unitario::text from order_items
		where order_id = $1 and presentacion = 'media_largo'`, compra.PedidoID).Scan(&desc, &stock, &costo); err != nil {
		t.Fatal(err)
	}
	if desc != "Fenólico 18 mm — Media placa, al largo" || stock != "0.500000" || costo != "20000.2500" {
		t.Fatalf("media: %q %s %s", desc, stock, costo)
	}
	// La mercadería reservada: 2 + 0,5 placas y 10 tirantes.
	if r := e.numero(t, `select reservado::float8 from inventory where variant_id = $1`, e.placa); r != 2.5 {
		t.Fatalf("reservado %v", r)
	}
	if n := e.numero(t, `select count(*) from carts where activo`); n != 0 {
		t.Fatal("el carrito sigue activo")
	}
	// El acuse (y la venta nueva al panel), en la cola con el pedido.
	if n := e.numero(t, `select count(*) from trabajos where tipo = 'pedido.recibido' and carga->>'orderId' = $1`, compra.PedidoID); n != 1 {
		t.Fatalf("avisos del pedido encolados: %v", n)
	}
	// Otra vez el mismo carrito: ya no hay nada que comprar.
	if code, _ := pedir(t, c, "POST", u+"/confirmar", e.compra(nil)); code != 422 {
		t.Fatalf("dos veces: %d", code)
	}
}

func aLaVez(n int, f func(i int)) {
	var wg sync.WaitGroup
	listos := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-listos
			f(i)
		}(i)
	}
	close(listos)
	wg.Wait()
}

// Veinte compras a la vez de carritos distintos: veinte números distintos y
// la mercadería reservada justa. Con las mismas placas en distinto orden,
// sin trabas (los candados del stock, todos juntos y en orden).
func TestComprasSimultaneas(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	quienes := make([]Quien, 20)
	for i := range quienes {
		quienes[i] = Quien{Token: "token-" + string(rune('a'+i))}
		e.exec(t, `insert into carts (token) values ($1)`, quienes[i].Token)
		primero, segundo := e.placa, e.tirante
		if i%2 == 1 {
			primero, segundo = segundo, primero
		}
		for _, v := range []string{primero, segundo} {
			if r, err := e.s.Agregar(ctx, quienes[i], map[string]any{"variantId": v, "descripcion": "x", "cantidad": 1.0}); err != nil || r.Error != "" {
				t.Fatal(err, r.Error)
			}
		}
	}
	numeros := make([]string, 20)
	errs := make([]error, 20)
	aLaVez(20, func(i int) {
		c, err := e.s.Confirmar(ctx, quienes[i], "10.0.0."+string(rune('1'+i%9)), e.compra(map[string]any{"email": "c" + string(rune('a'+i)) + "@prueba.test"}))
		errs[i] = err
		if err == nil {
			numeros[i] = c.Numero
		}
	})
	for _, err := range errs {
		if err != nil {
			t.Fatalf("una compra falló: %v", err)
		}
	}
	sort.Strings(numeros)
	for i := 1; i < len(numeros); i++ {
		if numeros[i] == numeros[i-1] {
			t.Fatalf("número repetido: %v", numeros)
		}
	}
	if r := e.numero(t, `select reservado::float8 from inventory where variant_id = $1`, e.placa); r != 20 {
		t.Fatalf("reservado %v, tenía que ser 20", r)
	}
}

// Diez «Confirmar» del mismo carrito a la vez (doble clic, dos pestañas):
// un solo pedido. Sin el candado del carrito (MJBJ_PRUEBA_SIN_CANDADO=1)
// salen varios, con la mercadería reservada varias veces.
func TestConfirmarDosVecesElMismoCarrito(t *testing.T) {
	e := armar(t)
	e.s.SinCandado = os.Getenv("MJBJ_PRUEBA_SIN_CANDADO") == "1"
	ctx := context.Background()
	q := Quien{Token: "token-unico"}
	e.exec(t, `insert into carts (token) values ($1)`, q.Token)
	if _, err := e.s.Agregar(ctx, q, map[string]any{"variantId": e.placa, "descripcion": "x", "cantidad": 3.0}); err != nil {
		t.Fatal(err)
	}
	// Las conexiones, abiertas antes de largar.
	var conns []*pgxpool.Conn
	for i := int32(0); i < e.pool.Stat().MaxConns(); i++ {
		c, _ := e.pool.Acquire(ctx)
		conns = append(conns, c)
	}
	for _, c := range conns {
		c.Release()
	}
	aLaVez(10, func(i int) {
		_, _ = e.s.Confirmar(ctx, q, "10.0.1.1", e.compra(nil))
	})
	if n := e.numero(t, `select count(*) from orders`); n != 1 {
		t.Fatalf("%v pedidos del mismo carrito", n)
	}
	if n := e.numero(t, `select count(*) from trabajos where tipo = 'pedido.recibido'`); n != 1 {
		t.Fatalf("%v acuses para un pedido", n)
	}
	if r := e.numero(t, `select reservado::float8 from inventory where variant_id = $1`, e.placa); r != 3 {
		t.Fatalf("reservado %v", r)
	}
}

func TestPedirPresupuesto(t *testing.T) {
	e := armar(t)
	c := e.anonimo()
	u := e.srv.URL + "/api/v1/carrito"
	if code, b := pedir(t, c, "POST", u+"/presupuesto", map[string]any{"nombre": "Ana", "email": "ana@prueba.test", "telefono": "2235551234"}); code != 422 ||
		!strings.Contains(b, "Agregá al menos un producto") {
		t.Fatalf("vacío: %d %s", code, b)
	}
	pedir(t, c, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico", "cantidad": 2})
	code, b := pedir(t, c, "POST", u+"/presupuesto", map[string]any{"nombre": "Ana", "email": "ana@prueba.test", "telefono": "2235551234",
		"necesitaPara": "2026-11-05", "motivos": []string{"obra", "volumen"}, "notas": "Para el lunes"})
	if code != 200 {
		t.Fatalf("%d %s", code, b)
	}
	p := leer[Presupuesto](t, b)
	var notas, origen, subtotal string
	var necesita string
	if err := e.pool.QueryRow(context.Background(), `select notas, origen::text, subtotal::text, to_char(necesita_para at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from quotes where id = $1`, p.QuoteID).
		Scan(&notas, &origen, &subtotal, &necesita); err != nil {
		t.Fatal(err)
	}
	if notas != "Cotización especial: Obra completa · Compra por volumen\nPara el lunes" || origen != "sitio" || subtotal != "169000.00" || necesita != "2026-11-05 15:00" {
		t.Fatalf("%q %s %s %s", notas, origen, subtotal, necesita)
	}
	if n := e.numero(t, `select count(*) from cart_items`); n != 1 {
		t.Fatal("el carrito se vació")
	}
	if n := e.numero(t, `select count(*) from trabajos where tipo = 'presupuesto.recibido' and carga->>'quoteId' = $1`, p.QuoteID); n != 1 {
		t.Fatalf("acuse del presupuesto encolado: %v", n)
	}
}

func muchos(n int) []any {
	out := make([]any, n)
	for i := range out {
		out[i] = map[string]any{}
	}
	return out
}

// Sin cookie, cada «agregar» crea un carrito: por IP hay un tope por hora,
// y el que ya tiene su carrito sigue agregando aunque el tope se cumpla.
func TestCarritosAnonimosConFreno(t *testing.T) {
	e := armar(t)
	u := e.srv.URL + "/api/v1/carrito/items"
	item := map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": 1}
	con := e.anonimo()
	if code, b := pedir(t, con, "POST", u, item); code != 200 {
		t.Fatalf("el primero: %d %s", code, b)
	}
	sin := &http.Client{} // un bot: no guarda la cookie
	frenado := 0
	for i := 0; i < 70; i++ {
		if code, _ := pedir(t, sin, "POST", u, item); code == http.StatusTooManyRequests {
			frenado++
		}
	}
	if n := e.numero(t, `select count(*) from carts`); n > 60 {
		t.Fatalf("%v carritos de una IP en una hora", n)
	}
	if frenado == 0 {
		t.Fatal("no frenó a nadie")
	}
	if code, b := pedir(t, con, "POST", u, item); code != 200 {
		t.Fatalf("el que ya tenía carrito: %d %s", code, b)
	}
}
