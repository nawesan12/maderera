package documentos

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/documentosapi"
	"mjbj/internal/auth"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// Las rutas de los documentos contra una base real y el contrato. Que el
// PDF salga igual que el del TS lo prueba internal/pdf (golden de píxeles);
// acá, que lleguen los datos correctos, los permisos y el freno.

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

func init() {
	// El validador del contrato no conoce el PDF: se lo lee como archivo.
	openapi3filter.RegisterBodyDecoder("application/pdf", openapi3filter.FileBodyDecoder)
}

type entorno struct {
	srv  *httptest.Server
	pool *pgxpool.Pool
	ses  *auth.Servicio
}

// El reloj de las pruebas: el 5/3/2026 a las 22:30 de Buenos Aires, que en
// UTC ya es el 6/3 (la fecha de vigencia tiene que decir 5/3).
var reloj = time.Date(2026, 3, 6, 1, 30, 0, 0, time.UTC)

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-documentos-32-caracteres", URL: "http://localhost"}, pool)
	api := NuevaAPI(pool, limites.Nuevo(sqlc.New(pool), silencio), silencio)
	api.ahora = func() time.Time { return reloj }
	m := http.NewServeMux()
	documentosapi.HandlerWithOptions(
		documentosapi.NewStrictHandlerWithOptions(api,
			[]documentosapi.StrictMiddlewareFunc{plataforma.ConPedido[documentosapi.StrictHandlerFunc]},
			documentosapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		documentosapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, err := documentosapi.GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := documentosapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	return &entorno{srv: srv, pool: pool, ses: ses}
}

func (e *entorno) entrar(t *testing.T, correo string, alta func() error) *http.Client {
	t.Helper()
	if err := alta(); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	if _, err := e.ses.Entrar(context.Background(), w, correo, "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u.URL, w.Result().Cookies())
	return &http.Client{Jar: jar}
}

func (e *entorno) cliente(t *testing.T, correo string) *http.Client {
	return e.entrar(t, correo, func() error {
		_, err := e.ses.AltaDeCliente(context.Background(), correo, "una clave larga", "Cliente")
		return err
	})
}

func (e *entorno) staff(t *testing.T, correo string, rol sqlc.StaffRole) *http.Client {
	return e.entrar(t, correo, func() error {
		_, err := e.ses.AltaDeStaff(context.Background(), correo, "una clave larga", "Persona", rol)
		return err
	})
}

// sembrar: dos categorías, productos con tilde, la lista general, una
// profesional «general −10 %» y los datos fiscales.
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
	fen := q(`insert into products (slug, name, category_id, description) values ('fenolico', 'Fenólico «marino»', $1, '') returning id`, cat)
	mel := q(`insert into products (slug, name, category_id, description) values ('melamina', 'Melamina blanca', $1, '') returning id`, cat)
	v18 := q(`insert into product_variants (product_id, sku, label) values ($1, 'FEN18', '18 mm') returning id`, fen)
	vm := q(`insert into product_variants (product_id, sku, label) values ($1, 'MEL18', '18 mm') returning id`, mel)
	_ = q(`insert into product_variants (product_id, sku, label) values ($1, 'FEN12', '12 mm') returning id`, fen) // sin precio
	gen := q(`insert into price_lists (slug, name, is_default) values ('general', 'General', true) returning id`)
	pro = q(`insert into price_lists (slug, name, porcentaje_sobre_general) values ('profesional', 'Profesional', -10) returning id`)
	_ = q(`insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 84500), ($1, $3, 50000.55) returning id`, gen, v18, vm)
	_ = q(`insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 40000) returning id`, pro, vm)
	_ = q(`insert into configuracion_fiscal (razon_social, cuit, domicilio) values ('Maderera de Prueba S.R.L.', '30-71234567-8', 'Av. Siempreviva 742') returning id`)
	return pro
}

type respuesta struct {
	estado int
	tipo   string
	disp   string
	cache  string
	cuerpo []byte
}

func pedir(t *testing.T, c *http.Client, url string) respuesta {
	t.Helper()
	r, err := c.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	return respuesta{r.StatusCode, r.Header.Get("Content-Type"), r.Header.Get("Content-Disposition"), r.Header.Get("Cache-Control"), b}
}

// textoDelPDF saca el texto con pdftotext; sin poppler, la prueba solo mira
// que sea un PDF.
func textoDelPDF(t *testing.T, b []byte) (string, bool) {
	t.Helper()
	if !strings.HasPrefix(string(b), "%PDF-") {
		t.Fatalf("no es un PDF: %.80q", b)
	}
	if _, err := exec.LookPath("pdftotext"); err != nil {
		return "", false
	}
	ruta := filepath.Join(t.TempDir(), "doc.pdf")
	if err := os.WriteFile(ruta, b, 0o644); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command("pdftotext", "-enc", "UTF-8", ruta, "-").Output()
	if err != nil {
		t.Fatal(err)
	}
	return string(out), true
}

func contiene(t *testing.T, que, texto string, quiero ...string) {
	t.Helper()
	for _, q := range quiero {
		if !strings.Contains(texto, q) {
			t.Errorf("%s: falta %q en\n%s", que, q, texto)
		}
	}
}

func TestMiListaDePreciosPdf(t *testing.T) {
	e := armar(t)
	pro := e.sembrar(t)
	u := e.srv.URL + "/api/v1/documentos/mi-lista-de-precios"

	if r := pedir(t, &http.Client{}, u); r.estado != 401 {
		t.Errorf("sin sesión: %d", r.estado)
	}

	ana := e.cliente(t, "ana@prueba.test")
	r := pedir(t, ana, u)
	if r.estado != 200 || r.tipo != "application/pdf" || r.cache != "no-store, private" ||
		r.disp != `inline; filename="lista-precios-mjbj-2026-03-06.pdf"` {
		t.Fatalf("la general: %d %q %q %q", r.estado, r.tipo, r.disp, r.cache)
	}
	if txt, ok := textoDelPDF(t, r.cuerpo); ok {
		// La fecha de vigencia es la de Buenos Aires aunque en UTC ya sea el 6.
		contiene(t, "la general", txt, "Lista de precios", "Vigente al 5/3/2026", "Maderera de Prueba S.R.L.",
			"CUIT 30-71234567-8", "PLACAS", "FEN18", "Fenólico «marino»", "$ 84.500", "$ 50.001", "a consultar")
	}

	// La profesional, con el factor de la lista derivada.
	_, _ = e.pool.Exec(context.Background(), `update customers set price_list_id = $1 where email = 'ana@prueba.test'`, pro)
	r = pedir(t, ana, u)
	if txt, ok := textoDelPDF(t, r.cuerpo); ok {
		contiene(t, "la profesional", txt, "Lista Profesional", "$ 76.050", "$ 40.000")
	}

	// Diez por hora, contadas junto con las filas de /catalogo/mi-lista.
	for range 7 {
		pedir(t, ana, u)
	}
	if r := pedir(t, ana, u); r.estado != 200 {
		t.Errorf("la décima: %d", r.estado)
	}
	if r := pedir(t, ana, u); r.estado != 429 {
		t.Errorf("la undécima: %d", r.estado)
	}
}

func TestExportarPrecios(t *testing.T) {
	e := armar(t)
	e.sembrar(t)
	u := e.srv.URL + "/api/v1/documentos/precios"

	if r := pedir(t, &http.Client{}, u); r.estado != 401 {
		t.Errorf("sin sesión: %d", r.estado)
	}
	if r := pedir(t, e.cliente(t, "cliente@prueba.test"), u); r.estado != 403 {
		t.Errorf("un cliente: %d", r.estado)
	}

	// La planilla de precios es de /admin/precios: solo el admin (antes
	// cualquier persona del panel, como requireStaff).
	if r := pedir(t, e.staff(t, "vendedor@prueba.test", "vendedor"), u); r.estado != 403 {
		t.Errorf("un vendedor: %d", r.estado)
	}
	adm := e.staff(t, "admin@prueba.test", "admin")
	r := pedir(t, adm, u+"?buscar=fenol")
	if r.estado != 200 || r.tipo != "text/csv; charset=utf-8" || r.disp != `attachment; filename="precios-mjbj-2026-03-06.csv"` {
		t.Fatalf("csv: %d %q %q", r.estado, r.tipo, r.disp)
	}
	csv := string(r.cuerpo)
	if !strings.HasPrefix(csv, "\ufeffSKU;Producto;Medida;Categoria;Precio lista;Precio profesional\r\n") {
		t.Errorf("encabezado del CSV: %q", csv)
	}
	contiene(t, "csv", csv, `FEN18;Fenólico «marino»;18 mm;Placas;84500,00;`)
	if strings.Contains(csv, "MEL18") {
		t.Errorf("el filtro no se aplicó: %q", csv)
	}

	r = pedir(t, adm, u+"?formato=pdf&lista=profesional")
	if r.estado != 200 || r.tipo != "application/pdf" || r.disp != `inline; filename="precios-mjbj-2026-03-06.pdf"` {
		t.Fatalf("pdf: %d %q %q", r.estado, r.tipo, r.disp)
	}
	if txt, ok := textoDelPDF(t, r.cuerpo); ok {
		contiene(t, "pdf profesional", txt, "Lista profesional", "Vigente al 5/3/2026", "MEL18", "$ 40.000")
	}
	r = pedir(t, adm, u+"?formato=pdf&cat=placas")
	if txt, ok := textoDelPDF(t, r.cuerpo); ok {
		contiene(t, "pdf general", txt, "Lista de precios", "$ 84.500", "$ 50.001")
	}
}

// Sin datos fiscales cargados, el membrete sale con la razón social de
// siempre (lo que el TS dibujaba después de crear la fila por omisión).
func TestSinDatosFiscales(t *testing.T) {
	e := armar(t)
	ana := e.cliente(t, "ana@prueba.test")
	r := pedir(t, ana, e.srv.URL+"/api/v1/documentos/mi-lista-de-precios")
	if r.estado != 200 {
		t.Fatalf("%d %s", r.estado, r.cuerpo)
	}
	if txt, ok := textoDelPDF(t, r.cuerpo); ok {
		contiene(t, "sin datos fiscales", txt, "Maderera Juan B. Justo", "Lista de precios")
	}
}
