package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/whatsappapi"
	"mjbj/internal/auth"
	"mjbj/internal/cola"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

const (
	secretoInterno     = "secreto-interno-de-prueba"
	verificacionPrueba = "verificacion-de-prueba"
)

type entorno struct {
	srv  *httptest.Server
	pool *pgxpool.Pool
	ses  *auth.Servicio
	wa   *Servicio
	cola *cola.Cola
	sim  *simulador
	ctx  context.Context
}

// armar levanta la API de WhatsApp contra una base nueva. Con simulador, el
// proveedor es la Cloud API hablando con él; sin, el de demostración.
func armar(t *testing.T, conSimulador bool) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-whatsapp-de-32-caracteres", URL: "http://localhost"}, pool)
	cfg := Config{CarpetaPrivada: t.TempDir(), CarpetaSubidas: t.TempDir(), URLBase: "https://mjbj.com.ar"}
	cfg.WebhookSecret = verificacionPrueba
	var sim *simulador
	if conSimulador {
		sim = nuevoSimulador(t)
		cfg.PhoneNumberID, cfg.AccessToken, cfg.WabaID, cfg.AppSecret, cfg.GraphURL = pnidPrueba, tokenPrueba, wabaPrueba, secretoPrueba, sim.srv.URL
	} else {
		cfg.AppSecret = secretoPrueba
	}
	wa := Nuevo(pool, cfg, nil, silencio)
	wa.espera = 10 * time.Millisecond
	m := http.NewServeMux()
	wa.Rutas(m)
	whatsappapi.HandlerWithOptions(
		whatsappapi.NewStrictHandlerWithOptions(NuevaAPI(wa, plataforma.ConfigInterna{Secreto: secretoInterno}),
			[]whatsappapi.StrictMiddlewareFunc{plataforma.ConPedido[whatsappapi.StrictHandlerFunc]},
			whatsappapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		whatsappapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := whatsappapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := whatsappapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	c := cola.Nueva(sqlc.New(pool), silencio)
	wa.Registrar(c)
	if sim != nil {
		sim.app = srv.URL + "/api/whatsapp/webhook"
	}
	return &entorno{srv: srv, pool: pool, ses: ses, wa: wa, cola: c, sim: sim, ctx: context.Background()}
}

func (e *entorno) staff(t *testing.T, correo string, rol sqlc.StaffRole) *http.Client {
	t.Helper()
	if _, err := e.ses.AltaDeStaff(e.ctx, correo, "una clave larga", "Vera Vendedora", rol); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	if _, err := e.ses.Entrar(e.ctx, w, correo, "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u.URL, w.Result().Cookies())
	return &http.Client{Jar: jar}
}

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

func multipartCon(campos map[string]string, archivo []byte, nombre, tipo string) (*bytes.Buffer, string) {
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	for k, v := range campos {
		_ = w.WriteField(k, v)
	}
	if archivo != nil {
		h := make(map[string][]string)
		h["Content-Disposition"] = []string{`form-data; name="archivo"; filename="` + nombre + `"`}
		h["Content-Type"] = []string{tipo}
		p, _ := w.CreatePart(h)
		_, _ = p.Write(archivo)
	}
	_ = w.Close()
	return &b, w.FormDataContentType()
}

func (e *entorno) procesar(t *testing.T) cola.Resultado {
	t.Helper()
	r, err := e.cola.Procesar(e.ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func (e *entorno) uno(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var v *string
	if err := e.pool.QueryRow(e.ctx, sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if v == nil {
		return "<nil>"
	}
	return *v
}

func leer[T any](t *testing.T, b string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(b), &v); err != nil {
		t.Fatalf("%v: %s", err, b)
	}
	return v
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func esperar(t *testing.T, cond func() bool) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("no pasó a tiempo")
}

// TestIdaYVueltaConElSimulador es el criterio de terminado de la tanda: un
// cliente escribe, la bandeja lo ve, se le contesta, Meta avisa los estados,
// el gasto se cuenta, llegan una foto y un «BAJA», y lo que pasa fuera de la
// ventana y con el tope.
func TestIdaYVueltaConElSimulador(t *testing.T) {
	e := armar(t, true)
	vendedora := e.staff(t, "vera@prueba.test", sqlc.StaffRoleVendedor)
	u := e.srv.URL + "/api/v1/admin/whatsapp/"
	cliente := e.uno(t, `insert into customers (nombre, telefono) values ('Marta Gómez', '(0223) 15-555-0123') returning id::text`)

	// 1. Meta verifica la URL del webhook (la de siempre).
	c, b := pedir(t, http.DefaultClient, "GET", e.srv.URL+"/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token="+verificacionPrueba+"&hub.challenge=1158201444", nil)
	if c != 200 || b != "1158201444" {
		t.Fatalf("verificación: %d %s", c, b)
	}
	if c, _ := pedir(t, http.DefaultClient, "GET", e.srv.URL+"/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1", nil); c != 403 {
		t.Errorf("verificación con otro token: %d", c)
	}

	// 2. Escribe Marta. Con otra firma, 401 y nada en la cola.
	hola := mensajeDeCliente(pnidPrueba, "5492235550123", "Marta", "wamid.HOLA", "text", map[string]any{"text": map[string]any{"body": "Hola, ¿tienen fenólico de 18?"}})
	if c := e.sim.aLaApp(hola, "otro-secreto"); c != 401 {
		t.Fatalf("firma mala: %d", c)
	}
	if c := e.sim.aLaApp(hola, secretoPrueba); c != 200 {
		t.Fatalf("webhook: %d", c)
	}
	// Meta reintenta: el mismo mensaje otra vez.
	if c := e.sim.aLaApp(hola, secretoPrueba); c != 200 {
		t.Fatalf("webhook repetido: %d", c)
	}
	if r := e.procesar(t); r.Hechos != 2 || r.Fallidos+r.Reintentos != 0 {
		t.Fatalf("cola: %+v", r)
	}
	if n := e.uno(t, `select count(*)::text from whatsapp_mensajes`); n != "1" {
		t.Fatalf("el repetido entró dos veces: %s", n)
	}
	conv := e.uno(t, `select id::text from whatsapp_conversaciones where wa_jid = '5492235550123@s.whatsapp.net'`)
	if got := e.uno(t, `select customer_id::text from whatsapp_conversaciones where id = $1`, conv); got != cliente {
		t.Errorf("no se vinculó con la ficha: %s", got)
	}

	// 3. La vendedora abre la bandeja: ve la conversación, con la ventana abierta.
	c, b = pedir(t, vendedora, "GET", u+"bandeja", nil)
	if c != 200 {
		t.Fatalf("bandeja: %d %s", c, b)
	}
	bandeja := leer[Bandeja](t, b)
	if len(bandeja.Conversaciones) != 1 || bandeja.Detalle == nil || bandeja.Detalle.Nombre != "Marta Gómez" || !bandeja.Detalle.VentanaAbierta ||
		len(bandeja.Detalle.Mensajes) != 1 || bandeja.Contadores.SinLeer != 1 || bandeja.Estado.Proveedor != "cloud" {
		t.Fatalf("bandeja: %s", b)
	}
	// Abrirla es haberla leído: no leídos en cero y los tildes azules en Meta.
	esperar(t, func() bool {
		return e.uno(t, `select no_leidos::text from whatsapp_conversaciones where id = $1`, conv) == "0"
	})
	esperar(t, func() bool {
		m := e.sim.ultimoEnviado()
		return m != nil && m["status"] == "read" && m["message_id"] == "wamid.HOLA"
	})

	// 4. Le contesta. Sale por la Graph API con el texto.
	c, b = pedir(t, vendedora, "POST", u+"conversaciones/"+conv+"/responder", map[string]any{"cuerpo": "  Sí, Marta: hay de 18 mm.  "})
	if c != 200 || strings.Contains(b, "error") {
		t.Fatalf("responder: %d %s", c, b)
	}
	enviado := e.sim.ultimoEnviado()
	if enviado["to"] != "5492235550123" || enviado["type"] != "text" || enviado["text"].(map[string]any)["body"] != "Sí, Marta: hay de 18 mm." {
		t.Fatalf("lo que llegó a Meta: %v", enviado)
	}
	msj := e.uno(t, `select estado::text || ' ' || wa_message_id from whatsapp_mensajes where direccion = 'saliente'`)
	if msj != "enviado "+enviado["id"].(string) {
		t.Fatalf("saliente: %s", msj)
	}

	// 5. Meta avisa sent, delivered y read, con el cobro: queda leído y cuenta en el gasto.
	if n := e.sim.avisarEstados(); n != 3 {
		t.Fatalf("estados: %d", n)
	}
	e.procesar(t)
	if got := e.uno(t, `select estado::text || ' ' || cobro_categoria || ' ' || cobrable::text from whatsapp_mensajes where direccion = 'saliente'`); got != "leido service true" {
		t.Fatalf("después de los estados: %s", got)
	}
	g, err := e.wa.GastoDelMes(e.ctx, time.Now())
	if err != nil || g.USD != 0.026 || g.PorCategoria["service"].Cobrados != 1 {
		t.Fatalf("gasto: %+v %v", g, err)
	}
	// Un «delivered» que llega tarde no pisa el «leído».
	e.sim.aLaApp(estadoMeta(pnidPrueba, enviado["id"].(string), "delivered", "5492235550123", "service"), secretoPrueba)
	e.procesar(t)
	if got := e.uno(t, `select estado::text from whatsapp_mensajes where direccion = 'saliente'`); got != "leido" {
		t.Errorf("el estado retrocedió: %s", got)
	}

	// 6. Marta manda una foto: se baja de Meta y se sirve solo con sesión.
	foto := mensajeDeCliente(pnidPrueba, "5492235550123", "Marta", "wamid.FOTO", "image", map[string]any{"image": map[string]any{
		"id": "1037543291543636", "mime_type": "image/png", "caption": "así quedó"}})
	e.sim.aLaApp(foto, secretoPrueba)
	e.procesar(t)
	idFoto := e.uno(t, `select id::text from whatsapp_mensajes where wa_message_id = 'wamid.FOTO'`)
	if got := e.uno(t, `select media_estado || ' ' || media_mime from whatsapp_mensajes where id = $1`, idFoto); got != "listo image/png" {
		t.Fatalf("la foto: %s", got)
	}
	if c, _ := pedir(t, http.DefaultClient, "GET", e.srv.URL+"/api/whatsapp/medios/"+idFoto, nil); c != 404 {
		t.Errorf("la foto sin sesión: %d", c)
	}
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/whatsapp/medios/"+idFoto, nil)
	res, err := vendedora.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	cuerpoFoto, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" || res.Header.Get("X-Content-Type-Options") != "nosniff" ||
		!bytes.Contains(cuerpoFoto, []byte("foto de la cocina")) {
		t.Errorf("la foto con sesión: %d %v", res.StatusCode, res.Header)
	}

	// 7. «BAJA»: queda registrada y se le confirma (sale aunque sea automático).
	baja := mensajeDeCliente(pnidPrueba, "5492235550123", "Marta", "wamid.BAJA", "text", map[string]any{"text": map[string]any{"body": "BAJA"}})
	e.sim.aLaApp(baja, secretoPrueba)
	e.procesar(t)
	if got := e.uno(t, `select baja_detalle from whatsapp_conversaciones where id = $1`, conv); got != "Escribió «BAJA»" {
		t.Errorf("baja: %s", got)
	}
	if got := e.uno(t, `select origen || ' ' || estado::text from whatsapp_mensajes where origen = 'sistema'`); got != "sistema enviado" {
		t.Errorf("la confirmación de la baja: %s", got)
	}
	e.sim.avisarEstados()
	e.procesar(t)

	// 8. Pasaron más de 24 h: texto libre no; plantilla sí.
	if _, err := e.pool.Exec(e.ctx, `update whatsapp_conversaciones set ultimo_entrante_at = now() - interval '2 days' where id = $1`, conv); err != nil {
		t.Fatal(err)
	}
	_, b = pedir(t, vendedora, "POST", u+"conversaciones/"+conv+"/responder", map[string]any{"cuerpo": "¿Seguís ahí?"})
	if r := leer[Resultado](t, b); !r.RequierePlantilla {
		t.Fatalf("fuera de la ventana: %s", b)
	}
	cuerpoForm, tipo := multipartCon(map[string]string{"plantilla": "pedido_listo", "valores": `{"cuerpo:nombre":"Marta","cuerpo:pedido":"PED-1207","cuerpo:sucursal":"Casa Central","cuerpo:horario":"de 8 a 16"}`}, nil, "", "")
	req, _ = http.NewRequest("POST", u+"conversaciones/"+conv+"/plantilla", cuerpoForm)
	req.Header.Set("Content-Type", tipo)
	res, _ = vendedora.Do(req)
	cuerpoRes, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if r := leer[Resultado](t, string(cuerpoRes)); r.Ok != "Mensaje enviado." {
		t.Fatalf("plantilla: %s", cuerpoRes)
	}
	enviado = e.sim.ultimoEnviado()
	tpl := enviado["template"].(map[string]any)
	if enviado["type"] != "template" || tpl["name"] != "pedido_listo" || !strings.Contains(mustJSON(tpl["components"]), `"parameter_name":"pedido","text":"PED-1207"`) {
		t.Fatalf("la plantilla en Meta: %v", enviado)
	}
	if got := e.uno(t, `select cuerpo from whatsapp_mensajes where plantilla = 'pedido_listo'`); !strings.Contains(got, "PED-1207") {
		t.Errorf("la burbuja de la plantilla: %s", got)
	}

	// 9. Meta rechaza un envío (131047): queda fallido con la explicación, y se reintenta.
	if _, err := e.pool.Exec(e.ctx, `update whatsapp_conversaciones set ultimo_entrante_at = now() where id = $1`, conv); err != nil {
		t.Fatal(err)
	}
	e.sim.mu.Lock()
	e.sim.proximoError = 131047
	e.sim.mu.Unlock()
	_, b = pedir(t, vendedora, "POST", u+"conversaciones/"+conv+"/responder", map[string]any{"cuerpo": "Te aviso cuando esté"})
	if r := leer[Resultado](t, b); !r.RequierePlantilla || !strings.Contains(r.Error, "24 horas") {
		t.Fatalf("131047: %s", b)
	}
	fallido := e.uno(t, `select id::text from whatsapp_mensajes where estado = 'fallido'`)
	if got := e.uno(t, `select error_codigo::text from whatsapp_mensajes where id = $1`, fallido); got != "131047" {
		t.Errorf("código del fallido: %s", got)
	}
	_, b = pedir(t, vendedora, "POST", u+"mensajes/"+fallido+"/reintentar", map[string]any{})
	if r := leer[Resultado](t, b); r.Ok != "Enviado." {
		t.Fatalf("reintento: %s", b)
	}
	if got := e.uno(t, `select estado::text from whatsapp_mensajes where id = $1`, fallido); got != "enviado" {
		t.Errorf("después del reintento: %s", got)
	}

	// 10. El tope del mes: con tope cero, la bandeja pide confirmar.
	if _, err := e.pool.Exec(e.ctx, `update whatsapp_sesion set tope_mensual_usd = 0`); err != nil {
		t.Fatal(err)
	}
	_, b = pedir(t, vendedora, "POST", u+"conversaciones/"+conv+"/responder", map[string]any{"cuerpo": "Otra cosa"})
	if r := leer[Resultado](t, b); !r.RequiereConfirmacionTope {
		t.Fatalf("tope: %s", b)
	}
	_, b = pedir(t, vendedora, "POST", u+"conversaciones/"+conv+"/responder", map[string]any{"cuerpo": "Otra cosa", "confirmarTope": true})
	if r := leer[Resultado](t, b); r.Error != "" {
		t.Fatalf("tope confirmado: %s", b)
	}

	// 11. El contrato de la conversación, entera.
	if c, b := pedir(t, vendedora, "GET", u+"conversaciones/"+conv, nil); c != 200 || !strings.Contains(b, `"mediaUrl":"/api/whatsapp/medios/`+idFoto+`"`) {
		t.Errorf("detalle: %d %s", c, b)
	}
}

// TestDemostracion: sin credenciales de Meta, todo se guarda y nada sale, y
// el simulador del panel entra por la misma ingesta que el webhook.
func TestDemostracion(t *testing.T) {
	e := armar(t, false)
	vendedora := e.staff(t, "vera@prueba.test", sqlc.StaffRoleVendedor)
	u := e.srv.URL + "/api/v1/admin/whatsapp/"
	_, b := pedir(t, vendedora, "POST", u+"conversaciones", map[string]any{"telefono": "223 590-3118"})
	r := leer[Resultado](t, b)
	if r.ConversacionID == "" {
		t.Fatalf("abrir: %s", b)
	}
	if _, b := pedir(t, vendedora, "POST", u+"conversaciones", map[string]any{"telefono": "123"}); !strings.Contains(b, "Escribí un número válido.") {
		t.Errorf("abrir con un número corto: %s", b)
	}
	// Fuera de la ventana (nunca escribió).
	_, b = pedir(t, vendedora, "POST", u+"conversaciones/"+r.ConversacionID+"/responder", map[string]any{"cuerpo": "hola"})
	if !leer[Resultado](t, b).RequierePlantilla {
		t.Fatalf("sin ventana: %s", b)
	}
	// El cliente «escribe» desde el simulador del panel.
	_, b = pedir(t, vendedora, "POST", u+"conversaciones/"+r.ConversacionID+"/simular", map[string]any{"cuerpo": "Hola, ¿abren el sábado?"})
	if leer[Resultado](t, b).Error != "" {
		t.Fatalf("simular: %s", b)
	}
	_, b = pedir(t, vendedora, "POST", u+"conversaciones/"+r.ConversacionID+"/responder", map[string]any{"cuerpo": "Sí, de 8 a 12."})
	if leer[Resultado](t, b).Error != "" {
		t.Fatalf("responder en demostración: %s", b)
	}
	if got := e.uno(t, `select wa_message_id from whatsapp_mensajes where direccion = 'saliente'`); !strings.HasPrefix(got, "demo-") {
		t.Errorf("en demostración el id es demo-: %s", got)
	}
	// Lo de la demostración no se cuenta en el gasto.
	if g, _ := e.wa.GastoDelMes(e.ctx, time.Now()); g.USD != 0 {
		t.Errorf("gasto en demostración: %v", g.USD)
	}
	_, b = pedir(t, vendedora, "GET", u+"bandeja?filtro=cerradas", nil)
	if bd := leer[Bandeja](t, b); bd.Filtro != "resueltas" || bd.Estado.Proveedor != "demo" || len(bd.Plantillas) != len(PlantillasBase) {
		t.Errorf("bandeja en demostración: %s", b)
	}
	// Resolver, asignar y la baja desde el panel.
	_, b = pedir(t, vendedora, "POST", u+"conversaciones/"+r.ConversacionID+"/asignar", map[string]any{"usuarioId": "yo"})
	if leer[Resultado](t, b).Ok != "Asignada." {
		t.Errorf("asignar: %s", b)
	}
	_, b = pedir(t, vendedora, "POST", u+"conversaciones/"+r.ConversacionID+"/estado", map[string]any{"estado": "cerrada"})
	if leer[Resultado](t, b).Ok != "Conversación resuelta." {
		t.Errorf("resolver: %s", b)
	}
	_, b = pedir(t, vendedora, "POST", u+"conversaciones/"+r.ConversacionID+"/baja", map[string]any{"baja": true})
	if leer[Resultado](t, b).Ok == "" || e.uno(t, `select baja_detalle from whatsapp_conversaciones`) != "La cargó Vera Vendedora desde el panel" {
		t.Errorf("baja: %s", b)
	}
	if e.uno(t, `select count(*)::text from audit_log where entidad = 'whatsapp'`) != "1" {
		t.Error("la baja no quedó en la bitácora")
	}
}

// TestPermisos: depósito no entra a la bandeja; la configuración es de admin;
// los avisos automáticos, solo con el secreto interno.
func TestPermisos(t *testing.T) {
	e := armar(t, false)
	deposito := e.staff(t, "dep@prueba.test", sqlc.StaffRoleDeposito)
	u := e.srv.URL + "/api/v1/"
	if c, _ := pedir(t, deposito, "GET", u+"admin/whatsapp/bandeja", nil); c != 403 {
		t.Errorf("depósito en la bandeja: %d", c)
	}
	if c, _ := pedir(t, http.DefaultClient, "GET", u+"admin/whatsapp/bandeja", nil); c != 401 {
		t.Errorf("sin sesión: %d", c)
	}
	vendedor := e.staff(t, "ven@prueba.test", sqlc.StaffRoleVendedor)
	if c, _ := pedir(t, vendedor, "GET", u+"admin/whatsapp/configuracion", nil); c != 403 {
		t.Errorf("vendedor en la configuración: %d", c)
	}
	adm := e.staff(t, "adm@prueba.test", sqlc.StaffRoleAdmin)
	c, b := pedir(t, adm, "GET", u+"admin/whatsapp/configuracion", nil)
	if c != 200 || len(leer[Configuracion](t, b).Avisos) != len(EventosWhatsapp) {
		t.Errorf("configuración: %d %s", c, b)
	}
	cuerpo, tipo := multipartCon(map[string]string{"datos": `{"evento":"listo","telefono":"2235550123"}`}, nil, "", "")
	req, _ := http.NewRequest("POST", u+"interno/whatsapp/aviso", cuerpo)
	req.Header.Set("Content-Type", tipo)
	if res, _ := adm.Do(req); res.StatusCode != 403 {
		t.Errorf("aviso sin el secreto: %d", res.StatusCode)
	}
}

func (e *entorno) avisoInterno(t *testing.T, datos map[string]any, pdf []byte) ResultadoAviso {
	t.Helper()
	campos := map[string]string{"datos": mustJSON(datos)}
	if pdf != nil {
		campos["archivoNombre"] = "recibo-1.pdf"
	}
	cuerpo, tipo := multipartCon(campos, pdf, "recibo-1.pdf", "application/pdf")
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/v1/interno/whatsapp/aviso", cuerpo)
	req.Header.Set("Content-Type", tipo)
	req.Header.Set("Authorization", "Bearer "+secretoInterno)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 {
		t.Fatalf("aviso: %d %s", res.StatusCode, b)
	}
	return leer[ResultadoAviso](t, string(b))
}

// TestAvisosAutomaticos: apagados no salen; prendidos y fuera de la ventana
// sale la plantilla con el PDF (pedido en dos pasos); lo avisado a mano no se
// repite; el tope los corta y queda en la bitácora.
func TestAvisosAutomaticos(t *testing.T) {
	e := armar(t, true)
	if err := e.wa.SembrarAvisos(e.ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := e.wa.SincronizarPlantillas(e.ctx); err != nil {
		t.Fatal(err)
	}
	recibo := "8f2b5c1e-1d2a-4c3b-9a8e-111111111111"
	datos := map[string]any{"evento": "recibo_emitido", "telefono": "223 555-0123", "nombre": "Marta Gómez",
		"valores": map[string]string{"importe": "$ 10.000", "recibo": "R-1", "saldo": "$ 0"}, "entidad": map[string]string{"tipo": "receipt", "id": recibo},
		"conDocumento": true}
	if r := e.avisoInterno(t, datos, nil); r.Estado != "omitida" || r.Detalle != "El aviso está apagado." {
		t.Fatalf("apagado: %+v", r)
	}
	if _, err := e.pool.Exec(e.ctx, `update whatsapp_avisos set activo = true where evento = 'recibo_emitido'`); err != nil {
		t.Fatal(err)
	}
	if r := e.avisoInterno(t, datos, nil); r.Estado != "falta-documento" {
		t.Fatalf("sin el PDF: %+v", r)
	}
	if r := e.avisoInterno(t, datos, []byte("%PDF-1.4 recibo")); r.Estado != "enviada" || r.Detalle != "Plantilla recibo_emitido." {
		t.Fatalf("con el PDF: %+v", r)
	}
	enviado := e.sim.ultimoEnviado()
	if enviado["type"] != "template" || !strings.Contains(mustJSON(enviado), `"document":{"filename":"recibo-1.pdf","id":"77`) ||
		!strings.Contains(mustJSON(enviado), `"text":"Marta"`) {
		t.Fatalf("en Meta: %s", mustJSON(enviado))
	}
	// Ya se avisó a mano: no se repite.
	if _, err := e.pool.Exec(e.ctx, `insert into notifications_log (canal, evento, destinatario, entidad_tipo, entidad_id, estado)
		values ('whatsapp_manual', 'recibo_emitido', '-', 'receipt', $1, 'enviada')`, recibo); err != nil {
		t.Fatal(err)
	}
	if r := e.avisoInterno(t, datos, nil); r.Estado != "omitida" || !strings.Contains(r.Detalle, "a mano") {
		t.Fatalf("avisado a mano: %+v", r)
	}
	// El tope: los automáticos dejan de salir y queda el motivo.
	if _, err := e.pool.Exec(e.ctx, `insert into whatsapp_sesion (tope_mensual_usd) values (0)`); err != nil {
		t.Fatal(err)
	}
	datos["entidad"] = map[string]string{"tipo": "receipt", "id": "8f2b5c1e-1d2a-4c3b-9a8e-222222222222"}
	if r := e.avisoInterno(t, datos, nil); r.Estado != "omitida" || r.Detalle != MotivoTope {
		t.Fatalf("tope: %+v", r)
	}
	if n := e.uno(t, `select count(*)::text from notifications_log where canal = 'whatsapp' and error = $1`, MotivoTope); n != "1" {
		t.Errorf("bitácora del tope: %s", n)
	}
}

// TestEstadoAntesQueElMensaje: Meta puede avisar «sent» antes de que el envío
// guarde su id. Se reintenta por la cola, y al final se aplica.
func TestEstadoAntesQueElMensaje(t *testing.T) {
	e := armar(t, true)
	e.sim.aLaApp(estadoMeta(pnidPrueba, "wamid.TARDE", "delivered", "5492235550123", "utility"), secretoPrueba)
	e.procesar(t)
	if n := e.uno(t, `select count(*)::text from trabajos where tipo = 'whatsapp.estado' and estado = 'pendiente'`); n != "1" {
		t.Fatalf("no quedó en la cola: %s", n)
	}
	conv, err := e.wa.ConversacionDe(e.ctx, "5492235550123@s.whatsapp.net", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(e.ctx, `insert into whatsapp_mensajes (conversacion_id, direccion, wa_message_id, estado) values ($1, 'saliente', 'wamid.TARDE', 'enviado')`, conv.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(e.ctx, `update trabajos set proximo_intento_at = now() where tipo = 'whatsapp.estado'`); err != nil {
		t.Fatal(err)
	}
	e.procesar(t)
	if got := e.uno(t, `select estado::text || ' ' || cobro_categoria from whatsapp_mensajes where wa_message_id = 'wamid.TARDE'`); got != "entregado utility" {
		t.Errorf("el estado tardío: %s", got)
	}
}

// TestCoexistencia: lo que el personal escribe desde el teléfono entra como
// saliente sin cobro y sin abrir la ventana; el historial no avisa ni suma.
func TestCoexistencia(t *testing.T) {
	e := armar(t, true)
	eco := envolverPayload(pnidPrueba, "smb_message_echoes", map[string]any{"message_echoes": []any{map[string]any{
		"from": "5492235903118", "to": "5492235550123", "id": "wamid.ECO", "timestamp": "1760000000", "type": "text", "text": map[string]any{"body": "Sí, abrimos"}}}})
	historial := envolverPayload(pnidPrueba, "history", map[string]any{"history": []any{map[string]any{
		"metadata": map[string]any{"phase": 0, "chunk_order": 1, "progress": 100},
		"threads": []any{map[string]any{"id": "5492235550999", "messages": []any{
			map[string]any{"from": "5492235550999", "id": "wamid.H1", "timestamp": "1750000000", "type": "text", "text": map[string]any{"body": "¿Tienen MDF?"}},
			map[string]any{"from": "5492235903118", "id": "wamid.H2", "timestamp": "1750000100", "type": "text", "text": map[string]any{"body": "Sí"},
				"history_context": map[string]any{"status": "READ"}},
		}}},
	}}})
	e.sim.aLaApp(eco, secretoPrueba)
	e.sim.aLaApp(historial, secretoPrueba)
	e.procesar(t)
	if got := e.uno(t, `select origen || ' ' || cobrable::text || ' ' || estado::text from whatsapp_mensajes where wa_message_id = 'wamid.ECO'`); got != "telefono false enviado" {
		t.Errorf("eco: %s", got)
	}
	if got := e.uno(t, `select coalesce(ultimo_entrante_at::text, 'sin ventana') from whatsapp_conversaciones where wa_jid = '5492235550123@s.whatsapp.net'`); got != "sin ventana" {
		t.Errorf("el eco abrió la ventana: %s", got)
	}
	if got := e.uno(t, `select string_agg(direccion::text || ':' || estado::text || ':' || importado::text, ',' order by ocurrido_at) from whatsapp_mensajes where wa_message_id like 'wamid.H%'`); got != "entrante:entregado:true,saliente:leido:true" {
		t.Errorf("historial: %s", got)
	}
	if got := e.uno(t, `select no_leidos::text || ' ' || ultimo_mensaje_preview from whatsapp_conversaciones where wa_jid = '5492235550999@s.whatsapp.net'`); got != "0 Sí" {
		t.Errorf("la conversación del historial: %s", got)
	}
}

// TestAvisoManual: el botón gratis arma el texto de la plantilla, con el
// enlace de seguimiento del pedido, y registra quién avisó (una sola vez).
func TestAvisoManual(t *testing.T) {
	e := armar(t, false)
	vendedora := e.staff(t, "vera@prueba.test", sqlc.StaffRoleVendedor)
	cliente := e.uno(t, `insert into customers (nombre, telefono) values ('Marta Gómez', '223 555-0123') returning id::text`)
	suc := e.uno(t, `insert into branches (slug, name, sort_order) values ('casa-central', 'Casa Central', 1) returning id::text`)
	pedido := e.uno(t, `insert into orders (numero, customer_id, branch_id, estado, subtotal, total, contacto_nombre, contacto_telefono)
		values ('PED-1207', $1, $2, 'listo', 100, 100, 'Marta', '') returning id::text`, cliente, suc)
	u := e.srv.URL + "/api/v1/admin/whatsapp/"
	c, b := pedir(t, vendedora, "GET", u+"avisos-manuales?evento=listo&tipo=order&ids="+pedido+",no-es-un-id", nil)
	avisos := leer[map[string]AvisoManualListo](t, b)
	a, hay := avisos[pedido]
	if c != 200 || !hay || len(avisos) != 1 || !strings.Contains(a.Texto, "PED-1207") || !strings.Contains(a.Texto, "https://mjbj.com.ar/pedido/PED-1207?t=") ||
		a.Href == nil || !strings.HasPrefix(*a.Href, "https://wa.me/5492235550123?text=") || a.YaAvisado {
		t.Fatalf("aviso manual: %d %s", c, b)
	}
	for range 2 {
		_, b = pedir(t, vendedora, "POST", u+"avisos-manuales/registro", map[string]any{"evento": "listo", "entidadTipo": "order", "entidadId": pedido, "telefono": "223 555-0123"})
		if leer[Resultado](t, b).Ok == "" {
			t.Fatalf("registro: %s", b)
		}
	}
	if n := e.uno(t, `select count(*)::text || ' ' || min(destinatario) from notifications_log where canal = 'whatsapp_manual'`); n != "1 5492235550123" {
		t.Errorf("el doble clic dejó dos filas: %s", n)
	}
	_, b = pedir(t, vendedora, "GET", u+"avisos-manuales?evento=listo&tipo=order&ids="+pedido, nil)
	if a := leer[map[string]AvisoManualListo](t, b)[pedido]; !a.YaAvisado || len(a.Historia) != 1 || !strings.Contains(a.Historia[0].Texto, "por Vera") {
		t.Errorf("después de avisar: %s", b)
	}
}

// TestEnviarArchivo: la foto que sube la bandeja sale por id y queda una
// copia privada; un «JPG» que no lo es va como documento.
func TestEnviarArchivo(t *testing.T) {
	e := armar(t, true)
	vendedora := e.staff(t, "vera@prueba.test", sqlc.StaffRoleVendedor)
	e.sim.aLaApp(mensajeDeCliente(pnidPrueba, "5492235550123", "Marta", "wamid.X", "text", map[string]any{"text": map[string]any{"body": "Mandame la foto"}}), secretoPrueba)
	e.procesar(t)
	conv := e.uno(t, `select id::text from whatsapp_conversaciones`)
	mandar := func(contenido []byte, tipo string) (int, string) {
		cuerpo, ct := multipartCon(map[string]string{"conversacionId": conv, "epigrafe": "  así quedó  "}, contenido, "mueble.jpg", tipo)
		req, _ := http.NewRequest("POST", e.srv.URL+"/api/whatsapp/enviar-archivo", cuerpo)
		req.Header.Set("Content-Type", ct)
		res, err := vendedora.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}
	if c, b := mandar([]byte("\xff\xd8\xff\xe0 un jpg"), "image/jpeg"); c != 200 || !strings.Contains(b, `"ok":true`) {
		t.Fatalf("foto: %d %s", c, b)
	}
	if m := e.sim.ultimoEnviado(); m["type"] != "image" || m["image"].(map[string]any)["caption"] != "así quedó" {
		t.Fatalf("foto en Meta: %v", m)
	}
	if c, _ := mandar([]byte("no es un jpg"), "image/jpeg"); c != 200 {
		t.Fatalf("falso jpg: %d", c)
	}
	if m := e.sim.ultimoEnviado(); m["type"] != "document" {
		t.Errorf("el falso jpg salió como %v", m["type"])
	}
	if got := e.uno(t, `select count(*)::text from whatsapp_mensajes where media_url like 'privado:%' and media_estado = 'listo'`); got != "2" {
		t.Errorf("copias privadas: %s", got)
	}
}
