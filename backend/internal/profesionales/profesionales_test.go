package profesionales

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/profesionalesapi"
	"mjbj/internal/auth"
	"mjbj/internal/avisos"
	"mjbj/internal/email"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

const secretoInterno = "secreto-interno-de-prueba"

type buzon struct {
	mu       sync.Mutex
	mensajes []email.Mensaje
}

func (*buzon) Nombre() string { return "smtp" }
func (*buzon) Real() bool     { return true }
func (b *buzon) Enviar(_ context.Context, m email.Mensaje) email.Resultado {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.mensajes = append(b.mensajes, m)
	return email.Resultado{Enviado: true}
}

func (b *buzon) asuntos() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	var a []string
	for _, m := range b.mensajes {
		a = append(a, m.Para+": "+m.Asunto)
	}
	return strings.Join(a, " | ")
}

type entorno struct {
	srv   *httptest.Server
	pool  *pgxpool.Pool
	ses   *auth.Servicio
	s     *Servicio
	buzon *buzon
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-profesionales-32-caracteres", URL: "http://localhost"}, pool)
	b := &buzon{}
	s := Nuevo(pool, avisos.Nuevo(pool, b, "Maderera <pedidos@mjbj.com.ar>", silencio), "https://mjbj.com.ar", silencio)
	// Los avisos, en el momento: así se pueden mirar.
	s.enSegundoPlano = func(f func(context.Context)) { f(context.Background()) }
	m := http.NewServeMux()
	profesionalesapi.HandlerWithOptions(
		profesionalesapi.NewStrictHandlerWithOptions(NuevaAPI(s, limites.Nuevo(sqlc.New(pool), silencio), plataforma.ConfigInterna{Secreto: secretoInterno}),
			[]profesionalesapi.StrictMiddlewareFunc{plataforma.ConPedido[profesionalesapi.StrictHandlerFunc]},
			profesionalesapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		profesionalesapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := profesionalesapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := profesionalesapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	return &entorno{srv: srv, pool: pool, ses: ses, s: s, buzon: b}
}

func (e *entorno) cliente(cookies []*http.Cookie) *http.Client {
	jar, _ := cookiejar.New(nil)
	u, _ := url.Parse(e.srv.URL)
	jar.SetCookies(u, cookies)
	return &http.Client{Jar: jar}
}

func (e *entorno) staff(t *testing.T, correo string, rol sqlc.StaffRole) *http.Client {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeStaff(ctx, correo, "una clave larga", "Persona", rol); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	if _, err := e.ses.Entrar(ctx, w, correo, "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	return e.cliente(w.Result().Cookies())
}

// web es una cuenta del sitio (con su ficha, como la crea el registro).
func (e *entorno) web(t *testing.T, correo string) (*http.Client, string, string) {
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
	var ficha string
	if err := e.pool.QueryRow(ctx, `select id from customers where user_id = $1`, ses.UserID).Scan(&ficha); err != nil {
		t.Fatal(err)
	}
	return e.cliente(w.Result().Cookies()), ses.UserID, ficha
}

func pedir(t *testing.T, c *http.Client, metodo, ruta string, cuerpo any, cabeceras ...string) (int, map[string]any) {
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
	for i := 0; i+1 < len(cabeceras); i += 2 {
		req.Header.Set(cabeceras[i], cabeceras[i+1])
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	if m == nil {
		var l []any
		_ = json.Unmarshal(b, &l)
		m = map[string]any{"_lista": l}
	}
	return resp.StatusCode, m
}

func primerErrorDe(err error) string {
	var p *plataforma.Problema
	if errors.As(err, &p) {
		return p.Detalle
	}
	return ""
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

func (e *entorno) uno(t *testing.T, q string, args ...any) string {
	t.Helper()
	var s string
	if err := e.pool.QueryRow(context.Background(), q, args...).Scan(&s); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return s
}

func TestSolicitudYAprobacion(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	dep := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	anon := &http.Client{}
	lista := e.uno(t, `insert into price_lists (slug, name) values ('profesionales', 'Profesionales') returning id`)

	// La solicitud pública: zod, y una pendiente por documento.
	form := map[string]any{"nombre": "Ana Pérez", "documentoTipo": "cuit", "documentoNumero": "20-12345678-9", "email": "ana@prueba.test",
		"telefono": "0223 474-3328", "rubro": "carpintero", "razonSocial": ""}
	if st, p := pedir(t, anon, "POST", e.srv.URL+"/api/v1/profesionales/solicitud", form); st != 422 || primerError(p) != "Revisá el número: no coincide con el tipo de documento." {
		t.Fatalf("CUIT mal: %d %v", st, p)
	}
	form["documentoNumero"] = "20-12345678-6"
	if st, p := pedir(t, anon, "POST", e.srv.URL+"/api/v1/profesionales/solicitud", form); st != 200 || p["ok"] != "Recibimos tu solicitud. Te contestamos dentro de las próximas 24 horas hábiles." {
		t.Fatalf("solicitud: %d %v", st, p)
	}
	if st, p := pedir(t, anon, "POST", e.srv.URL+"/api/v1/profesionales/solicitud", form); st != 200 || !strings.HasPrefix(p["ok"].(string), "Ya tenemos tu solicitud") {
		t.Fatalf("la segunda: %d %v", st, p)
	}
	if got := e.buzon.asuntos(); got != "ana@prueba.test: Recibimos tu solicitud de acceso profesional" {
		t.Fatalf("acuse: %s", got)
	}
	sol := e.uno(t, `select id from professional_applications where documento_numero = '20123456786'`)
	if c := e.uno(t, `select coalesce(cuit, '') || '/' || coalesce(razon_social, '-') from professional_applications where id = $1`, sol); c != "20123456786/-" {
		t.Fatalf("lo guardado: %s", c)
	}

	// Ya compra en el mostrador con ese CUIT (con guiones).
	ficha := e.uno(t, `insert into customers (nombre, cuit, email) values ('Carpintería Pérez', '20-12345678-6', 'viejo@prueba.test') returning id`)

	// El panel: el depósito no entra (el TS lo dejaba); el vendedor sí.
	if st, _ := pedir(t, dep, "GET", e.srv.URL+"/api/v1/admin/profesionales/solicitudes", nil); st != http.StatusForbidden {
		t.Fatalf("el depósito: %d", st)
	}
	_, l := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/profesionales/solicitudes", nil)
	s0 := l["_lista"].([]any)[0].(map[string]any)
	if s0["clienteExistente"].(map[string]any)["id"] != ficha {
		t.Fatalf("no encontró la ficha por CUIT: %v", s0)
	}
	if _, r := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/profesionales/resumen", nil); r["pendientes"] != 1.0 {
		t.Fatalf("resumen: %v", r)
	}

	if st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/profesionales/aprobacion", map[string]any{"id": sol, "limiteCredito": "x"}); st != 422 || p["detail"] != "Revisá el límite de cuenta corriente." {
		t.Fatalf("límite: %d %v", st, p)
	}
	st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/profesionales/aprobacion", map[string]any{"id": sol, "priceListId": lista, "limiteCredito": "1.500.000"})
	if st != 200 || p["ok"] != "Ana Pérez quedó habilitado. Los precios le cambian apenas recargue." {
		t.Fatalf("aprobar: %d %v", st, p)
	}
	// Ganó la ficha del mostrador: profesional, con la lista, el límite y los datos de contacto nuevos.
	if f := e.uno(t, `select tipo::text || '/' || rubro || '/' || price_list_id || '/' || limite_credito || '/' || email from customers where id = $1`, ficha); f != "profesional/carpintero/"+lista+"/1500000.00/ana@prueba.test" {
		t.Fatalf("la ficha: %s", f)
	}
	if n := e.uno(t, `select count(*)::text from customers`); n != "1" { // el personal no tiene ficha: no se creó otra
		t.Fatalf("fichas: %s", n)
	}
	if !strings.Contains(e.buzon.asuntos(), "ana@prueba.test: Tu acceso profesional está activo") || !strings.Contains(e.buzon.mensajes[1].HTML, "1.500.000") {
		t.Fatalf("bienvenida: %s", e.buzon.asuntos())
	}
	if d := e.uno(t, `select descripcion || ' ' || detalle from audit_log where entidad = 'profesional'`); d != `Aprobó a Ana Pérez con lista Profesionales {"lista":"Profesionales","limiteCredito":1500000}` {
		t.Fatalf("bitácora: %s", d)
	}
	if st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/profesionales/aprobacion", map[string]any{"id": sol}); st != 422 || p["detail"] != "Esta solicitud ya estaba aprobada." {
		t.Fatalf("aprobar dos veces: %d %v", st, p)
	}
}

// Quien pide acceso logueado ya tiene una ficha del registro (sin CUIT). Si
// además hay una del mostrador con CUIT, gana esa y la cuenta web se muda;
// la del sitio se archiva si está vacía y, si tiene historia, se avisa.
func TestAprobarConDosFichas(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	for _, conHistoria := range []bool{false, true} {
		correo := "web@prueba.test"
		cu := "20-12345678-6"
		if conHistoria {
			correo, cu = "web2@prueba.test", "30-58944525-9"
		}
		cl, userID, fichaWeb := e.web(t, correo)
		mostrador := e.uno(t, `insert into customers (nombre, cuit) values ('Del mostrador', $1) returning id`, cu)
		if conHistoria {
			e.uno(t, `insert into orders (numero, contacto_nombre, customer_id, estado, total) values ('PED-1', 'x', $1, 'entregado', 1) returning id`, fichaWeb)
		}
		if st, p := pedir(t, cl, "POST", e.srv.URL+"/api/v1/profesionales/solicitud", map[string]any{"nombre": "Juan Web", "documentoTipo": "cuit",
			"documentoNumero": cu, "email": correo, "telefono": "1234567", "rubro": "arquitecto"}); st != 200 {
			t.Fatalf("solicitud: %d %v", st, p)
		}
		sol := e.uno(t, `select id from professional_applications where user_id = $1`, userID)
		st, p := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/profesionales/aprobacion", map[string]any{"id": sol})
		if st != 200 || strings.Contains(p["ok"].(string), "Ojo:") != conHistoria {
			t.Fatalf("aprobar (historia %v): %d %v", conHistoria, st, p)
		}
		if u := e.uno(t, `select coalesce(user_id, '-') from customers where id = $1`, mostrador); u != userID {
			t.Fatalf("la cuenta web no se mudó: %s", u)
		}
		if w := e.uno(t, `select active::text || '/' || coalesce(user_id, '-') from customers where id = $1`, fichaWeb); w != map[bool]string{false: "false/-", true: "true/-"}[conHistoria] {
			t.Fatalf("la ficha del sitio quedó %s", w)
		}
		if r := e.uno(t, `select role::text from profiles where user_id = $1`, userID); r != "profesional" {
			t.Fatalf("rol: %s", r)
		}
		// Su estado, visto por él.
		_, est := pedir(t, cl, "GET", e.srv.URL+"/api/v1/profesionales/estado", nil)
		if est["aprobado"] != true || est["customerId"] != mostrador || est["solicitud"].(map[string]any)["estado"] != "aprobada" {
			t.Fatalf("estado: %v", est)
		}
	}
	// Sin sesión: vacío.
	if _, est := pedir(t, &http.Client{}, "GET", e.srv.URL+"/api/v1/profesionales/estado", nil); est["aprobado"] != false || est["solicitud"] != nil {
		t.Fatalf("estado sin sesión: %v", est)
	}
}

func TestRechazo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	sol := e.uno(t, `insert into professional_applications (nombre, documento_tipo, documento_numero, email, telefono)
		values ('Beto Ruiz', 'dni', '12345678', 'beto@prueba.test', '123456') returning id`)
	if st, p := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/profesionales/rechazo", map[string]any{"id": sol, "motivo": "no"}); st != 422 || primerError(p) != "Escribí el motivo: se lo mandamos al solicitante." {
		t.Fatalf("sin motivo: %d %v", st, p)
	}
	if st, p := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/profesionales/rechazo", map[string]any{"id": sol, "motivo": "Falta la matrícula"}); st != 200 {
		t.Fatalf("rechazar: %d %v", st, p)
	}
	if got := e.buzon.asuntos(); got != "beto@prueba.test: Sobre tu solicitud de acceso profesional" || !strings.Contains(e.buzon.mensajes[0].HTML, "Falta la matrícula") {
		t.Fatalf("aviso del rechazo: %s", got)
	}
}

