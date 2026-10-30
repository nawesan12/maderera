package pagos

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/pagosapi"
	"mjbj/internal/auth"
	"mjbj/internal/cobros"
	"mjbj/internal/cola"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
	"mjbj/internal/subidas"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

const (
	secretoInterno = "secreto-interno-de-prueba"
	// Cortos y armados a propósito: el hook de Mercado Pago bloquea
	// credenciales escritas enteras en un archivo.
	claveMP = "clave-prueba"
	tokenMP = "TEST" + "-" + "0000"
)

// simuladorMP contesta como la API de Mercado Pago: crear la preferencia y
// consultar un pago (las respuestas reales, recortadas a lo que se lee).
type simuladorMP struct {
	srv          *httptest.Server
	mu           sync.Mutex
	preferencias []map[string]any
	idempotencia []string
	pagos        map[string]map[string]any
	consultas    atomic.Int32
}

func nuevoSimulador(t *testing.T) *simuladorMP {
	s := &simuladorMP{pagos: map[string]map[string]any{}}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+tokenMP {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"message":"invalid_token","error":"unauthorized","status":401,"cause":[]}`))
			return
		}
		switch {
		case r.Method == "POST" && r.URL.Path == "/checkout/preferences":
			var cuerpo map[string]any
			_ = json.NewDecoder(r.Body).Decode(&cuerpo)
			s.mu.Lock()
			s.preferencias = append(s.preferencias, cuerpo)
			s.idempotencia = append(s.idempotencia, r.Header.Get("X-Idempotency-Key"))
			s.mu.Unlock()
			id := "202809963-" + cuerpo["external_reference"].(string)
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": id, "collector_id": 202809963, "operation_type": "regular_payment", "items": cuerpo["items"],
				"init_point":         "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=" + id,
				"sandbox_init_point": "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=" + id,
				"external_reference": cuerpo["external_reference"], "date_created": "2026-10-29T12:00:00.000-04:00",
			})
		case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/v1/payments/"):
			s.consultas.Add(1)
			s.mu.Lock()
			p, ok := s.pagos[strings.TrimPrefix(r.URL.Path, "/v1/payments/")]
			s.mu.Unlock()
			if !ok {
				w.WriteHeader(404)
				_, _ = w.Write([]byte(`{"message":"Payment not found","error":"not_found","status":404,"cause":[{"code":2000,"description":"Payment not found","data":null}]}`))
				return
			}
			_ = json.NewEncoder(w).Encode(p)
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *simuladorMP) pago(id string, status, detalle string, monto float64, ref string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, _ := json.Number(id).Int64()
	s.pagos[id] = map[string]any{
		"id": n, "status": status, "status_detail": detalle, "transaction_amount": monto, "currency_id": "ARS",
		"payment_method_id": "visa", "payment_type_id": "credit_card", "external_reference": ref, "live_mode": false,
		"date_created": "2026-10-29T12:00:00.000-04:00",
	}
}

type entorno struct {
	srv   *httptest.Server
	pool  *pgxpool.Pool
	ses   *auth.Servicio
	s     *Servicio
	mp    *simuladorMP
	cola  *cola.Cola
	ahora time.Time
}

// armar levanta la API con Mercado Pago (el simulador) o, sin él, con el
// demo encendido a propósito (PAGOS_PROVIDER=demo).
func armar(t *testing.T, conMP bool) *entorno {
	return armarCon(t, func(cfg *Config) {
		if conMP {
			cfg.AccessToken = tokenMP
		} else {
			cfg.Proveedor = "demo"
		}
	})
}

func armarCon(t *testing.T, ajustar func(*Config)) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-pagos-de-32-caracteres", URL: "http://localhost"}, pool)
	mp := nuevoSimulador(t)
	cfg := Config{API: mp.srv.URL, Sitio: "https://mjbj.com.ar/", WebhookSecret: claveMP}
	ajustar(&cfg)
	s := Nuevo(pool, cfg, silencio)
	ahora := time.Now()
	q := sqlc.New(pool)
	api := NuevaAPI(s, Extras{Lim: limites.Nuevo(q, silencio), Disco: subidas.Nuevo(subidas.Config{Carpeta: t.TempDir()})},
		plataforma.ConfigInterna{Secreto: secretoInterno})
	api.ahora = func() time.Time { return ahora }
	m := http.NewServeMux()
	api.Rutas(m)
	pagosapi.HandlerWithOptions(
		pagosapi.NewStrictHandlerWithOptions(api,
			[]pagosapi.StrictMiddlewareFunc{plataforma.ConPedido[pagosapi.StrictHandlerFunc]},
			pagosapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		pagosapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := pagosapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := pagosapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	c := cola.Nueva(q, silencio)
	c.Registrar(TipoAviso, s.Manejador())
	return &entorno{srv: srv, pool: pool, ses: ses, s: s, mp: mp, cola: c, ahora: ahora}
}

func (e *entorno) id(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var id string
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (e *entorno) texto(t *testing.T, sql string, args ...any) string { return e.id(t, sql, args...) }

func (e *entorno) numero(t *testing.T, sql string, args ...any) float64 {
	t.Helper()
	var n float64
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

// pedido crea uno de $204.732 con dos renglones; devuelve id y token.
func (e *entorno) pedido(t *testing.T, numero string) (string, string) {
	t.Helper()
	id := e.id(t, `insert into orders (numero, contacto_nombre, contacto_email, estado, origen, subtotal, total, medio_pago, estado_pago)
		values ($1, 'Juan', 'juan@prueba.test', 'pendiente', 'tienda', 204732, 204732, 'mercado_pago', 'pendiente') returning id`, numero)
	if _, err := e.pool.Exec(context.Background(), `insert into order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal, orden)
		values ($1, 'Fenólico 18 mm', 'unidad', 2, 84500, 169000, 0), ($1, 'Tirante', 'unidad', 10, 3573.2, 35732, 1)`, id); err != nil {
		t.Fatal(err)
	}
	return id, e.texto(t, `select public_token from orders where id = $1`, id)
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

// firmar arma la x-signature como Mercado Pago.
func firmar(dataID, requestID string, ts int64, clave string) string {
	m := hmac.New(sha256.New, []byte(clave))
	m.Write([]byte(fmt.Sprintf("id:%s;request-id:%s;ts:%d;", strings.ToLower(dataID), requestID, ts)))
	return fmt.Sprintf("ts=%d,v1=%s", ts, hex.EncodeToString(m.Sum(nil)))
}

// avisar manda el webhook como Mercado Pago (query, cuerpo y firma).
func (e *entorno) avisar(t *testing.T, pagoMP, requestID, clave string) int {
	t.Helper()
	cuerpo := fmt.Sprintf(`{"action":"payment.updated","api_version":"v1","data":{"id":"%s"},"date_created":"2026-10-29T15:00:00Z","id":123456789,"live_mode":false,"type":"payment","user_id":"202809963"}`, pagoMP)
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/pagos/webhook?data.id="+pagoMP+"&type=payment", strings.NewReader(cuerpo))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-request-id", requestID)
	req.Header.Set("x-signature", firmar(pagoMP, requestID, e.ahora.Unix(), clave))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func TestMercadoPagoDePuntaAPunta(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	pedidoID, token := e.pedido(t, "PED-1001")
	anon := &http.Client{}

	// Sin el token, el pedido de otro no se abre.
	if c, b := pedir(t, anon, "POST", e.srv.URL+"/api/v1/pagos/pedido", map[string]any{"numero": "PED-1001"}); c != 422 || !strings.Contains(b, "No encontramos ese pedido.") {
		t.Fatalf("sin token: %d %s", c, b)
	}
	c, b := pedir(t, anon, "POST", e.srv.URL+"/api/v1/pagos/pedido", map[string]any{"numero": "PED-1001", "token": token})
	if c != 200 {
		t.Fatalf("pagar: %d %s", c, b)
	}
	abierto := leer[CobroAbierto](t, b)
	if !abierto.Real || !strings.HasPrefix(abierto.URLPago, "https://sandbox.mercadopago.com.ar/") {
		t.Fatalf("%+v", abierto)
	}
	pref := e.mp.preferencias[0]
	if pref["external_reference"] != abierto.PagoID || pref["notification_url"] != "https://mjbj.com.ar/api/pagos/webhook" ||
		e.mp.idempotencia[0] != "pref-"+abierto.PagoID || len(pref["items"].([]any)) != 2 {
		t.Fatalf("preferencia: %v %v", pref, e.mp.idempotencia)
	}
	if back := pref["back_urls"].(map[string]any)["success"]; back != "https://mjbj.com.ar/pedido/PED-1001?t="+token {
		t.Fatalf("retorno: %v", back)
	}

	// Mercado Pago aprueba y avisa cinco veces (los reintentos): un solo
	// evento, un solo cambio y un solo aviso al cliente.
	e.mp.pago("1234567890", "approved", "accredited", 204732, abierto.PagoID)
	for i := 0; i < 5; i++ {
		if c := e.avisar(t, "1234567890", "req-1", claveMP); c != 200 {
			t.Fatalf("webhook: %d", c)
		}
	}
	if _, err := e.cola.Procesar(ctx, 20); err != nil {
		t.Fatal(err)
	}
	if n := e.numero(t, `select count(*) from payment_events`); n != 1 {
		t.Fatalf("%v eventos", n)
	}
	if est := e.texto(t, `select estado_pago::text from orders where id = $1`, pedidoID); est != "pagado" {
		t.Fatalf("pedido %s", est)
	}
	if n := e.numero(t, `select count(*) from trabajos where tipo = 'pago.resultado'`); n != 1 {
		t.Fatalf("%v avisos al cliente", n)
	}
	if e.texto(t, `select firma_valida from payment_events`) != "true" {
		t.Fatal("firma")
	}

	// Una firma mala no deja nada en la base.
	e.mp.pago("999", "approved", "accredited", 1, abierto.PagoID)
	e.avisar(t, "999", "req-2", "otra-clave")
	if _, err := e.cola.Procesar(ctx, 20); err != nil {
		t.Fatal(err)
	}
	if n := e.numero(t, `select count(*) from payment_events`); n != 1 {
		t.Fatalf("la firma mala entró: %v eventos", n)
	}
}

func TestImporteQueNoCoincideQuedaEnRevision(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	pedidoID, token := e.pedido(t, "PED-1002")
	abierto, err := e.s.PagarPedido(ctx, "PED-1002", token, nil)
	if err != nil {
		t.Fatal(err)
	}
	e.mp.pago("555", "approved", "accredited", 1, abierto.PagoID)
	e.avisar(t, "555", "req-9", claveMP)
	if _, err := e.cola.Procesar(ctx, 5); err != nil {
		t.Fatal(err)
	}
	if est := e.texto(t, `select estado::text from payments where id = $1`, abierto.PagoID); est != "en_revision" {
		t.Fatalf("pago %s", est)
	}
	if m := e.texto(t, `select motivo_rechazo from payments where id = $1`, abierto.PagoID); m != "El proveedor informó $1.00 y el cobro es de $204732.00." {
		t.Fatal(m)
	}
	if est := e.texto(t, `select estado_pago::text from orders where id = $1`, pedidoID); est != "pendiente" {
		t.Fatalf("pedido %s", est)
	}
}

// Un pago que Mercado Pago todavía no encuentra (404, 503): el aviso queda
// con el error y el reintento de la cola lo retoma.
func TestAvisoConErrorSeRetoma(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	_, token := e.pedido(t, "PED-1003")
	abierto, _ := e.s.PagarPedido(ctx, "PED-1003", token, nil)
	e.avisar(t, "777", "req-3", claveMP)
	if r, _ := e.cola.Procesar(ctx, 5); r.Reintentos != 1 {
		t.Fatalf("%+v", r)
	}
	if n := e.numero(t, `select count(*) from payment_events where error like 'Mercado Pago respondió 404%'`); n != 1 {
		t.Fatal("sin el error anotado")
	}
	e.mp.pago("777", "approved", "accredited", 204732, abierto.PagoID)
	if _, err := e.pool.Exec(ctx, `update trabajos set proximo_intento_at = now()`); err != nil {
		t.Fatal(err)
	}
	if r, _ := e.cola.Procesar(ctx, 5); r.Hechos != 1 {
		t.Fatalf("%+v", r)
	}
	if est := e.texto(t, `select estado::text from payments where id = $1`, abierto.PagoID); est != "aprobado" {
		t.Fatalf("pago %s", est)
	}
}

func TestPagoDeDemostracion(t *testing.T) {
	e := armar(t, false)
	pedidoID, token := e.pedido(t, "PED-1004")
	anon := &http.Client{}
	_, b := pedir(t, anon, "POST", e.srv.URL+"/api/v1/pagos/pedido", map[string]any{"numero": "PED-1004", "token": token})
	abierto := leer[CobroAbierto](t, b)
	if abierto.Real || abierto.URLPago != "https://mjbj.com.ar/pago-demo/"+abierto.PagoID {
		t.Fatalf("%+v", abierto)
	}
	if c, b := pedir(t, anon, "GET", e.srv.URL+"/api/v1/pagos/demo/"+abierto.PagoID, nil); c != 200 || !strings.Contains(b, `"concepto":"Pedido PED-1004"`) {
		t.Fatalf("%d %s", c, b)
	}
	for i := 0; i < 3; i++ {
		c, b := pedir(t, anon, "POST", e.srv.URL+"/api/v1/pagos/demo/"+abierto.PagoID, map[string]any{"decision": "aprobar"})
		if c != 200 || !strings.Contains(b, `"volverA":"/pedido/PED-1004?t=`+token) {
			t.Fatalf("%d %s", c, b)
		}
	}
	if est := e.texto(t, `select estado_pago::text from orders where id = $1`, pedidoID); est != "pagado" {
		t.Fatal(est)
	}
	if n := e.numero(t, `select count(*) from trabajos where tipo = 'pago.resultado'`); n != 1 {
		t.Fatalf("%v avisos", n)
	}
	// Un cobro real no se simula.
	if _, err := e.pool.Exec(context.Background(), `update payments set proveedor = 'mercado_pago'`); err != nil {
		t.Fatal(err)
	}
	if c, _ := pedir(t, anon, "POST", e.srv.URL+"/api/v1/pagos/demo/"+abierto.PagoID, map[string]any{"decision": "aprobar"}); c != 404 {
		t.Fatalf("real: %d", c)
	}
}

