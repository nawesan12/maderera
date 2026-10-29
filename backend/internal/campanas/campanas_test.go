package campanas

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/campanasapi"
	"mjbj/internal/auth"
	"mjbj/internal/avisos"
	"mjbj/internal/email"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/push"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

// buzon es un proveedor de correo de prueba: «real» (las campañas salen) y
// guarda lo que manda. Con temporalDesde, desde ese mensaje rechaza
// temporalmente (el tope de Hostinger).
type buzon struct {
	mu            sync.Mutex
	mensajes      []email.Mensaje
	temporalDesde int
	falla         map[string]bool
}

func (*buzon) Nombre() string { return "smtp" }
func (*buzon) Real() bool     { return true }
func (b *buzon) Enviar(_ context.Context, m email.Mensaje) email.Resultado {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.temporalDesde > 0 && len(b.mensajes)+1 >= b.temporalDesde {
		return email.Resultado{Error: "451 4.7.0 demasiados mensajes", Temporal: true}
	}
	if b.falla[m.Para] {
		b.mensajes = append(b.mensajes, m)
		return email.Resultado{Error: "550 no existe esa casilla"}
	}
	b.mensajes = append(b.mensajes, m)
	return email.Resultado{Enviado: true, ID: "<id@prueba>"}
}

func (b *buzon) para() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []string
	for _, m := range b.mensajes {
		out = append(out, m.Para)
	}
	return out
}

const secreto = "secreto-de-prueba-de-campanas-de-32-caracteres"

