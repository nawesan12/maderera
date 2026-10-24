package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// cargar mete en la base las filas que dejó better-auth para un caso, con la
// sesión venciendo en `vence` (el golden se generó en una fecha fija; el
// vencimiento se corre a hoy para que el test no caduque).
func cargar(t *testing.T, pool *pgxpool.Pool, c caso, vence time.Time) {
	t.Helper()
	ctx := context.Background()
	u, a, s := c.User[0], c.Account[0], c.Session[len(c.Session)-1]
	exec := func(sql string, args ...any) {
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql[:40], err)
		}
	}
	exec(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1,$2,$3,$4,$5::timestamp,$6::timestamp)`,
		u["id"], u["name"], u["email"], u["email_verified"], u["created_at"], u["updated_at"])
	exec(`insert into account (id, issuer, account_id, provider_id, user_id, password, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7::timestamp,$8::timestamp)`,
		a["id"], a["issuer"], a["account_id"], a["provider_id"], a["user_id"], a["password"], a["created_at"], a["updated_at"])
	exec(`insert into profiles (user_id, role) values ($1, 'cliente')`, u["id"])
	exec(`insert into session (id, token, expires_at, created_at, updated_at, ip_address, user_agent, user_id) values ($1,$2,$3,$4::timestamp,$5::timestamp,$6,$7,$8)`,
		s["id"], s["token"], vence, s["created_at"], s["updated_at"], s["ip_address"], s["user_agent"], s["user_id"])
}

// pedidoConCookies arma un pedido con las cookies que mandó better-auth (o Go).
func pedidoConCookies(sets []string) *http.Request {
	r := httptest.NewRequest("GET", "/", nil)
	for _, set := range sets {
		par, _, _ := strings.Cut(set, ";")
		nombre, valor, _ := strings.Cut(par, "=")
		r.AddCookie(&http.Cookie{Name: nombre, Value: valor})
	}
	return r
}

func setCookies(w *httptest.ResponseRecorder) []string { return w.Result().Header.Values("Set-Cookie") }

func servicio(t *testing.T, pool *pgxpool.Pool, g golden, url string) *Servicio {
	s := Nuevo(Config{Secreto: g.Secreto, URL: url}, pool)
	return s
}

func TestSesionDeBetterAuthEnGo(t *testing.T) {
	g := leerGolden(t)
	pool := pruebas.Base(t)
	ctx := context.Background()
	ahora := time.Now().UTC()

	for _, c := range []caso{g.HTTP, g.HTTPS} {
		s := servicio(t, pool, g, c.BaseURL)
		// Recién renovada: no se toca.
		cargar(t, pool, c, ahora.Add(duracion-time.Hour))
		w := httptest.NewRecorder()
		ses, err := s.Leer(w, pedidoConCookies(c.CookiesEntrada))
		if err != nil || ses == nil {
			t.Fatalf("%s: la cookie de better-auth no abrió sesión en Go: %v", c.BaseURL, err)
		}
		if ses.UserID != c.UserID || ses.Correo != c.Email || ses.Rol != sqlc.UserRoleCliente || ses.EsStaff() {
			t.Errorf("%s: sesión leída: %+v", c.BaseURL, ses)
		}
		if len(setCookies(w)) != 0 {
			t.Errorf("%s: renovó una sesión que no hacía falta: %v", c.BaseURL, setCookies(w))
		}
	}

	c := g.HTTPS
	s := servicio(t, pool, g, c.BaseURL)
	token := c.Session[len(c.Session)-1]["token"].(string)

	// Hace más de un día que no se renueva: se extiende a 30 días y se
	// reescribe la cookie, con el mismo token.
	_, _ = pool.Exec(ctx, `update session set expires_at = $1 where token = $2`, ahora.Add(duracion-renovarCon-time.Minute), token)
	w := httptest.NewRecorder()
	if ses, err := s.Leer(w, pedidoConCookies(c.CookiesEntrada)); err != nil || ses == nil {
		t.Fatalf("no leyó la sesión a renovar: %v", err)
	}
	var vence time.Time
	_ = pool.QueryRow(ctx, `select expires_at from session where token = $1`, token).Scan(&vence)
	if d := vence.Sub(ahora.Add(duracion)); d < -time.Minute || d > time.Minute {
		t.Errorf("renovó a %v, tenía que ser ~%v", vence, ahora.Add(duracion))
	}
	nuevas := setCookies(w)
	if len(nuevas) != 1 || !strings.HasPrefix(nuevas[0], "__Secure-better-auth.session_token=") ||
		!strings.Contains(nuevas[0], "Max-Age=2592000") || !strings.Contains(nuevas[0], "Secure") {
		t.Errorf("cookie renovada: %v", nuevas)
	}
	// La cookie renovada es la misma que habría escrito better-auth.
	if v, _, _ := strings.Cut(strings.TrimPrefix(nuevas[0], "__Secure-better-auth.session_token="), ";"); v != firmar(token, g.Secreto) {
		t.Errorf("la cookie renovada no es la de siempre")
	}

	// Vencida: no hay sesión, se borra la fila y la cookie.
	_, _ = pool.Exec(ctx, `update session set expires_at = $1 where token = $2`, ahora.Add(-time.Minute), token)
	w = httptest.NewRecorder()
	if ses, err := s.Leer(w, pedidoConCookies(c.CookiesEntrada)); err != nil || ses != nil {
		t.Fatalf("una sesión vencida abrió: %+v %v", ses, err)
	}
	var quedan int
	_ = pool.QueryRow(ctx, `select count(*) from session where token = $1`, token).Scan(&quedan)
	if quedan != 0 || len(setCookies(w)) == 0 {
		t.Errorf("la vencida no se limpió: filas=%d cookies=%v", quedan, setCookies(w))
	}

	// Una cookie con la firma alterada: nada.
	falsa := strings.Replace(c.CookiesEntrada[0], ".", ".A", 1)
	if ses, _ := s.Leer(httptest.NewRecorder(), pedidoConCookies([]string{falsa})); ses != nil {
		t.Error("aceptó una cookie alterada")
	}
}

func TestEntrarRegistrarSalir(t *testing.T) {
	g := leerGolden(t)
	pool := pruebas.Base(t)
	ctx := context.Background()
	c := g.HTTP
	cargar(t, pool, c, time.Now().UTC().Add(duracion))
	s := servicio(t, pool, g, "http://localhost:3100")

	// La clave que se registró con better-auth entra por Go (con el correo en
	// mayúsculas: se normaliza, como en better-auth).
	w := httptest.NewRecorder()
	ses, err := s.Entrar(ctx, w, strings.ToUpper(c.Email), c.Clave, "10.0.0.1", "prueba", true)
	if err != nil || ses.UserID != c.UserID {
		t.Fatalf("no entró con la clave de better-auth: %v", err)
	}
	if ses2, _ := s.Leer(httptest.NewRecorder(), pedidoConCookies(setCookies(w))); ses2 == nil || ses2.UserID != c.UserID {
		t.Fatal("la cookie que escribió Entrar no sirve")
	}
	for _, mal := range [][2]string{{c.Email, c.Clave + "x"}, {"nadie@prueba.test", c.Clave}} {
		if _, err := s.Entrar(ctx, httptest.NewRecorder(), mal[0], mal[1], "", "", true); !errors.Is(err, ErrCredenciales) {
			t.Errorf("Entrar(%q) = %v, tenía que ser ErrCredenciales", mal[0], err)
		}
	}

	// Registrar: usuario, cuenta, perfil de cliente y sesión, como signUpEmail.
	w = httptest.NewRecorder()
	nuevo, err := s.Registrar(ctx, w, " Ana Gómez ", "Ana@Prueba.Test", "una clave larga", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if nuevo.Correo != "ana@prueba.test" || nuevo.Nombre != "Ana Gómez" || nuevo.Rol != sqlc.UserRoleCliente {
		t.Errorf("registrado: %+v", nuevo)
	}
	var issuer, cuenta string
	_ = pool.QueryRow(ctx, `select issuer, account_id from account where user_id = $1`, nuevo.UserID).Scan(&issuer, &cuenta)
	if issuer != "local:credential" || cuenta != nuevo.UserID {
		t.Errorf("la cuenta no quedó como la deja better-auth: issuer=%q account_id=%q", issuer, cuenta)
	}
	if _, err := s.Registrar(ctx, httptest.NewRecorder(), "Otra", "ANA@prueba.test", "otra clave larga", "", ""); !errors.Is(err, ErrCorreoUsado) {
		t.Errorf("registró dos veces el mismo correo: %v", err)
	}
	pedido := pedidoConCookies(setCookies(w))
	if ses, _ := s.Leer(httptest.NewRecorder(), pedido); ses == nil || ses.UserID != nuevo.UserID {
		t.Fatal("la sesión del registro no sirve")
	}

	// Cambiar la clave cierra las otras sesiones y deja la propia.
	w2 := httptest.NewRecorder()
	if _, err := s.Entrar(ctx, w2, "ana@prueba.test", "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	otra := pedidoConCookies(setCookies(w2))
	propia, _ := s.Leer(httptest.NewRecorder(), pedido)
	if err := s.CambiarClave(ctx, propia, "una clave larga", "la clave nueva"); err != nil {
		t.Fatal(err)
	}
	if ses, _ := s.Leer(httptest.NewRecorder(), otra); ses != nil {
		t.Error("la otra sesión siguió abierta después de cambiar la clave")
	}
	if ses, _ := s.Leer(httptest.NewRecorder(), pedido); ses == nil {
		t.Error("cambiar la clave cerró la sesión propia")
	}
	if _, err := s.Entrar(ctx, httptest.NewRecorder(), "ana@prueba.test", "la clave nueva", "", "", true); err != nil {
		t.Errorf("no entra con la clave nueva: %v", err)
	}

	// Salir borra la sesión.
	w = httptest.NewRecorder()
	if err := s.Salir(ctx, w, pedido); err != nil {
		t.Fatal(err)
	}
	if ses, _ := s.Leer(httptest.NewRecorder(), pedido); ses != nil {
		t.Error("la sesión siguió después de salir")
	}

	// Sin «recordarme»: dura un día, cookie de sesión y la marca de no renovar.
	w = httptest.NewRecorder()
	if _, err := s.Entrar(ctx, w, c.Email, c.Clave, "", "", false); err != nil {
		t.Fatal(err)
	}
	sets := strings.Join(setCookies(w), "\n")
	if strings.Contains(sets, "Max-Age") || !strings.Contains(sets, "better-auth.dont_remember=") {
		t.Errorf("sin recordar: %s", sets)
	}
}