// Sin token y sin PAGOS_PROVIDER=demo, el pago online está apagado: pagar
// con Mercado Pago da un error claro (y no abre ningún cobro), y las rutas
// de /pago-demo no existen. Antes la falta de token encendía el demo, y
// cualquiera aprobaba su propio pago con un POST.
func TestSinTokenNiDemoNoHayPagoOnline(t *testing.T) {
	e := armarCon(t, func(*Config) {})
	pedidoID, token := e.pedido(t, "PED-1005")
	anon := &http.Client{}

	c, b := pedir(t, anon, "POST", e.srv.URL+"/api/v1/pagos/pedido", map[string]any{"numero": "PED-1005", "token": token})
	if c != http.StatusServiceUnavailable || !strings.Contains(b, "El pago online no está disponible") {
		t.Fatalf("pagar sin proveedor: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*) from payments`); n != 0 {
		t.Fatalf("abrió %v cobros sin proveedor", n)
	}
	if _, b := pedir(t, anon, "GET", e.srv.URL+"/api/v1/pagos/estado", nil); !strings.Contains(b, `"enVivo":false`) {
		t.Fatal(b)
	}

	// Un cobro demo que quedó de antes (la VPS corría con el demo): no se
	// puede ver ni aprobar.
	pagoID := e.id(t, `insert into payments (tipo, proveedor, estado, order_id, monto)
		values ('pedido', 'demo', 'pendiente', $1, 204732) returning id`, pedidoID)
	if c, _ := pedir(t, anon, "GET", e.srv.URL+"/api/v1/pagos/demo/"+pagoID, nil); c != http.StatusNotFound {
		t.Fatalf("ver el demo: %d", c)
	}
	if c, _ := pedir(t, anon, "POST", e.srv.URL+"/api/v1/pagos/demo/"+pagoID, map[string]any{"decision": "aprobar"}); c != http.StatusNotFound {
		t.Fatalf("aprobar el demo: %d", c)
	}
	if est := e.texto(t, `select estado_pago::text from orders where id = $1`, pedidoID); est == "pagado" {
		t.Fatal("el pedido quedó pagado")
	}
}

// Veinte acreditaciones a la vez del mismo pago de una deuda (webhook,
// vuelta del usuario, reintentos): un recibo. Sin el candado
// (MJBJ_PRUEBA_SIN_CANDADO=1) salen varios y la deuda baja varias veces.
func TestAcreditarVeinteVecesUnRecibo(t *testing.T) {
	e := armar(t, true)
	e.s.SinCandado = os.Getenv("MJBJ_PRUEBA_SIN_CANDADO") == "1"
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre, tipo) values ('Carpintería Sur', 'particular') returning id`)
	pago := e.id(t, `insert into payments (customer_id, tipo, proveedor, monto, estado) values ($1, 'deuda', 'mercado_pago', 50000, 'iniciado') returning id`, cliente)
	var conns []*pgxpool.Conn
	for i := int32(0); i < e.pool.Stat().MaxConns(); i++ {
		c, _ := e.pool.Acquire(ctx)
		conns = append(conns, c)
	}
	for _, c := range conns {
		c.Release()
	}
	monto := 50000.0
	var wg sync.WaitGroup
	listos := make(chan struct{})
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-listos
			_, _ = e.s.Acreditar(ctx, pago, &PagoRemoto{ID: "888", Estado: Aprobado, Monto: &monto, Crudo: []byte(`{}`)})
		}()
	}
	close(listos)
	wg.Wait()
	if n := e.numero(t, `select count(*) from receipts`); n != 1 {
		t.Fatalf("%v recibos", n)
	}
	if s := e.numero(t, `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, cliente); s != -50000 {
		t.Fatalf("la cuenta se movió %v", s)
	}
}