type entorno struct {
	srv   *httptest.Server
	pool  *pgxpool.Pool
	ses   *auth.Servicio
	s     *Servicio
	av    *avisos.Servicio
	buzon *buzon
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: secreto, URL: "http://localhost"}, pool)
	b := &buzon{falla: map[string]bool{}}
	av := push.Nuevo(push.Config{}, sqlc.New(pool), silencio)
	s := Nuevo(pool, Config{Sitio: "https://mjbj.com.ar", Secreto: secreto, PorMinuto: "2"}, b, av, silencio)
	avs := avisos.Nuevo(pool, b, "Maderera <pedidos@mjbj.com.ar>", silencio)
	a := NuevaAPI(s, avs, av, "")
	m := http.NewServeMux()
	a.Registrar(m)
	campanasapi.HandlerWithOptions(
		campanasapi.NewStrictHandlerWithOptions(a,
			[]campanasapi.StrictMiddlewareFunc{plataforma.ConPedido[campanasapi.StrictHandlerFunc]},
			campanasapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		campanasapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := campanasapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := campanasapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	return &entorno{srv: srv, pool: pool, ses: ses, s: s, av: avs, buzon: b}
}

func (e *entorno) staff(t *testing.T, correo string, rol sqlc.StaffRole) *http.Client {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeStaff(ctx, correo, "una clave larga", "Ana Admin", rol); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	if _, err := e.ses.Entrar(ctx, w, correo, "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	u, _ := url.Parse(e.srv.URL)
	jar.SetCookies(u, w.Result().Cookies())
	return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func pedir(t *testing.T, c *http.Client, metodo, ruta string, cuerpo any) (int, map[string]any) {
	t.Helper()
	var r io.Reader
	if cuerpo != nil {
		b, _ := json.Marshal(cuerpo)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(metodo, ruta, r)
	if cuerpo != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var m map[string]any
	if len(b) > 0 && b[0] == '{' {
		_ = json.Unmarshal(b, &m)
	} else {
		m = map[string]any{"_crudo": string(b)}
	}
	return resp.StatusCode, m
}

func (e *entorno) cliente(t *testing.T, nombre, correo, tipo string, activo bool) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), `insert into customers (nombre, email, tipo, active) values ($1, $2, $3::tipo_cliente, $4)`,
		nombre, correo, tipo, activo); err != nil {
		t.Fatal(err)
	}
}

func primerError(m map[string]any) string {
	if es, ok := m["errores"].(map[string]any); ok {
		for _, v := range es {
			return v.(string)
		}
	}
	d, _ := m["detail"].(string)
	return d
}

func (e *entorno) procesarCola(t *testing.T) int {
	t.Helper()
	ctx := context.Background()
	n := 0
	for {
		var id string
		var carga []byte
		err := e.pool.QueryRow(ctx, `update trabajos set estado = 'procesando', intentos = intentos + 1
			where id = (select id from trabajos where tipo = 'campana.tanda' and estado = 'pendiente' and proximo_intento_at <= now() order by proximo_intento_at limit 1)
			returning id, carga`).Scan(&id, &carga)
		if err != nil {
			return n
		}
		if err := e.s.ManejadorTanda()(ctx, carga); err != nil {
			t.Fatal(err)
		}
		if _, err := e.pool.Exec(ctx, `update trabajos set estado = 'hecho' where id = $1`, id); err != nil {
			t.Fatal(err)
		}
		n++
	}
}

func TestCampanaDePuntaAPunta(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	ctx := context.Background()

	e.cliente(t, "Arq. Juan Pérez", "juan@prueba.test", "profesional", true)
	e.cliente(t, "Juan otra ficha", "JUAN@prueba.test", "profesional", true) // la misma dirección
	e.cliente(t, "Ana Gómez", "ana@prueba.test", "particular", true)
	e.cliente(t, "Beto", "beto@prueba.test", "particular", true)
	e.cliente(t, "Inactivo", "inactivo@prueba.test", "particular", false)
	e.cliente(t, "Sin correo", "no-es-un-correo", "particular", true)
	e.cliente(t, "Caro", "caro@prueba.test", "particular", true)
	if err := e.s.DarDeBaja(ctx, "  CARO@prueba.test ", "panel"); err != nil {
		t.Fatal(err)
	}

	// Solo el admin.
	if st, _ := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/campanas", nil); st != http.StatusForbidden {
		t.Fatalf("el vendedor entró a campañas: %d", st)
	}

	// El alcance: direcciones distintas, sin bajas, sin inactivos ni direcciones rotas.
	st, al := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas/alcance", map[string]any{"tipo": "todos", "rubros": []string{}})
	if st != 200 || al["cantidad"] != 3.0 || al["descripcion"] != "Todos los clientes con correo" || al["porMinuto"] != 2.0 {
		t.Fatalf("alcance: %d %v", st, al)
	}
	_, al = pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas/alcance", map[string]any{"tipo": "profesional", "actividad": "compraron", "meses": "6"})
	if al["cantidad"] != 0.0 || al["descripcion"] != "Profesionales que compraron en los últimos 6 meses con correo" {
		t.Fatalf("alcance con actividad: %v", al)
	}

	// Validación como zod.
	st, p := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas", map[string]any{"asunto": "ab", "cuerpo": "Hola a todos"})
	if st != 422 || primerError(p) != "Falta el asunto." {
		t.Fatalf("validación: %d %v", st, p)
	}
	st, p = pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas", map[string]any{"asunto": "Ofertas", "cuerpo": "Hola a todos", "botonTexto": "Ver"})
	if st != 422 || primerError(p) != "El botón necesita a dónde lleva." {
		t.Fatalf("botón sin destino: %d %v", st, p)
	}

	form := map[string]any{"asunto": "Ofertas de noviembre", "cuerpo": "Hola\n\n- Pino\n- Fenólico", "botonTexto": "Ver", "botonUrl": "/catalogo",
		"tipo": "todos", "rubros": []string{}, "actividad": "", "meses": "6"}
	st, p = pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas", form)
	if st != 200 || p["id"] == nil {
		t.Fatalf("guardar: %d %v", st, p)
	}
	id := p["id"].(string)

	// La vista previa lleva el saludo de quien la arma y el enlace de baja.
	_, vp := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas/vista-previa", form)
	if html, _ := vp["html"].(string); !strings.Contains(html, "Ana") || !strings.Contains(html, "https://mjbj.com.ar/baja?e=") {
		t.Fatalf("vista previa: %v", vp)
	}

	// La prueba va a la casilla de quien la arma.
	st, p = pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas/prueba", form)
	if st != 200 || p["ok"] != "Te la mandamos a admin@prueba.test." || len(e.buzon.mensajes) != 1 || !strings.HasPrefix(e.buzon.mensajes[0].Asunto, "[Prueba] ") {
		t.Fatalf("prueba: %d %v %v", st, p, e.buzon.para())
	}
	e.buzon.mensajes = nil

	// Programar: la fecha tiene que ser futura y válida.
	if st, p = pedir(t, adm, "PUT", e.srv.URL+"/api/v1/admin/campanas/"+id+"/programacion", map[string]string{"cuando": "2020-01-01T10:00"}); st != 422 || p["detail"] != "Para mandarla ahora, usá «Enviar ahora»." {
		t.Fatalf("programar en el pasado: %d %v", st, p)
	}
	if st, p = pedir(t, adm, "PUT", e.srv.URL+"/api/v1/admin/campanas/"+id+"/programacion", map[string]string{"cuando": "mañana"}); st != 422 || p["detail"] != "La fecha no es válida." {
		t.Fatalf("programar sin fecha: %d %v", st, p)
	}

	// Enviar: congela la lista y encola la primera tanda.
	st, p = pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas/"+id+"/envio", nil)
	if st != 200 || p["ok"] != "Saliendo a 3 direcciones." {
		t.Fatalf("enviar: %d %v", st, p)
	}
	if st, p = pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas/"+id+"/envio", nil); st != 422 || p["detail"] != "Esa campaña ya se está enviando o ya se envió." {
		t.Fatalf("enviar dos veces: %d %v", st, p)
	}
	// Ya no se edita.
	form["id"] = id
	if st, p = pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas", form); st != 422 || p["detail"] != "Esa campaña ya se envió: no se puede editar. Podés duplicarla." {
		t.Fatalf("editar una enviada: %d %v", st, p)
	}

	// Ana se da de baja entre que se armó la lista y le tocó el turno.
	if err := e.s.DarDeBaja(ctx, "ana@prueba.test", "enlace"); err != nil {
		t.Fatal(err)
	}
	// Dos tandas de 2 (PorMinuto = 2): la segunda queda encolada para dentro de un minuto.
	if n := e.procesarCola(t); n != 1 {
		t.Fatalf("tandas procesadas: %d", n)
	}
	if _, err := e.pool.Exec(ctx, `update trabajos set proximo_intento_at = now() where tipo = 'campana.tanda' and estado = 'pendiente'`); err != nil {
		t.Fatal(err)
	}
	e.procesarCola(t)
	if got := strings.Join(e.buzon.para(), ","); got != "beto@prueba.test,juan@prueba.test" {
		t.Fatalf("salieron a: %s", got)
	}
	m := e.buzon.mensajes[1]
	if m.Cabeceras["List-Unsubscribe-Post"] != "List-Unsubscribe=One-Click" || !strings.HasPrefix(m.Cabeceras["List-Unsubscribe"], "<https://mjbj.com.ar/api/baja?e=") {
		t.Fatalf("cabeceras de baja: %v", m.Cabeceras)
	}
	if !strings.Contains(m.HTML, "Juan") || strings.Contains(m.HTML, "Arq.") {
		t.Fatalf("el saludo no saca el título: %s", m.HTML)
	}

	st, c := pedir(t, adm, "GET", e.srv.URL+"/api/v1/admin/campanas/"+id, nil)
	if st != 200 || c["estado"] != "enviada" || c["enviados"] != 2.0 || c["omitidos"] != 1.0 || c["pendientes"] != 0.0 || c["terminadaAt"] == nil ||
		!strings.Contains(c["muestra"].(string), "cliente@ejemplo.com") && !strings.Contains(c["muestra"].(string), "Cliente") {
		t.Fatalf("la campaña enviada: %d %v", st, c)
	}
	_, lista := pedir(t, adm, "GET", e.srv.URL+"/api/v1/admin/campanas", nil)
	_ = lista

	// Duplicar y borrar el borrador; lo enviado no se borra.
	st, p = pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas/"+id+"/copia", nil)
	if st != 200 || p["id"] == nil {
		t.Fatalf("duplicar: %d %v", st, p)
	}
	copia := p["id"].(string)
	if st, p = pedir(t, adm, "DELETE", e.srv.URL+"/api/v1/admin/campanas/"+id, nil); st != 422 {
		t.Fatalf("borrar una enviada: %d %v", st, p)
	}
	if st, p = pedir(t, adm, "DELETE", e.srv.URL+"/api/v1/admin/campanas/"+copia, nil); st != 200 || p["ok"] != "Borrador eliminado." {
		t.Fatalf("borrar el borrador: %d %v", st, p)
	}
	var bitacora int
	_ = e.pool.QueryRow(ctx, `select count(*) from audit_log where entidad = 'campana'`).Scan(&bitacora)
	if bitacora != 3 { // crear, enviar, borrar
		t.Fatalf("bitácora: %d líneas", bitacora)
	}
}

