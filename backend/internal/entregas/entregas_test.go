package entregas

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/entregasapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

const secretoInterno = "secreto-interno-de-prueba"

type entorno struct {
	srv  *httptest.Server
	pool *pgxpool.Pool
	ses  *auth.Servicio
	s    *Servicio
	// el mundo de la prueba
	sucursal, variante, otraVariante string
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-entregas-de-32-caracteres", URL: "http://localhost"}, pool)
	s := Nuevo(pool, silencio)
	m := http.NewServeMux()
	entregasapi.HandlerWithOptions(
		entregasapi.NewStrictHandlerWithOptions(NuevaAPI(s, plataforma.ConfigInterna{Secreto: secretoInterno}),
			[]entregasapi.StrictMiddlewareFunc{plataforma.ConPedido[entregasapi.StrictHandlerFunc]},
			entregasapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		entregasapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := entregasapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := entregasapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	e := &entorno{srv: srv, pool: pool, ses: ses, s: s}
	cat := e.uno(t, `insert into categories (slug, name, description) values ('maderas', 'Maderas', '') returning id::text`)
	p := e.uno(t, `insert into products (slug, name, category_id, description, unit) values ('tirante', 'Tirante', $1, '', 'unidad') returning id::text`, cat)
	e.variante = e.uno(t, `insert into product_variants (product_id, sku, label) values ($1, 'TIR', '2x4') returning id::text`, p)
	e.otraVariante = e.uno(t, `insert into product_variants (product_id, sku, label) values ($1, 'TIR3', '3x3') returning id::text`, p)
	e.sucursal = e.uno(t, `insert into branches (slug, name, sort_order) values ('casa-central', 'Casa Central', 1) returning id::text`)
	e.exec(t, `insert into inventory (variant_id, branch_id, qty) values ($1, $3, 100), ($2, $3, 100)`, e.variante, e.otraVariante, e.sucursal)
	return e
}

func (e *entorno) uno(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var s string
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&s); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return s
}

func (e *entorno) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

// pedido arma un pedido con dos renglones (10 y 4 tirantes) y su reserva.
func (e *entorno) pedido(t *testing.T, numero, estado string, cliente *string) (id, renglon1, renglon2 string) {
	t.Helper()
	id = e.uno(t, `insert into orders (numero, customer_id, branch_id, estado, subtotal, total, contacto_nombre, contacto_email)
		values ($1, $2, $3, $4, 100, 100, 'Marta Gómez', 'marta@prueba.test') returning id::text`, numero, cliente, e.sucursal, estado)
	renglon1 = e.uno(t, `insert into order_items (order_id, variant_id, descripcion, cantidad, precio_unitario, subtotal, orden)
		values ($1, $2, 'Tirante 2x4', 10, 1, 10, 0) returning id::text`, id, e.variante)
	renglon2 = e.uno(t, `insert into order_items (order_id, variant_id, descripcion, cantidad, precio_unitario, subtotal, orden)
		values ($1, $2, 'Tirante 3x3', 4, 1, 4, 1) returning id::text`, id, e.otraVariante)
	if err := pgx.BeginFunc(context.Background(), e.pool, func(tx pgx.Tx) error {
		return reservas.ReservarPedido(context.Background(), tx, id)
	}); err != nil {
		t.Fatal(err)
	}
	return
}

func (e *entorno) cliente(cookies []*http.Cookie) *http.Client {
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u.URL, cookies)
	return &http.Client{Jar: jar}
}