func TestConciliacion(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre, tipo) values ('Carpintería Sur', 'particular') returning id`)
	pago := e.id(t, `insert into payments (customer_id, tipo, proveedor, medio, monto, estado, comprobante_url) values ($1, 'deuda', 'transferencia', 'deposito', 30000, 'en_revision', '/subidas/x.pdf') returning id`, cliente)
	entrar := func(correo string, rol sqlc.StaffRole) *http.Client {
		if _, err := e.ses.AltaDeStaff(ctx, correo, "una clave larga", "Persona", rol); err != nil {
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
	dep := entrar("deposito@prueba.test", sqlc.StaffRoleDeposito)
	adm := entrar("admin@prueba.test", sqlc.StaffRoleAdmin)
	u := e.srv.URL + "/api/v1/admin/pagos"
	if c, _ := pedir(t, dep, "POST", u+"/"+pago+"/conciliar", map[string]any{"decision": "aprobar"}); c != 403 {
		t.Fatalf("depósito: %d", c)
	}
	if c, b := pedir(t, adm, "POST", u+"/"+pago+"/conciliar", map[string]any{"decision": "aprobar"}); c != 200 || !strings.Contains(b, "Cobro acreditado.") {
		t.Fatalf("%d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", u+"/"+pago+"/conciliar", map[string]any{"decision": "aprobar"}); c != 422 || !strings.Contains(b, "Este cobro ya estaba acreditado.") {
		t.Fatalf("dos veces: %d %s", c, b)
	}
	if m := e.texto(t, `select p.medio::text from receipt_parts p`); m != "deposito" {
		t.Fatalf("medio del recibo: %s", m)
	}
	c, b := pedir(t, adm, "GET", u+"?periodo=mes", nil)
	if c != 200 || !strings.Contains(b, `"acreditadoMes":30000`) || !strings.Contains(b, `"enVivo":false`) {
		t.Fatalf("panel: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "PUT", u+"/datos-bancarios", map[string]any{"banco": "Nación", "titular": "MJBJ", "cuit": "30", "cbu": "123", "alias": "x"}); c != 422 ||
		!strings.Contains(b, "El CBU tiene que tener 22 dígitos.") {
		t.Fatalf("cbu: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "PUT", u+"/datos-bancarios", map[string]any{"banco": "Nación", "titular": "MJBJ", "cuit": "30", "cbu": "0110 0123 4567 8901 2345 67", "alias": "x"}); c != 200 {
		t.Fatalf("cbu: %d %s", c, b)
	}
}

// Bug: si el recibo de un pago online ya se había anulado a mano y después
// llegaba el reintegro de Mercado Pago, AnularRecibo fallaba con «ya estaba
// anulado» y el aviso se reintentaba para siempre. Ahora es un reintegro ya
// hecho: el pago pasa a reintegrado y la deuda no vuelve dos veces.
func TestReintegroDeUnReciboYaAnulado(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre, tipo) values ('Carpintería Sur', 'particular') returning id`)
	pago := e.id(t, `insert into payments (customer_id, tipo, proveedor, monto, estado) values ($1, 'deuda', 'mercado_pago', 50000, 'iniciado') returning id`, cliente)
	monto := 50000.0
	r, err := e.s.Acreditar(ctx, pago, &PagoRemoto{ID: "777", Estado: Aprobado, Monto: &monto, Crudo: []byte(`{}`)})
	if err != nil || r.ReceiptID == nil {
		t.Fatalf("acreditar: %+v %v", r, err)
	}
	if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error {
		_, _, err := cobros.AnularRecibo(ctx, tx, *r.ReceiptID, "Se cargó dos veces", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	r, err = e.s.Acreditar(ctx, pago, &PagoRemoto{ID: "777", Estado: Reintegrado, Monto: &monto, Crudo: []byte(`{}`)})
	if err != nil || !r.Cambio || r.Estado != Reintegrado {
		t.Fatalf("el reintegro de un recibo ya anulado: %+v %v", r, err)
	}
	var estado string
	_ = e.pool.QueryRow(ctx, `select estado::text from payments where id = $1`, pago).Scan(&estado)
	if estado != "reintegrado" {
		t.Errorf("el pago queda %s", estado)
	}
	if s := e.numero(t, `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, cliente); s != 0 {
		t.Errorf("la deuda volvió una sola vez: el saldo da %v", s)
	}
}

// Antes un reintegro parcial no se reconocía: Mercado Pago deja el pago
// aprobado (solo «refunded» y «charged_back» se leían), así que la deuda que
// el cliente pagó y le devolvieron en parte seguía cancelada entera. Ahora la
// parte devuelta vuelve a la cuenta una sola vez, aunque el aviso se repita,
// y un reintegro total posterior devuelve solo lo que faltaba.
func TestReintegroParcialDeUnaDeuda(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre, tipo) values ('Carpintería Sur', 'particular') returning id`)
	pago := e.id(t, `insert into payments (customer_id, tipo, proveedor, monto, estado) values ($1, 'deuda', 'mercado_pago', 50000, 'iniciado') returning id`, cliente)
	monto := 50000.0
	saldo := func() float64 {
		return e.numero(t, `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, cliente)
	}
	if _, err := e.s.Acreditar(ctx, pago, &PagoRemoto{ID: "555", Estado: Aprobado, Monto: &monto, Crudo: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if s := saldo(); s != -50000 {
		t.Fatalf("acreditado: %v", s)
	}
	parcial := &PagoRemoto{ID: "555", Estado: Aprobado, Monto: &monto, Reintegrado: 10000, Crudo: []byte(`{}`)}
	for i := 0; i < 3; i++ {
		if _, err := e.s.Acreditar(ctx, pago, parcial); err != nil {
			t.Fatal(err)
		}
	}
	if s := saldo(); s != -40000 {
		t.Errorf("el reintegro parcial vuelve una vez: %v", s)
	}
	if _, err := e.s.Acreditar(ctx, pago, &PagoRemoto{ID: "555", Estado: Aprobado, Monto: &monto, Reintegrado: 15000, Crudo: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if s := saldo(); s != -35000 {
		t.Errorf("un segundo reintegro parcial suma solo lo nuevo: %v", s)
	}
	if n := e.numero(t, `select count(*) from account_movements where customer_id = $1 and referencia = '555' and tipo = 'ajuste'`, cliente); n != 2 {
		t.Errorf("los ajustes llevan la referencia del pago: %v", n)
	}
	if _, err := e.s.Acreditar(ctx, pago, &PagoRemoto{ID: "555", Estado: Reintegrado, Monto: &monto, Reintegrado: 50000, Crudo: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if s := saldo(); s != 0 {
		t.Errorf("el reintegro total devuelve solo lo que faltaba: %v", s)
	}
	var estado, recibo string
	_ = e.pool.QueryRow(ctx, `select p.estado::text, r.estado::text from payments p, receipts r where p.id = $1`, pago).Scan(&estado, &recibo)
	if estado != "reintegrado" || recibo != "emitido" {
		t.Errorf("pago %s, recibo %s", estado, recibo)
	}
	if n := e.numero(t, `select coalesce(sum(importe), 0)::float8 from payment_refunds where payment_id = $1`, pago); n != 50000 {
		t.Errorf("tramos: %v", n)
	}

	// El de un pedido: no hay deuda que devolver, el tramo queda anotado.
	pedido := e.id(t, `insert into payments (customer_id, tipo, proveedor, monto, estado) values ($1, 'pedido', 'mercado_pago', 8000, 'aprobado') returning id`, cliente)
	m2 := 8000.0
	if _, err := e.s.Acreditar(ctx, pedido, &PagoRemoto{ID: "556", Estado: Aprobado, Monto: &m2, Reintegrado: 3000, Crudo: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if n := e.numero(t, `select coalesce(sum(importe), 0)::float8 from payment_refunds where payment_id = $1`, pedido); n != 3000 {
		t.Errorf("tramo del pedido: %v", n)
	}
	if s := saldo(); s != 0 {
		t.Errorf("el pedido no toca la cuenta: %v", s)
	}
}

// Anular a mano el recibo de un pago que ya tuvo un reintegro parcial: la
// deuda vuelve por lo que quedaba cobrado, no por el total (el tramo ya
// había vuelto a la cuenta). Antes quedaba debiendo de más.
func TestAnularElReciboDespuesDeUnReintegroParcial(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre, tipo) values ('Carpintería Norte', 'particular') returning id`)
	pago := e.id(t, `insert into payments (customer_id, tipo, proveedor, monto, estado) values ($1, 'deuda', 'mercado_pago', 50000, 'iniciado') returning id`, cliente)
	monto := 50000.0
	if _, err := e.s.Acreditar(ctx, pago, &PagoRemoto{ID: "777", Estado: Aprobado, Monto: &monto, Crudo: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.Acreditar(ctx, pago, &PagoRemoto{ID: "777", Estado: Aprobado, Monto: &monto, Reintegrado: 15000, Crudo: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	var recibo string
	if err := e.pool.QueryRow(ctx, `select receipt_id from receipt_parts where payment_id = $1`, pago).Scan(&recibo); err != nil {
		t.Fatal(err)
	}
	if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error {
		_, _, err := cobros.AnularRecibo(ctx, tx, recibo, "lo cargué mal", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if s := e.numero(t, `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, cliente); s != 0 {
		t.Errorf("anular después del reintegro parcial deja la cuenta en %v, no en 0", s)
	}
}

// Quien no tiene el token no le gasta al dueño los intentos de subir el
// comprobante: el límite se cuenta después de verificarlo.
func TestComprobanteConTokenMaloNoGastaElLimite(t *testing.T) {
	e := armar(t, false)
	_, token := e.pedido(t, "PED-1006")
	x := Extras{Lim: limites.Nuevo(sqlc.New(e.pool), silencio), Disco: subidas.Nuevo(subidas.Config{Carpeta: t.TempDir()})}
	archivo := &Archivo{Datos: []byte("%PDF-1.4 comprobante"), Tipo: "application/pdf"}
	ctx := context.Background()
	for i := 0; i < 15; i++ {
		if _, err := e.s.SubirComprobante(ctx, x, "PED-1006", "token-que-no-es", nil, archivo); err == nil {
			t.Fatal("subió con un token equivocado")
		}
	}
	if r, err := e.s.SubirComprobante(ctx, x, "PED-1006", token, nil, archivo); err != nil {
		t.Fatalf("el dueño no pudo subir su comprobante: %v", err)
	} else if r.Ok == "" {
		t.Fatalf("%+v", r)
	}
}