func TestTandaConRechazoTemporalYCancelacion(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ctx := context.Background()
	for _, c := range []string{"a", "b", "c", "d"} {
		e.cliente(t, c, c+"@prueba.test", "particular", true)
	}
	e.buzon.falla["b@prueba.test"] = true
	_, p := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas", map[string]any{"asunto": "Hola", "cuerpo": "Una campaña de prueba"})
	id := p["id"].(string)
	if st, p := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/campanas/"+id+"/envio", nil); st != 200 {
		t.Fatalf("enviar: %d %v", st, p)
	}
	e.procesarCola(t) // a: enviado, b: fallido
	_, f := pedir(t, adm, "GET", e.srv.URL+"/api/v1/admin/campanas/"+id+"/fallidos", nil)
	_ = f
	var fallidos int
	_ = e.pool.QueryRow(ctx, `select count(*) from campana_envios where campana_id = $1 and estado = 'fallido' and error like '550%'`, id).Scan(&fallidos)
	if fallidos != 1 {
		t.Fatalf("fallidos: %d", fallidos)
	}

	// El tope: c rebota temporalmente, queda pendiente, y la tanda se corta.
	e.buzon.temporalDesde = len(e.buzon.mensajes) + 1
	if _, err := e.pool.Exec(ctx, `update trabajos set proximo_intento_at = now() where tipo = 'campana.tanda' and estado = 'pendiente'`); err != nil {
		t.Fatal(err)
	}
	e.procesarCola(t)
	var pendientes int
	var espera float64
	_ = e.pool.QueryRow(ctx, `select count(*) from campana_envios where campana_id = $1 and estado = 'pendiente'`, id).Scan(&pendientes)
	_ = e.pool.QueryRow(ctx, `select extract(epoch from proximo_intento_at - now()) from trabajos where tipo = 'campana.tanda' and estado = 'pendiente'`).Scan(&espera)
	if pendientes != 2 || espera < 170 || espera > 181 {
		t.Fatalf("después del rechazo temporal: %d pendientes, la próxima en %.0f s", pendientes, espera)
	}

	// Cancelar: lo pendiente queda omitido y la tanda encolada no manda nada.
	st, p := pedir(t, adm, "DELETE", e.srv.URL+"/api/v1/admin/campanas/"+id+"/envio", nil)
	if st != 200 || p["ok"] != "Cancelada. 2 quedaron sin mandar." {
		t.Fatalf("cancelar: %d %v", st, p)
	}
	e.buzon.temporalDesde = 0
	antes := len(e.buzon.mensajes)
	if _, err := e.pool.Exec(ctx, `update trabajos set proximo_intento_at = now() where tipo = 'campana.tanda' and estado = 'pendiente'`); err != nil {
		t.Fatal(err)
	}
	e.procesarCola(t)
	if len(e.buzon.mensajes) != antes {
		t.Fatal("una campaña cancelada siguió mandando")
	}
	if st, p := pedir(t, adm, "DELETE", e.srv.URL+"/api/v1/admin/campanas/"+id+"/envio", nil); st != 422 || p["detail"] != "Esa campaña no se está enviando." {
		t.Fatalf("cancelar dos veces: %d %v", st, p)
	}
}