func (e *entorno) staff(t *testing.T, correo string, rol sqlc.StaffRole) (*http.Client, *auth.Sesion) {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeStaff(ctx, correo, "una clave larga", "Persona", rol); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	ses, err := e.ses.Entrar(ctx, w, correo, "una clave larga", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	return e.cliente(w.Result().Cookies()), ses
}

func (e *entorno) web(t *testing.T, correo string) (*http.Client, string) {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeCliente(ctx, correo, "una clave larga", "Cliente Web"); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	ses, err := e.ses.Entrar(ctx, w, correo, "una clave larga", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	return e.cliente(w.Result().Cookies()), e.uno(t, `select id::text from customers where user_id = $1`, ses.UserID)
}

type internoRT struct{}

func (internoRT) RoundTrip(r *http.Request) (*http.Response, error) {
	r.Header.Set("Authorization", "Bearer "+secretoInterno)
	return http.DefaultTransport.RoundTrip(r)
}

var interno = &http.Client{Transport: internoRT{}}

func pedir(t *testing.T, c *http.Client, metodo, url string, cuerpo any) (int, string) {
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
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func leer[T any](t *testing.T, s string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		t.Fatalf("%v: %s", err, s)
	}
	return v
}

func (e *entorno) stock(t *testing.T, variante string) (qty, reservado string) {
	t.Helper()
	if err := e.pool.QueryRow(context.Background(), `select qty::text, reservado::text from inventory where variant_id = $1`, variante).Scan(&qty, &reservado); err != nil {
		t.Fatal(err)
	}
	return
}

func cantidades(pares ...string) []map[string]string {
	var out []map[string]string
	for i := 0; i+1 < len(pares); i += 2 {
		out = append(out, map[string]string{"orderItemId": pares[i], "valor": pares[i+1]})
	}
	return out
}

// Un acopio de punta a punta: retiro parcial con remito, la firma con el
// dedo, el PDF, la anulación (dos veces) y los permisos.
func TestRetiroParcialFirmaYAnulacion(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	dep, _ := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	web, propio := e.web(t, "cliente@prueba.test")
	otro, _ := e.web(t, "otro@prueba.test")
	pedido, r1, r2 := e.pedido(t, "PED-1001", "listo", &propio)
	u := e.srv.URL + "/api/v1/"

	// El acopio entero.
	c, b := pedir(t, dep, "GET", u+"admin/pedidos/"+pedido+"/acopio", nil)
	acopio := leer[[]Renglon](t, b)
	if c != 200 || len(acopio) != 2 || acopio[0].Pendiente != 10 || acopio[1].Pendiente != 4 {
		t.Fatalf("acopio: %d %s", c, b)
	}
	if c, _ := pedir(t, web, "GET", u+"admin/pedidos/"+pedido+"/acopio", nil); c != 403 {
		t.Errorf("el cliente leyó el acopio del panel: %d", c)
	}

	// Un retiro sin documento no sale; de más, tampoco.
	form := map[string]any{"orderId": pedido, "tipo": "retiro", "receptorNombre": "Juan", "cantidades": cantidades(r1, "5")}
	if c, b := pedir(t, ven, "POST", u+"admin/remitos", form); c != 422 || !strings.Contains(b, MsjFaltaDocumento) {
		t.Fatalf("sin documento: %d %s", c, b)
	}
	form["receptorDocumento"] = "30111222"
	form["cantidades"] = cantidades(r1, "10,5")
	if c, b := pedir(t, ven, "POST", u+"admin/remitos", form); c != 422 || !strings.Contains(b, `De \"Tirante 2x4\" quedan 10 y estás entregando 10.5.`) {
		t.Fatalf("de más: %d %s", c, b)
	}
	form["cantidades"] = cantidades(r1, "5", r2, "0")
	c, b = pedir(t, ven, "POST", u+"admin/remitos", form)
	prep := leer[map[string]any](t, b)
	if c != 200 || prep["numero"] != "REM-0001" || prep["pedidoCompleto"] != false || prep["ok"] != "Remito REM-0001 listo. Todavía queda mercadería en acopio." {
		t.Fatalf("retiro: %d %s", c, b)
	}
	remito, token := prep["id"].(string), prep["firmaToken"].(string)
	if q, res := e.stock(t, e.variante); q != "95.000" || res != "5.000" {
		t.Errorf("el stock después del retiro: %s reservado %s", q, res)
	}

	// La ficha del pedido.
	c, b = pedir(t, ven, "GET", u+"admin/pedidos/"+pedido+"/remitos", nil)
	lista := leer[[]RemitoListado](t, b)
	if c != 200 || len(lista) != 1 || lista[0].CantidadLineas != 1 || lista[0].Estado != "preparada" {
		t.Fatalf("remitos: %d %s", c, b)
	}

	// El remito completo: lo que queda en acopio en ese momento.
	if c, _ := pedir(t, http.DefaultClient, "GET", u+"remitos/"+remito, nil); c != 401 {
		t.Errorf("remito sin sesión: %d", c)
	}
	c, b = pedir(t, interno, "GET", u+"remitos/"+remito, nil)
	rc := leer[RemitoCompleto](t, b)
	if c != 200 || len(rc.Lineas) != 1 || rc.Lineas[0].Cantidad != 5 || len(rc.Pendientes) != 2 || rc.Pendientes[0].Pendiente != 5 ||
		rc.SucursalDireccion == nil || *rc.SucursalDireccion != "Av. Juan B. Justo 4153, Mar del Plata" || rc.Factura != nil {
		t.Fatalf("remito completo: %d %s", c, b)
	}

	// La firma con el dedo: pública, por el token.
	c, b = pedir(t, http.DefaultClient, "GET", u+"firmar/"+token, nil)
	if c != 200 || !strings.Contains(b, `"numero":"REM-0001"`) {
		t.Fatalf("remito por token: %d %s", c, b)
	}
	if c, _ := pedir(t, http.DefaultClient, "GET", u+"firmar/no-existe-este-token", nil); c != 404 {
		t.Errorf("token inventado: %d", c)
	}
	firma := map[string]any{"token": token, "receptorNombre": "Ju", "firma": "data:image/png;base64,AAAA"}
	if c, b := pedir(t, http.DefaultClient, "POST", u+"firmar", firma); c != 422 || !strings.Contains(b, "Escribí tu nombre y apellido.") {
		t.Fatalf("nombre corto: %d %s", c, b)
	}
	firma["receptorNombre"] = "  Juan Pérez "
	firma["ip"] = "1.2.3.4" // sin el secreto no se cree
	c, b = pedir(t, http.DefaultClient, "POST", u+"firmar", firma)
	if c != 200 || !strings.Contains(b, `"numero":"REM-0001"`) {
		t.Fatalf("firma: %d %s", c, b)
	}
	var nombre, doc, ip, estado string
	_ = e.pool.QueryRow(context.Background(), `select receptor_nombre, receptor_documento, firmado_ip, estado::text from deliveries where id = $1`, remito).
		Scan(&nombre, &doc, &ip, &estado)
	if nombre != "Juan Pérez" || doc != "30111222" || ip == "1.2.3.4" || estado != "entregada" {
		t.Errorf("la firma guardó %q %q %q %q (el documento no se pisa, la ip no se cree)", nombre, doc, ip, estado)
	}
	if c, b := pedir(t, http.DefaultClient, "POST", u+"firmar", firma); c != 409 || !strings.Contains(b, MsjYaFirmado) {
		t.Errorf("segunda firma: %d %s", c, b)
	}

	// El PDF: el personal de pedidos, el dueño; a otro y al aserradero, 404.
	taller, _ := e.staff(t, "taller@prueba.test", sqlc.StaffRoleAserradero)
	for _, caso := range []struct {
		c     *http.Client
		cod   int
		quien string
	}{{ven, 200, "vendedor"}, {web, 200, "dueño"}, {otro, 404, "otro cliente"}, {taller, 404, "aserradero"}, {http.DefaultClient, 404, "sin sesión"}} {
		req, _ := http.NewRequest("GET", u+"remitos/"+remito+"/pdf", nil)
		resp, err := caso.c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		cuerpo, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != caso.cod || (caso.cod == 200 && (!bytes.HasPrefix(cuerpo, []byte("%PDF")) ||
			resp.Header.Get("Content-Disposition") != `attachment; filename="REM-0001.pdf"`)) {
			t.Errorf("PDF de %s: %d", caso.quien, resp.StatusCode)
		}
	}

	// Los avisos: solo el servidor.
	if c, _ := pedir(t, ven, "GET", u+"remitos/"+remito+"/aviso", nil); c != 403 {
		t.Errorf("aviso sin secreto: %d", c)
	}
	c, b = pedir(t, interno, "GET", u+"remitos/"+remito+"/aviso", nil)
	if c != 200 || !strings.Contains(b, `"email":"marta@prueba.test"`) || !strings.Contains(b, `"emailCliente":"cliente@prueba.test"`) {
		t.Errorf("aviso: %d %s", c, b)
	}

	// El portal: el dueño ve sus retiros y su acopio; otro, nada.
	c, b = pedir(t, web, "GET", u+"mi-cuenta/pedidos/"+pedido+"/entregas", nil)
	portal := leer[EntregasDelPortal](t, b)
	if c != 200 || len(portal.Entregas) != 1 || len(portal.Acopio) != 2 || portal.Acopio[0].Pendiente != 5 {
		t.Fatalf("portal: %d %s", c, b)
	}
	if c, _ := pedir(t, otro, "GET", u+"mi-cuenta/pedidos/"+pedido+"/entregas", nil); c != 404 {
		t.Errorf("portal de otro: %d", c)
	}

	// Anular devuelve la mercadería; anular otra vez no la devuelve de nuevo.
	if c, _ := pedir(t, web, "POST", u+"admin/remitos/"+remito+"/anular", nil); c != 403 {
		t.Errorf("el cliente anuló: %d", c)
	}
	for i := 0; i < 2; i++ {
		if c, b := pedir(t, ven, "POST", u+"admin/remitos/"+remito+"/anular", nil); c != 200 || !strings.Contains(b, "Remito anulado.") {
			t.Fatalf("anular: %d %s", c, b)
		}
	}
	if q, _ := e.stock(t, e.variante); q != "100.000" {
		t.Errorf("el stock después de anular: %s", q)
	}
	c, b = pedir(t, dep, "GET", u+"admin/pedidos/"+pedido+"/acopio", nil)
	if acopio := leer[[]Renglon](t, b); acopio[0].Pendiente != 10 {
		t.Errorf("el acopio después de anular: %s", b)
	}
}

// Llevarse todo cierra el pedido, con su historia; un envío deja su
// seguimiento.
func TestRetiroCompletoCierraElPedido(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, r2 := e.pedido(t, "PED-1002", "listo", nil)
	u := e.srv.URL + "/api/v1/admin/remitos"
	c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "envio", "transportista": " Expreso Sur ",
		"numeroSeguimiento": "AB123", "cantidades": cantidades(r1, "10", r2, "3,995")})
	if c != 200 || !strings.Contains(b, "Con esto el pedido queda entregado.") {
		t.Fatalf("envío: %d %s", c, b)
	}
	var estado, nota, transportista string
	_ = e.pool.QueryRow(context.Background(), `select o.estado::text, h.nota from orders o join order_status_history h on h.order_id = o.id where o.id = $1`, pedido).Scan(&estado, &nota)
	_ = e.pool.QueryRow(context.Background(), `select transportista from shipments`).Scan(&transportista)
	if estado != "entregado" || nota != "Remito REM-0001: se retiró todo lo que quedaba" || transportista != "Expreso Sur" {
		t.Errorf("pedido %q, nota %q, transportista %q", estado, nota, transportista)
	}
	// Ya no queda nada.
	if c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "envio", "cantidades": cantidades(r1, "1")}); c != 422 ||
		!strings.Contains(b, "quedan 0") {
		t.Errorf("después de todo: %d %s", c, b)
	}
	// Un pedido cancelado no entrega.
	cancelado, r, _ := e.pedido(t, "PED-1003", "cancelado", nil)
	if c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": cancelado, "tipo": "envio", "cantidades": cantidades(r, "1")}); c != 422 ||
		!strings.Contains(b, "El pedido está cancelado.") {
		t.Errorf("cancelado: %d %s", c, b)
	}
}

