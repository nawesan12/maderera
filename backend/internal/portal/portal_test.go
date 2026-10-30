package portal

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
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/portalapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
)

type entorno struct {
	srv  *httptest.Server
	pool *pgxpool.Pool
	ses  *auth.Servicio
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	silencio := slog.New(slog.NewTextHandler(io.Discard, nil))
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-del-portal-de-32-caracteres", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	portalapi.HandlerWithOptions(
		portalapi.NewStrictHandlerWithOptions(NuevaAPI(Nuevo(pool)), []portalapi.StrictMiddlewareFunc{plataforma.ConPedido[portalapi.StrictHandlerFunc]},
			portalapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		portalapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := portalapi.GetSwagger()
	validar, _ := plataforma.ValidarContra(spec)
	spec2, _ := portalapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	return &entorno{srv, pool, ses}
}

func (e *entorno) web(t *testing.T, correo string) (*http.Client, string) {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeCliente(ctx, correo, "una clave larga", "Cliente "+correo); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	ses, err := e.ses.Entrar(ctx, w, correo, "una clave larga", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	var id string
	_ = e.pool.QueryRow(ctx, `select id from customers where user_id = $1`, ses.UserID).Scan(&id)
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u.URL, w.Result().Cookies())
	return &http.Client{Jar: jar}, id
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

func TestMiCuenta(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	ana, _ := e.web(t, "ana@prueba.test")
	u := e.srv.URL + "/api/v1/cuenta/"

	// Sin sesión: todo vacío, nada roto.
	if _, b := pedir(t, http.DefaultClient, "GET", u+"ficha", nil); b != "{\"cliente\":null}\n" {
		t.Errorf("ficha sin sesión: %s", b)
	}
	if _, b := pedir(t, http.DefaultClient, "GET", u+"pedidos", nil); b != "[]\n" {
		t.Errorf("pedidos sin sesión: %s", b)
	}
	if c, _ := pedir(t, http.DefaultClient, "PUT", u+"datos", map[string]string{"nombre": "X"}); c != 401 {
		t.Errorf("datos sin sesión: %d", c)
	}

	// Mis datos.
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "J", "condicionIva": "consumidor_final"}); c != 422 || !strings.Contains(b, "Escribí tu nombre.") {
		t.Errorf("nombre corto: %d %s", c, b)
	}
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "Juan Pérez", "cuit": "20-12345678-9", "condicionIva": "monotributista"}); c != 200 {
		t.Fatalf("datos: %d %s", c, b)
	}
	if _, b := pedir(t, juan, "GET", u+"ficha", nil); !strings.Contains(b, `"cuit":"20123456789"`) || !strings.Contains(b, `"condicionIva":"monotributista"`) {
		t.Errorf("ficha: %s", b)
	}

	// Direcciones: la primera queda predeterminada; marcar otra desmarca.
	_, _ = pedir(t, juan, "POST", u+"direcciones", map[string]string{"etiqueta": "Casa", "calle": "Alem 1234", "localidad": "Mar del Plata"})
	_, _ = pedir(t, juan, "POST", u+"direcciones", map[string]any{"etiqueta": "Obra", "calle": "Güemes 55", "localidad": "Mar del Plata", "predeterminada": true})
	_, b := pedir(t, juan, "GET", u+"direcciones", nil)
	var ds []Direccion
	_ = json.Unmarshal([]byte(b), &ds)
	if len(ds) != 2 || ds[0].Etiqueta != "Obra" || !ds[0].Predeterminada || ds[1].Predeterminada {
		t.Fatalf("direcciones: %s", b)
	}
	// Ana no ve, no edita ni borra las de Juan.
	if _, b := pedir(t, ana, "GET", u+"direcciones", nil); b != "[]\n" {
		t.Errorf("direcciones ajenas: %s", b)
	}
	if c, b := pedir(t, ana, "POST", u+"direcciones", map[string]string{"id": ds[0].ID, "etiqueta": "Mía", "calle": "Otra 1", "localidad": "MdP"}); c != 422 || !strings.Contains(b, "No encontramos esa dirección.") {
		t.Errorf("editar ajena: %d %s", c, b)
	}
	_, _ = pedir(t, ana, "DELETE", u+"direcciones/"+ds[0].ID, nil)
	if _, b := pedir(t, juan, "GET", u+"direcciones", nil); strings.Count(b, `"id"`) != 2 {
		t.Errorf("Ana borró una de Juan: %s", b)
	}

	// Presupuestos: responder uno enviado, una vez.
	if _, err := e.pool.Exec(ctx, `insert into quotes (numero, customer_id, contacto_nombre, estado, subtotal, total) values ('P-2026-0001', $1, 'Juan', 'enviado', 1000, 1000)`, idJuan); err != nil {
		t.Fatal(err)
	}
	if _, b := pedir(t, juan, "GET", u+"resumen", nil); !strings.Contains(b, `"presupuestosAResponder":1`) {
		t.Errorf("resumen: %s", b)
	}
	if c, _ := pedir(t, ana, "GET", u+"presupuestos/P-2026-0001", nil); c != 404 {
		t.Errorf("presupuesto ajeno: %d", c)
	}
	if c, b := pedir(t, ana, "POST", u+"presupuestos/P-2026-0001/respuesta", map[string]string{"respuesta": "aceptado"}); c != 422 {
		t.Errorf("responder ajeno: %d %s", c, b)
	}
	if c, b := pedir(t, juan, "POST", u+"presupuestos/P-2026-0001/respuesta", map[string]string{"respuesta": "aceptado"}); c != 200 || !strings.Contains(b, "avisamos al vendedor") {
		t.Errorf("aceptar: %d %s", c, b)
	}
	if c, b := pedir(t, juan, "POST", u+"presupuestos/P-2026-0001/respuesta", map[string]string{"respuesta": "rechazado"}); c != 422 || !strings.Contains(b, "ya no está esperando respuesta") {
		t.Errorf("responder dos veces: %d %s", c, b)
	}
	if _, b := pedir(t, juan, "GET", u+"presupuestos/P-2026-0001", nil); !strings.Contains(b, `"estado":"aceptado"`) {
		t.Errorf("presupuesto: %s", b)
	}
}