func TestEventos(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	anon := &http.Client{}
	ctx := context.Background()
	manana := time.Now().In(Zona).AddDate(0, 0, 1)
	inicia := manana.Format("2006-01-02") + "T18:00"

	if st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/eventos", map[string]any{"titulo": "abc", "inicia": inicia, "cupo": "0", "soloProfesionales": false}); st != 422 || primerError(p) != "Poné un título." {
		t.Fatalf("título: %d %v", st, p)
	}
	ev := map[string]any{"titulo": "Taller de Wood Frame", "inicia": inicia, "cupo": "2", "precio": "", "soloProfesionales": false, "lugar": "Sucursal Centro"}
	for range 2 {
		if st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/eventos", ev); st != 200 {
			t.Fatalf("crear: %d %v", st, p)
		}
	}
	// La hora es la de Buenos Aires, y el slug repetido lleva el año y el mes.
	id := e.uno(t, `select id from events where slug = 'taller-de-wood-frame'`)
	if h := e.uno(t, `select to_char(inicia at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') from events where id = $1`, id); h != "18:00" {
		t.Fatalf("la hora quedó %s", h)
	}
	if n := e.uno(t, `select slug from events where slug <> 'taller-de-wood-frame'`); n != "taller-de-wood-frame-"+manana.Format("2006")+strings.TrimLeft(manana.Format("01"), "0") {
		t.Fatalf("slug repetido: %s", n)
	}

	anotar := map[string]any{"eventId": id, "slug": "taller-de-wood-frame", "nombre": "Ana Pérez", "email": "ana@prueba.test"}
	if st, p := pedir(t, anon, "POST", e.srv.URL+"/api/v1/eventos/inscripcion", anotar); st != 422 || p["detail"] != "Este evento ya no está abierto." {
		t.Fatalf("anotarse a un borrador: %d %v", st, p)
	}
	if st, p := pedir(t, ven, "PUT", e.srv.URL+"/api/v1/admin/eventos/estado", map[string]any{"id": id, "estado": "publicado"}); st != 200 || p["ok"] != "Publicado. Ya se puede ver y anotar." {
		t.Fatalf("publicar: %d %v", st, p)
	}
	st, p := pedir(t, anon, "POST", e.srv.URL+"/api/v1/eventos/inscripcion", anotar)
	if st != 200 || p["requierePago"] != false {
		t.Fatalf("anotarse: %d %v", st, p)
	}
	if got := e.buzon.asuntos(); got != "ana@prueba.test: Anotado: Taller de Wood Frame" || !strings.Contains(e.buzon.mensajes[0].HTML, ", 18:00") {
		t.Fatalf("confirmación: %s", got)
	}
	if st, p := pedir(t, anon, "POST", e.srv.URL+"/api/v1/eventos/inscripcion", anotar); st != 422 || p["detail"] != "Ya estás anotado a este evento." {
		t.Fatalf("anotarse dos veces: %d %v", st, p)
	}
	anotar["email"] = "beto@prueba.test"
	pedir(t, anon, "POST", e.srv.URL+"/api/v1/eventos/inscripcion", anotar)
	anotar["email"] = "caro@prueba.test"
	if st, p := pedir(t, anon, "POST", e.srv.URL+"/api/v1/eventos/inscripcion", anotar); st != 422 || p["detail"] != "Se agotaron los lugares. Escribinos y te avisamos si se libera alguno." {
		t.Fatalf("sin cupo: %d %v", st, p)
	}

	_, l := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/eventos", nil)
	var este map[string]any
	for _, x := range l["_lista"].([]any) {
		if x.(map[string]any)["id"] == id {
			este = x.(map[string]any)
		}
	}
	if este["inscriptos"] != 2.0 || este["confirmados"] != 2.0 || este["proximo"] != true || este["recaudado"] != 0.0 {
		t.Fatalf("en el panel: %v", este)
	}
	_, as := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/eventos/"+id+"/asistentes", nil)
	beto := as["_lista"].([]any)[1].(map[string]any)["id"].(string)
	if st, p := pedir(t, ven, "PUT", e.srv.URL+"/api/v1/admin/eventos/asistencia", map[string]any{"id": beto, "estado": "cancelada"}); st != 200 || p["ok"] != "Listo." {
		t.Fatalf("cancelar a Beto: %d %v", st, p)
	}

	// Los recordatorios: los de mañana, una sola vez.
	e.buzon.mensajes = nil
	if st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/eventos/recordatorios", nil); st != 200 || p["ok"] != "Salieron 1 recordatorio." {
		t.Fatalf("recordatorios: %d %v", st, p)
	}
	if got := e.buzon.asuntos(); got != "ana@prueba.test: Mañana te esperamos: Taller de Wood Frame" {
		t.Fatalf("recordatorio: %s", got)
	}
	if n, _ := e.s.EnviarRecordatorios(ctx); n != 0 {
		t.Fatalf("se repitieron %d recordatorios", n)
	}

	// El aviso por pago: solo el servidor de Next.
	if st, _ := pedir(t, anon, "POST", e.srv.URL+"/api/v1/eventos/aviso-por-pago", map[string]any{"customerId": "8f2b5c1e-1d2a-4c3b-9a8e-111111111111"}); st != http.StatusForbidden {
		t.Fatalf("aviso por pago sin secreto: %d", st)
	}
	if st, _ := pedir(t, anon, "POST", e.srv.URL+"/api/v1/eventos/aviso-por-pago", map[string]any{"customerId": "8f2b5c1e-1d2a-4c3b-9a8e-111111111111"},
		"Authorization", "Bearer "+secretoInterno); st != 200 {
		t.Fatalf("aviso por pago: %d", st)
	}
}