// El remito de constancia del mostrador: no toca el stock, una sola vez, y
// anularlo tampoco lo toca.
func TestRemitoDeConstanciaYSuAnulacion(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	dep, _ := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	u := e.srv.URL + "/api/v1/mostrador/pedidos/"
	listo, _, _ := e.pedido(t, "PED-1004", "listo", nil)
	if c, b := pedir(t, ven, "POST", u+listo+"/remito", map[string]any{}); c != 422 || !strings.Contains(b, "todavía tiene mercadería en depósito") {
		t.Fatalf("pedido en depósito: %d %s", c, b)
	}
	vendido, _, _ := e.pedido(t, "PED-1005", "entregado", nil)
	if c, _ := pedir(t, dep, "POST", u+vendido+"/remito", map[string]any{}); c != 403 {
		t.Errorf("el depósito no entra al mostrador: %d", c)
	}
	if c, b := pedir(t, ven, "POST", u+"no-es-un-id/remito", map[string]any{}); c != 422 || !strings.Contains(b, "El pedido no existe.") {
		t.Errorf("sin pedido: %d %s", c, b)
	}
	c, b := pedir(t, ven, "POST", u+vendido+"/remito", map[string]any{"receptorNombre": "Flete Gómez"})
	emitido := leer[map[string]string](t, b)
	if c != 200 || emitido["remitoNumero"] != "REM-0001" || emitido["ok"] != "Remito REM-0001 emitido." {
		t.Fatalf("constancia: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", u+vendido+"/remito", nil); c != 422 || !strings.Contains(b, "Esta venta ya tiene su remito emitido.") {
		t.Errorf("segunda constancia: %d %s", c, b)
	}
	var bitacora int
	_ = e.pool.QueryRow(context.Background(), `select count(*) from audit_log where entidad = 'remito' and descripcion = 'Remito REM-0001 emitido desde el mostrador'`).Scan(&bitacora)
	if bitacora != 1 {
		t.Errorf("bitácora: %d", bitacora)
	}
	antes, _ := e.stock(t, e.variante)
	if c, _ := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/remitos/"+emitido["remitoId"]+"/anular", nil); c != 200 {
		t.Fatal(c)
	}
	// El TS devolvía al stock lo que este remito nunca sacó.
	if despues, _ := e.stock(t, e.variante); despues != antes {
		t.Errorf("anular la constancia movió el stock: %s → %s", antes, despues)
	}
}

