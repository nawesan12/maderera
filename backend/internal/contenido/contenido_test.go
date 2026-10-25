package contenido

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
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/contenidoapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
	"mjbj/internal/subidas"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

type entorno struct {
	srv     *httptest.Server
	pool    *pgxpool.Pool
	carpeta string
	ses     *auth.Servicio
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	carpeta := t.TempDir()
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-contenido-32-caracteres", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	contenidoapi.HandlerWithOptions(
		contenidoapi.NewStrictHandlerWithOptions(NuevaAPI(Nuevo(pool, subidas.Nuevo(subidas.Config{Carpeta: carpeta}), silencio)),
			[]contenidoapi.StrictMiddlewareFunc{plataforma.ConPedido[contenidoapi.StrictHandlerFunc]},
			contenidoapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		contenidoapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, err := contenidoapi.GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := contenidoapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	return &entorno{srv: srv, pool: pool, carpeta: carpeta, ses: ses}
}

// cliente entra como alguien y devuelve un http.Client con su cookie.
func (e *entorno) cliente(t *testing.T, correo string, rol string) *http.Client {
	t.Helper()
	ctx := context.Background()
	if rol == "admin" || rol == "deposito" {
		if _, err := e.ses.AltaDeStaff(ctx, correo, "una clave larga", "Persona", sqlc.StaffRole(rol)); err != nil {
			t.Fatal(err)
		}
	} else if _, err := e.ses.AltaDeCliente(ctx, correo, "una clave larga", "Juan Cliente"); err != nil {
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

func pedir(t *testing.T, c *http.Client, metodo, url string, cuerpo any) (int, []byte) {
	t.Helper()
	var r io.Reader
	tipo := ""
	switch b := cuerpo.(type) {
	case nil:
	case *multipart.Writer:
		t.Fatal("usar formulario()")
	case formulario:
		r, tipo = bytes.NewReader(b.datos), b.tipo
	default:
		crudo, _ := json.Marshal(b)
		r, tipo = bytes.NewReader(crudo), "application/json"
	}
	req, _ := http.NewRequest(metodo, url, r)
	if tipo != "" {
		req.Header.Set("Content-Type", tipo)
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out
}

type formulario struct {
	datos []byte
	tipo  string
}

func armarFormulario(campos map[string]string, imagen []byte) formulario {
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	for k, v := range campos {
		_ = w.WriteField(k, v)
	}
	if imagen != nil {
		h := make(map[string][]string)
		h["Content-Disposition"] = []string{`form-data; name="imagen"; filename="foto.png"`}
		h["Content-Type"] = []string{"image/png"}
		p, _ := w.CreatePart(h)
		_, _ = p.Write(imagen)
	}
	_ = w.Close()
	return formulario{b.Bytes(), w.FormDataContentType()}
}

var png = append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 64)...)

func TestBannersYPromos(t *testing.T) {
	e := armar(t)
	adm := e.cliente(t, "admin@prueba.test", "admin")
	dep := e.cliente(t, "deposito@prueba.test", "deposito")
	anon := &http.Client{}
	u := e.srv.URL + "/api/v1/"

	// Solo el admin edita el contenido (ACCESO de /admin/contenido).
	if c, _ := pedir(t, dep, "GET", u+"admin/contenido/banners", nil); c != 403 {
		t.Errorf("depósito vio los banners del panel: %d", c)
	}
	if c, _ := pedir(t, anon, "GET", u+"admin/contenido/banners", nil); c != 401 {
		t.Errorf("sin sesión: %d", c)
	}

	// Un banner con imagen, al aire desde hoy.
	hoy := time.Now().In(argentina).Format("2006-01-02")
	if c, b := pedir(t, adm, "POST", u+"admin/contenido/banners", armarFormulario(map[string]string{
		"ubicacion": "portada", "titulo": "Liquidación de fenólicos", "etiqueta": "Oferta", "desde": hoy, "activo": "on", "orden": "1",
	}, png)); c != 204 {
		t.Fatalf("crear banner: %d %s", c, b)
	}
	c, b := pedir(t, anon, "GET", u+"contenido/banners?ubicacion=portada", nil)
	var publicados []Banner
	_ = json.Unmarshal(b, &publicados)
	if c != 200 || len(publicados) != 1 || publicados[0].ImagenURL == nil || !strings.HasPrefix(*publicados[0].ImagenURL, "/subidas/banner-") {
		t.Fatalf("banners publicados: %d %s", c, b)
	}
	foto := filepath.Join(e.carpeta, strings.TrimPrefix(*publicados[0].ImagenURL, "/subidas/"))
	if _, err := os.Stat(foto); err != nil {
		t.Fatal("la imagen no quedó en disco")
	}
	// Con fecha de fin antes del inicio: no.
	if c, b := pedir(t, adm, "PUT", u+"admin/contenido/banners/"+publicados[0].ID, armarFormulario(map[string]string{
		"ubicacion": "portada", "titulo": "Liquidación", "desde": hoy, "hasta": "2020-01-01", "activo": "on",
	}, nil)); c != 422 || !strings.Contains(string(b), "anterior a la de inicio") {
		t.Errorf("fechas al revés: %d %s", c, b)
	}
	// Apagarlo: sale del sitio, la imagen se conserva.
	if c, b := pedir(t, adm, "PUT", u+"admin/contenido/banners/"+publicados[0].ID, armarFormulario(map[string]string{
		"ubicacion": "portada", "titulo": "Liquidación de fenólicos",
	}, nil)); c != 204 {
		t.Fatalf("apagar: %d %s", c, b)
	}
	if _, b := pedir(t, anon, "GET", u+"contenido/banners?ubicacion=portada", nil); string(b) != "[]\n" {
		t.Errorf("un banner apagado sigue al aire: %s", b)
	}
	if _, err := os.Stat(foto); err != nil {
		t.Error("editar sin imagen nueva borró la que tenía")
	}
	// Borrarlo borra la imagen.
	if c, _ := pedir(t, adm, "DELETE", u+"admin/contenido/banners/"+publicados[0].ID, nil); c != 204 {
		t.Fatal("borrar")
	}
	if _, err := os.Stat(foto); !os.IsNotExist(err) {
		t.Error("la imagen quedó en disco después de borrar el banner")
	}
	var anotadas int
	_ = e.pool.QueryRow(context.Background(), `select count(*) from audit_log where entidad = 'banner'`).Scan(&anotadas)
	if anotadas != 3 {
		t.Errorf("la bitácora tiene %d acciones sobre banners, tenían que ser 3", anotadas)
	}

	// Una promo que vence hoy: vale todo el día, y la fecha va en hora de acá.
	if c, b := pedir(t, adm, "POST", u+"admin/contenido/promos", armarFormulario(map[string]string{
		"medio": "Banco Provincia", "titulo": "30 % los jueves", "quienPaga": "banco", "vigenciaHasta": hoy, "activo": "on",
	}, nil)); c != 204 {
		t.Fatalf("crear promo: %d %s", c, b)
	}
	_, b = pedir(t, anon, "GET", u+"contenido/promos", nil)
	var promos []PromoVigente
	_ = json.Unmarshal(b, &promos)
	if len(promos) != 1 || promos[0].VigenciaHasta != time.Now().In(argentina).Format("02/01/06") {
		t.Errorf("promos: %s", b)
	}
	if c, b := pedir(t, adm, "POST", u+"admin/contenido/promos", armarFormulario(map[string]string{
		"medio": "Naranja X", "titulo": "Cuotas", "quienPaga": "el vecino",
	}, nil)); c != 422 || !strings.Contains(string(b), "quién pone el descuento") {
		t.Errorf("quién paga inválido: %d %s", c, b)
	}
}

func TestAjustesYResenas(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.cliente(t, "admin@prueba.test", "admin")
	juan := e.cliente(t, "juan@prueba.test", "cliente")
	anon := &http.Client{}
	u := e.srv.URL + "/api/v1/"

	_, _ = e.pool.Exec(ctx, `insert into site_settings (clave, valor) values ('telefono', '223 000')`)
	if c, _ := pedir(t, adm, "PUT", u+"admin/contenido/ajustes/telefono", map[string]string{"valor": "223 590-3118"}); c != 204 {
		t.Fatal("guardar ajuste")
	}
	if _, b := pedir(t, anon, "GET", u+"contenido/ajustes", nil); !strings.Contains(string(b), `"telefono":"223 590-3118"`) {
		t.Errorf("ajustes: %s", b)
	}
	if c, _ := pedir(t, adm, "PUT", u+"admin/contenido/ajustes/no-existe", map[string]string{"valor": "x"}); c != 404 {
		t.Errorf("ajuste inexistente: %d", c)
	}

	// Juan compró un fenólico y el pedido se entregó.
	var producto, variante, categoria, orderID, clienteID string
	_ = e.pool.QueryRow(ctx, `insert into categories (slug, name, description) values ('placas', 'Placas', '') returning id`).Scan(&categoria)
	_ = e.pool.QueryRow(ctx, `insert into products (slug, name, category_id, description) values ('fenolico', 'Fenólico', $1, '') returning id`, categoria).Scan(&producto)
	_ = e.pool.QueryRow(ctx, `insert into product_variants (product_id, sku, label) values ($1, 'FEN18', '18 mm') returning id`, producto).Scan(&variante)
	_ = e.pool.QueryRow(ctx, `select id from customers where email = 'juan@prueba.test'`).Scan(&clienteID)
	_ = e.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, customer_id, estado) values ('PED-1', 'Juan', $1, 'entregado') returning id`, clienteID).Scan(&orderID)
	_, _ = e.pool.Exec(ctx, `insert into order_items (order_id, variant_id, descripcion, cantidad, precio_unitario, subtotal) values ($1, $2, 'Fenólico 18', 1, 100, 100)`, orderID, variante)

	_, b := pedir(t, juan, "GET", u+"contenido/mis-resenas", nil)
	if !strings.Contains(string(b), `"yaResenado":false`) || !strings.Contains(string(b), `"numeroPedido":"PED-1"`) {
		t.Fatalf("lo reseñable: %s", b)
	}
	resena := map[string]any{"productId": producto, "orderId": orderID, "estrellas": 5, "texto": "Excelente"}
	if c, b := pedir(t, juan, "POST", u+"contenido/mis-resenas", resena); c != 201 || !strings.Contains(string(b), `"slug":"fenolico"`) {
		t.Fatalf("dejar reseña: %d %s", c, b)
	}
	if c, _ := pedir(t, juan, "POST", u+"contenido/mis-resenas", resena); c != 409 {
		t.Errorf("la segunda reseña de la misma compra: %d", c)
	}
	if c, _ := pedir(t, juan, "POST", u+"contenido/mis-resenas", map[string]any{"productId": producto, "orderId": orderID, "estrellas": 9}); c != 422 {
		t.Errorf("nueve estrellas: %d", c)
	}
	// Pendiente: no se ve en el sitio.
	if _, b := pedir(t, anon, "GET", u+"contenido/productos/"+producto+"/resenas", nil); string(b) != "[]\n" {
		t.Errorf("una reseña pendiente ya se ve: %s", b)
	}
	if _, b := pedir(t, anon, "GET", u+"contenido/productos/"+producto+"/resumen", nil); string(b) != "null\n" {
		t.Errorf("resumen sin reseñas: %s", b)
	}
	// El admin la publica.
	_, b = pedir(t, adm, "GET", u+"admin/contenido/resenas", nil)
	var paraModerar []struct{ ID, Estado string }
	_ = json.Unmarshal(b, &paraModerar)
	if len(paraModerar) != 1 || paraModerar[0].Estado != "pendiente" {
		t.Fatalf("para moderar: %s", b)
	}
	if c, _ := pedir(t, adm, "POST", u+"admin/contenido/resenas/"+paraModerar[0].ID+"/moderar", map[string]string{"estado": "publicada"}); c != 200 {
		t.Fatal("publicar")
	}
	if _, b := pedir(t, anon, "GET", u+"contenido/productos/"+producto+"/resumen", nil); !strings.Contains(string(b), `"promedio":5`) || !strings.Contains(string(b), `"5":1`) {
		t.Errorf("resumen: %s", b)
	}
	// Alguien que no compró no puede reseñar.
	otro := e.cliente(t, "otro@prueba.test", "cliente")
	if c, _ := pedir(t, otro, "POST", u+"contenido/mis-resenas", resena); c != 422 {
		t.Errorf("reseñó sin haber comprado: %d", c)
	}
}