// Dos tandas de la misma campaña a la vez (un reintento que se superpone)
// nunca le mandan dos veces a la misma persona: FOR UPDATE SKIP LOCKED.
func TestTandasSimultaneasNoRepiten(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	for i := 0; i < 12; i++ {
		e.cliente(t, "c", "c"+string(rune('a'+i))+"@prueba.test", "particular", true)
	}
	var id string
	if err := e.pool.QueryRow(ctx, `insert into campanas (asunto, cuerpo, segmento) values ('Hola', 'Una campaña de prueba',
		'{"tipo":"todos","rubros":[],"actividad":null}') returning id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	// Las dos arrancan a la vez: una sola congela la lista.
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); _, errs[i] = e.s.IniciarEnvio(ctx, id) }()
	}
	wg.Wait()
	if (errs[0] == nil) == (errs[1] == nil) {
		t.Fatalf("arrancaron %v / %v", errs[0], errs[1])
	}
	for range 3 {
		wg.Add(4)
		for range 4 {
			go func() { defer wg.Done(); _ = e.s.ProcesarTanda(ctx, id) }()
		}
		wg.Wait()
	}
	vistos := map[string]int{}
	for _, p := range e.buzon.para() {
		vistos[p]++
		if vistos[p] > 1 {
			t.Fatalf("a %s le llegó dos veces", p)
		}
	}
	if len(vistos) != 12 {
		t.Fatalf("salieron %d de 12", len(vistos))
	}
}

func TestProgramadas(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	e.cliente(t, "a", "a@prueba.test", "particular", true)
	var lista, vacia string
	_ = e.pool.QueryRow(ctx, `insert into campanas (asunto, cuerpo, segmento, estado, programada_para) values ('Hola', 'Una campaña',
		'{"tipo":"todos","rubros":[],"actividad":null}', 'programada', now() - interval '1 minute') returning id`).Scan(&lista)
	_ = e.pool.QueryRow(ctx, `insert into campanas (asunto, cuerpo, segmento, estado, programada_para) values ('Hola', 'Una campaña',
		'{"tipo":"profesional","rubros":[],"actividad":null}', 'programada', now() - interval '1 minute') returning id`).Scan(&vacia)
	n, err := e.s.IniciarProgramadas(ctx)
	if err != nil || n != 1 {
		t.Fatalf("iniciadas: %d %v", n, err)
	}
	var estado string
	var programada *string
	_ = e.pool.QueryRow(ctx, `select estado::text, programada_para::text from campanas where id = $1`, vacia).Scan(&estado, &programada)
	if estado != "borrador" || programada != nil {
		t.Fatalf("la que no podía salir quedó %s %v", estado, programada)
	}
	var aviso string
	_ = e.pool.QueryRow(ctx, `select asunto from notifications_log where canal = 'push' and evento = 'campana-fallida'`).Scan(&aviso)
	if aviso != "Una campaña programada no salió" {
		t.Fatalf("aviso al panel: %q", aviso)
	}
}

func TestBajas(t *testing.T) {
	e := armar(t)
	anon := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	ev, tok := ParametrosDeBaja("Ana@Prueba.test", secreto)
	q := "e=" + ev + "&t=" + tok

	_, b := pedir(t, anon, "GET", e.srv.URL+"/api/v1/bajas?"+q, nil)
	if b["email"] != "ana@prueba.test" || b["dadoDeBaja"] != false {
		t.Fatalf("leer: %v", b)
	}
	if _, b = pedir(t, anon, "GET", e.srv.URL+"/api/v1/bajas?e="+ev+"&t=otra", nil); b["email"] != nil {
		t.Fatalf("un enlace trucho: %v", b)
	}

	// El GET de /api/baja no da de baja: lleva a la página.
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/baja?"+q, nil)
	resp, _ := anon.Do(req)
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther || resp.Header.Get("Location") != "/baja?"+q {
		t.Fatalf("GET /api/baja: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	if esta, _ := e.s.EstaDadoDeBaja(context.Background(), "ana@prueba.test"); esta {
		t.Fatal("un GET dio de baja")
	}

	// El POST (el botón de Gmail) sí.
	if st, r := pedir(t, anon, "POST", e.srv.URL+"/api/baja?e="+ev+"&t=mal", nil); st != 400 || r["_crudo"] != "Enlace inválido." {
		t.Fatalf("POST con firma mala: %d %v", st, r)
	}
	if st, r := pedir(t, anon, "POST", e.srv.URL+"/api/baja?"+q, nil); st != 200 || r["_crudo"] != "Listo: no vas a recibir más novedades." {
		t.Fatalf("POST: %d %v", st, r)
	}
	if _, b = pedir(t, anon, "GET", e.srv.URL+"/api/v1/bajas?"+q, nil); b["dadoDeBaja"] != true {
		t.Fatalf("después de la baja: %v", b)
	}
	// Volver a recibir, desde la página.
	if st, r := pedir(t, anon, "POST", e.srv.URL+"/api/v1/bajas", map[string]any{"e": ev, "t": tok, "recibir": true}); st != 200 {
		t.Fatalf("volver a recibir: %d %v", st, r)
	}
	if st, r := pedir(t, anon, "POST", e.srv.URL+"/api/v1/bajas", map[string]any{"e": ev, "t": "x", "recibir": false}); st != 422 || r["detail"] != "El enlace no es válido." {
		t.Fatalf("confirmar con firma mala: %d %v", st, r)
	}
	if esta, _ := e.s.EstaDadoDeBaja(context.Background(), "ana@prueba.test"); esta {
		t.Fatal("no volvió a recibir")
	}
}

func TestAvisos(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	ctx := context.Background()

	if st, _ := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/avisos", nil); st != http.StatusForbidden {
		t.Fatalf("el vendedor entró a avisos: %d", st)
	}
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/v1/admin/avisos", nil)
	resp, err := adm.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var lista []avisos.AvisoEmail
	_ = json.NewDecoder(resp.Body).Decode(&lista)
	resp.Body.Close()
	if len(lista) != 18 || lista[0].Evento != "presupuesto_recibido" || lista[len(lista)-1].Evento != "recibo_emitido" && lista[len(lista)-1].Evento != "cheque_rechazado" {
		t.Fatalf("lista sembrada: %d %+v", len(lista), lista)
	}
	var solicitud string
	for _, a := range lista {
		if a.Evento == "solicitud_profesional" {
			solicitud = a.ID
		}
	}

	if st, p := pedir(t, adm, "PUT", e.srv.URL+"/api/v1/admin/avisos/texto", map[string]any{"id": solicitud, "asunto": " ab "}); st != 422 || primerError(p) != "El asunto no puede quedar vacío." {
		t.Fatalf("texto corto: %d %v", st, p)
	}
	if st, p := pedir(t, adm, "PUT", e.srv.URL+"/api/v1/admin/avisos/texto", map[string]any{"id": solicitud, "asunto": "Nos llegó tu pedido", "encabezado": ""}); st != 200 || p["ok"] != "Texto guardado." {
		t.Fatalf("texto: %d %v", st, p)
	}
	// El asunto editado manda.
	e.av.Despachar(ctx, avisos.Despacho{Evento: "solicitud_profesional", Para: "ana@prueba.test", Correo: avisos.Correo{Asunto: "Original", HTML: "<p>x</p>", Texto: "x"}})
	if n := len(e.buzon.mensajes); n != 1 || e.buzon.mensajes[0].Asunto != "Nos llegó tu pedido" {
		t.Fatalf("despacho con asunto editado: %+v", e.buzon.mensajes)
	}
	// Apagado: no sale, queda omitida.
	if st, p := pedir(t, adm, "PUT", e.srv.URL+"/api/v1/admin/avisos/activo", map[string]any{"id": solicitud, "activo": "no"}); st != 200 || p["ok"] != "Aviso apagado." {
		t.Fatalf("apagar: %d %v", st, p)
	}
	if st, p := pedir(t, adm, "PUT", e.srv.URL+"/api/v1/admin/avisos/activo", map[string]any{"id": "x", "activo": "no"}); st != 422 || p["detail"] != avisoPerdido {
		t.Fatalf("apagar sin id: %d %v", st, p)
	}
	e.av.Despachar(ctx, avisos.Despacho{Evento: "solicitud_profesional", Para: "ana@prueba.test", Correo: avisos.Correo{Asunto: "Original", HTML: "<p>x</p>", Texto: "x"}})
	if len(e.buzon.mensajes) != 1 {
		t.Fatal("salió un aviso apagado")
	}
	// Un evento sin fila sale igual; un rechazo temporal va a la cola.
	e.buzon.temporalDesde = 2
	e.av.Despachar(ctx, avisos.Despacho{Evento: "nuevo", Para: "ana@prueba.test", EntidadTipo: "prueba", EntidadID: "8f2b5c1e-1d2a-4c3b-9a8e-111111111111",
		Correo: avisos.Correo{Asunto: "Nuevo", HTML: "<p>x</p>", Texto: "x"}})
	var carga []byte
	if err := e.pool.QueryRow(ctx, `select carga from trabajos where tipo = 'email.reintento'`).Scan(&carga); err != nil {
		t.Fatalf("el reintento no se encoló: %v", err)
	}
	// El reintento: si vuelve a rebotar, falla (la cola espera más); si sale, se registra.
	if err := e.av.ManejadorReintento()(ctx, carga); err == nil {
		t.Fatal("un segundo rechazo temporal no falló")
	}
	e.buzon.temporalDesde = 0
	if err := e.av.ManejadorReintento()(ctx, carga); err != nil {
		t.Fatal(err)
	}

	_, enviados := pedir(t, adm, "GET", e.srv.URL+"/api/v1/admin/avisos/enviados?limite=10", nil)
	_ = enviados
	var estados []string
	filas, _ := e.pool.Query(ctx, `select estado::text || ':' || coalesce(error, '') from notifications_log where canal = 'email' order by created_at`)
	for filas.Next() {
		var s string
		_ = filas.Scan(&s)
		estados = append(estados, s)
	}
	filas.Close()
	want := "enviada:|omitida:El aviso está apagado en /admin/avisos.|fallida:Rechazo temporal, se reintenta: 451 4.7.0 demasiados mensajes|enviada:"
	if strings.Join(estados, "|") != want {
		t.Fatalf("bitácora de avisos:\n%s\n%s", strings.Join(estados, "|"), want)
	}

	// El estado del correo.
	if _, c := pedir(t, adm, "GET", e.srv.URL+"/api/v1/admin/avisos/correo", nil); c["enVivo"] != true || c["detalle"] != "Los correos salen por el servidor de correo propio." {
		t.Fatalf("estado del correo: %v", c)
	}

	// Push: cualquiera del panel suscribe su dispositivo; sin claves, la prueba avisa.
	if st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/push", map[string]any{"endpoint": "https://push.test/1", "p256dh": "k", "auth": "a"}); st != 200 {
		t.Fatalf("activar push: %d %v", st, p)
	}
	if st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/push", map[string]any{"endpoint": "https://push.test/1", "p256dh": "", "auth": "a"}); st != 422 || p["detail"] != "El navegador no devolvió una suscripción completa." {
		t.Fatalf("suscripción incompleta: %d %v", st, p)
	}
	if st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/push/prueba", nil); st != 422 {
		t.Fatalf("probar sin claves: %d %v", st, p)
	}
	if _, p := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/push", nil); p["configurado"] != false {
		t.Fatalf("clave: %v", p)
	}
	if st, _ := pedir(t, adm, "DELETE", e.srv.URL+"/api/v1/admin/push", map[string]any{"endpoint": "https://push.test/1"}); st != 200 {
		t.Fatal("desactivar")
	}
	var subs int
	_ = e.pool.QueryRow(ctx, `select count(*) from push_subscriptions`).Scan(&subs)
	if subs != 1 { // la borra solo su dueño
		t.Fatalf("suscripciones: %d", subs)
	}
}