// Veinte retiros a la vez del mismo pedido: números sin repetir y nunca más
// de lo que queda en acopio. Sin el candado antes de leer el saldo (como el
// TS), salen más de diez remitos de un renglón de diez.
func TestVeinteRetirosALaVez(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, _ := e.pedido(t, "PED-1006", "listo", nil)
	var wg sync.WaitGroup
	var mu sync.Mutex
	numeros := map[string]bool{}
	salieron, rechazos := 0, 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			doc := "30111222"
			r, err := e.s.CrearEntrega(context.Background(), ses, FormRemito{OrderID: pedido, Tipo: "retiro", ReceptorDocumento: &doc,
				Lineas: []LineaAEntregar{{r1, 1}}})
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if !strings.Contains(err.Error(), "quedan 0") {
					t.Errorf("error inesperado: %v", err)
				}
				rechazos++
				return
			}
			if numeros[r.Numero] {
				t.Errorf("número repetido: %s", r.Numero)
			}
			numeros[r.Numero] = true
			salieron++
		}()
	}
	wg.Wait()
	var entregado string
	_ = e.pool.QueryRow(context.Background(), `select coalesce(sum(cantidad), 0)::text from delivery_items`).Scan(&entregado)
	q, _ := e.stock(t, e.variante)
	if salieron != 10 || rechazos != 10 || entregado != "10.00" || q != "90.000" {
		t.Fatalf("salieron %d remitos (%d rechazados), %s entregado, stock %s", salieron, rechazos, entregado, q)
	}
}