func TestSeguimientoDelPedido(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	ana, _ := e.web(t, "ana@prueba.test")
	if _, err := e.ses.AltaDeStaff(ctx, "vendedor@prueba.test", "una clave larga", "Vendedor", "vendedor"); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	if _, err := e.ses.Entrar(ctx, w, "vendedor@prueba.test", "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	u0, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u0.URL, w.Result().Cookies())
	staff := &http.Client{Jar: jar}

	var token, pedido string
	if err := e.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, contacto_telefono, customer_id, total, subtotal, public_token)
		values ('PED-0042', 'Juan', '223 555', $1, 1210, 1210, gen_random_uuid()) returning public_token::text, id`, idJuan).Scan(&token, &pedido); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal, orden, costo_unitario)
		values ($1, 'Fenólico 18 mm', 'placa', 1, 1210, 1210, 0, 700)`, pedido); err != nil {
		t.Fatal(err)
	}
	u := e.srv.URL + "/api/v1/pedidos/"
	casos := []struct {
		nombre string
		c      *http.Client
		ruta   string
		codigo int
	}{
		{"con el token, sin sesión", http.DefaultClient, "PED-0042/seguimiento?t=" + token, 200},
		{"sin token ni sesión", http.DefaultClient, "PED-0042/seguimiento", 404},
		{"token equivocado", http.DefaultClient, "PED-0042/seguimiento?t=00000000-0000-0000-0000-000000000000", 404},
		{"el dueño sin token", juan, "PED-0042/seguimiento", 200},
		{"otro cliente sin token", ana, "PED-0042/seguimiento", 404},
		{"el personal", staff, "PED-0042/seguimiento", 200},
		{"uno que no existe", http.DefaultClient, "PED-9999/seguimiento?t=" + token, 404},
	}
	// Mi pedido: el dueño lo ve con su historial; otro, 404; sin el costo.
	_, _ = e.pool.Exec(ctx, `insert into order_status_history (order_id, estado, nota) values ($1, 'pendiente', 'Recibido')`, pedido)
	if c, b := pedir(t, juan, "GET", e.srv.URL+"/api/v1/cuenta/pedidos/PED-0042", nil); c != 200 || !strings.Contains(b, "Recibido") ||
		!strings.Contains(b, "Fenólico 18 mm") || strings.Contains(b, "costoUnitario") {
		t.Errorf("mi pedido: %d %s", c, b)
	}
	if c, _ := pedir(t, ana, "GET", e.srv.URL+"/api/v1/cuenta/pedidos/PED-0042", nil); c != 404 {
		t.Errorf("pedido ajeno: %d", c)
	}

	var cuerpo404 string
	for _, c := range casos {
		codigo, b := pedir(t, c.c, "GET", u+c.ruta, nil)
		if codigo != c.codigo {
			t.Errorf("%s: %d %s", c.nombre, codigo, b)
		}
		if codigo == 200 && (!strings.Contains(b, "Fenólico 18 mm") || strings.Contains(b, "costoUnitario") || strings.Contains(b, "alicuota") || strings.Contains(b, "700.00")) {
			t.Errorf("%s: %s", c.nombre, b)
		}
		// El que no existe y el que no corresponde contestan igual.
		if codigo == 404 {
			if cuerpo404 != "" && b != cuerpo404 {
				t.Errorf("%s: el 404 dice otra cosa: %s / %s", c.nombre, b, cuerpo404)
			}
			cuerpo404 = b
		}
	}
}