// Diez personas al último lugar a la vez: con el candado por evento entra
// una sola. Sin pg_advisory_xact_lock las diez cuentan los mismos ocupados y
// entran todas (probado sacándolo).
func TestInscripcionesSimultaneasRespetanElCupo(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	id := e.uno(t, `insert into events (slug, titulo, inicia, cupo, estado) values ('x', 'X', now() + interval '2 days', 3, 'publicado') returning id`)
	e.uno(t, `insert into event_registrations (event_id, nombre, email, estado) values ($1, 'a', 'a@x.test', 'confirmada'), ($1, 'b', 'b@x.test', 'reservada') returning id`, id)
	// Las conexiones, abiertas antes: si no, abrirlas espacia las diez y
	// llegan de a una.
	var conns []*pgxpool.Conn
	for range 10 {
		c, err := e.pool.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		conns = append(conns, c)
	}
	for _, c := range conns {
		c.Release()
	}
	largada := make(chan struct{})
	var wg sync.WaitGroup
	var mu sync.Mutex
	entraron := 0
	for i := range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-largada
			_, err := e.s.Anotar(ctx, Anotarse{EventID: id, Nombre: "Persona", Email: string(rune('c'+i)) + "@x.test"}, nil, nil, false)
			if err == nil {
				mu.Lock()
				entraron++
				mu.Unlock()
			} else if !strings.Contains(err.Error(), "agotaron") && !strings.Contains(primerErrorDe(err), "agotaron") {
				t.Errorf("error inesperado: %v", err)
			}
		}()
	}
	close(largada)
	wg.Wait()
	if entraron != 1 {
		t.Fatalf("entraron %d al último lugar", entraron)
	}
	if n := e.uno(t, `select count(*)::text from event_registrations where event_id = $1`, id); n != "3" {
		t.Fatalf("inscripciones: %s", n)
	}
}