// La misma anulación veinte veces a la vez: la mercadería vuelve una vez.
func TestAnulacionesALaVez(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, _ := e.pedido(t, "PED-1007", "listo", nil)
	doc := "30111222"
	r, err := e.s.CrearEntrega(context.Background(), ses, FormRemito{OrderID: pedido, Tipo: "retiro", ReceptorDocumento: &doc,
		Lineas: []LineaAEntregar{{r1, 6}}})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := e.s.AnularEntrega(context.Background(), ses, r.ID); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	var devoluciones int
	_ = e.pool.QueryRow(context.Background(), `select count(*) from inventory_movements where type = 'devolucion'`).Scan(&devoluciones)
	if q, _ := e.stock(t, e.variante); q != "100.000" || devoluciones != 1 {
		t.Fatalf("stock %s con %d devoluciones", q, devoluciones)
	}
}

// La misma firma veinte veces a la vez: una sola pasa.
func TestFirmasALaVez(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, _ := e.pedido(t, "PED-1008", "listo", nil)
	doc := "30111222"
	r, err := e.s.CrearEntrega(context.Background(), ses, FormRemito{OrderID: pedido, Tipo: "retiro", ReceptorDocumento: &doc,
		Lineas: []LineaAEntregar{{r1, 1}}})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	pasaron := 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			f, err := e.s.RegistrarFirma(context.Background(), FormFirma{Token: r.FirmaToken, ReceptorNombre: "Juan Pérez",
				Firma: "data:image/png;base64,AAAA"}, nil)
			if err != nil {
				t.Error(err)
				return
			}
			if f != nil {
				mu.Lock()
				pasaron++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if pasaron != 1 {
		t.Fatalf("pasaron %d firmas", pasaron)
	}
	// Un aviso para firmar al preparar, y una sola constancia.
	if n := e.uno(t, `select count(*)::text from trabajos where tipo = 'remito.para-firmar' and carga->>'deliveryId' = $1`, r.ID); n != "1" {
		t.Errorf("avisos para firmar: %s", n)
	}
	if n := e.uno(t, `select count(*)::text from trabajos where tipo = 'remito.firmado' and carga->>'deliveryId' = $1`, r.ID); n != "1" {
		t.Errorf("constancias encoladas: %s", n)
	}
}

func TestZonasDeEnvio(t *testing.T) {
	e := armar(t)
	adm, _ := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	u := e.srv.URL + "/api/v1/admin/envios"
	if c, _ := pedir(t, ven, "GET", u, nil); c != 403 {
		t.Errorf("el vendedor leyó las zonas: %d", c)
	}
	if c, b := pedir(t, adm, "GET", u, nil); c != 200 || b != "[]\n" {
		t.Errorf("sin zonas: %d %s", c, b)
	}
	alta := map[string]any{"nombre": " Centro ", "cobertura": "", "demoraEstimada": "", "aCotizar": false, "costo": "18.000",
		"envioGratisDesde": "300.000,50", "orden": "2", "activa": true}
	if c, b := pedir(t, adm, "POST", u, alta); c != 200 || !strings.Contains(b, "Zona guardada.") {
		t.Fatalf("alta: %d %s", c, b)
	}
	c, b := pedir(t, adm, "GET", u, nil)
	zonas := leer[[]ZonaDeEnvio](t, b)
	if c != 200 || len(zonas) != 1 || zonas[0].Nombre != "Centro" || zonas[0].Costo != "18000.00" || zonas[0].EnvioGratisDesde != "300000.50" ||
		zonas[0].Orden != "2" || zonas[0].DemoraEstimada != nil {
		t.Fatalf("zonas: %d %s", c, b)
	}
	edicion := map[string]any{"id": zonas[0].ID, "nombre": "Centro", "aCotizar": true, "costo": "-5", "activa": false}
	if c, b := pedir(t, adm, "POST", u, edicion); c != 200 {
		t.Fatalf("edición: %d %s", c, b)
	}
	var detalle, desc string
	_ = e.pool.QueryRow(context.Background(), `select detalle, descripcion from audit_log where accion = 'editar' and entidad = 'zona_envio'`).Scan(&detalle, &desc)
	if desc != `Zona de envío "Centro": flete a cotizar` ||
		detalle != `{"nombre":"Centro","cobertura":"","demoraEstimada":null,"aCotizar":true,"costo":"0.00","envioGratisDesde":"0.00","orden":"0","activa":false}` {
		t.Errorf("bitácora: %s %s", desc, detalle)
	}
	for _, caso := range []struct {
		cuerpo map[string]any
		msj    string
	}{
		{map[string]any{"nombre": "  "}, "Poné el nombre de la zona."},
		{map[string]any{"nombre": "Sur", "costo": "-1"}, "El costo no puede ser negativo."},
		{map[string]any{"nombre": "Sur", "costo": "10.000.000.000"}, "El costo es demasiado grande."},
		{map[string]any{"nombre": "Sur", "orden": "12345"}, "El orden tiene que ser un número de hasta cuatro cifras."},
		{map[string]any{"id": "x", "nombre": "Sur"}, "Invalid UUID"},
	} {
		if c, b := pedir(t, adm, "POST", u, caso.cuerpo); c != 422 || !strings.Contains(b, caso.msj) {
			t.Errorf("%v: %d %s", caso.cuerpo, c, b)
		}
	}
}

// Las listas vacías salen como [] y no como null.
func TestListasVaciasDeEntregas(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, _, _ := e.pedido(t, "PED-1009", "listo", nil)
	for _, ruta := range []string{"admin/pedidos/" + pedido + "/remitos", "admin/pedidos/no-es-un-id/acopio", "admin/pedidos/no-es-un-id/remitos"} {
		if c, b := pedir(t, ven, "GET", e.srv.URL+"/api/v1/"+ruta, nil); c != 200 || b != "[]\n" {
			t.Errorf("%s: %d %s", ruta, c, b)
		}
	}
	if c, _ := pedir(t, interno, "GET", e.srv.URL+"/api/v1/remitos/no-es-un-id", nil); c != 404 {
		t.Errorf("remito inexistente: %d", c)
	}
}
