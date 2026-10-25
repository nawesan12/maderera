package precios

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

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/preciosapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

type entorno struct {
	srv                  *httptest.Server
	pool                 *pgxpool.Pool
	ses                  *auth.Servicio
	general, profesional string
	fen18, fen12, mel    string
}

// lectorFalso: cada línea «SKU;general;profesional».
func lectorFalso(datos []byte) ([]FilaLeida, string) {
	if bytes.HasPrefix(datos, []byte("%PDF")) {
		return nil, "Esto es un PDF."
	}
	var filas []FilaLeida
	for i, l := range strings.Split(strings.TrimSpace(string(datos)), "\n") {
		c := strings.Split(l, ";")
		f := FilaLeida{Linea: i + 2, SKU: c[0]}
		if c[1] != "" {
			f.PrecioGeneral = &c[1]
		}
		if c[2] != "" {
			f.PrecioProfesional = &c[2]
		}
		if f.PrecioGeneral == nil && f.PrecioProfesional == nil {
			f.Error = "No se pudo leer ningún precio de esta fila."
		}
		filas = append(filas, f)
	}
	return filas, ""
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-precios-32-caracteres", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	preciosapi.HandlerWithOptions(
		preciosapi.NewStrictHandlerWithOptions(NuevaAPI(Nuevo(pool, silencio), lectorFalso),
			[]preciosapi.StrictMiddlewareFunc{plataforma.ConPedido[preciosapi.StrictHandlerFunc]},
			preciosapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		preciosapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := preciosapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := preciosapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	e := &entorno{srv: srv, pool: pool, ses: ses}
	ctx := context.Background()
	q := func(sql string, args ...any) string {
		var id string
		if err := pool.QueryRow(ctx, sql, args...).Scan(&id); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	cat := q(`insert into categories (slug, name, description) values ('placas', 'Placas', '') returning id`)
	fen := q(`insert into products (slug, name, category_id, description, recargo_elaboracion_pct) values ('fenolico', 'Fenólico', $1, '', 20) returning id`, cat)
	mel := q(`insert into products (slug, name, category_id, description) values ('melamina', 'Melamina', $1, '') returning id`, cat)
	e.fen18 = q(`insert into product_variants (product_id, sku, label, sort_order) values ($1, 'FEN18', '18 mm', 0) returning id`, fen)
	e.fen12 = q(`insert into product_variants (product_id, sku, label, sort_order) values ($1, 'FEN12', '12 mm', 1) returning id`, fen)
	e.mel = q(`insert into product_variants (product_id, sku, label) values ($1, 'MEL18', '18 mm') returning id`, mel)
	e.general = q(`insert into price_lists (slug, name, is_default) values ('general', 'General', true) returning id`)
	e.profesional = q(`insert into price_lists (slug, name) values ('profesional', 'Profesional') returning id`)
	_, _ = pool.Exec(ctx, `insert into price_list_items (price_list_id, variant_id, price) values
		($1, $3, 84500), ($1, $4, 61000), ($1, $5, 50000), ($2, $3, 70000)`, e.general, e.profesional, e.fen18, e.fen12, e.mel)
	_, _ = pool.Exec(ctx, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 1, 40000.5)`, e.fen18)
	return e
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
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u.URL, w.Result().Cookies())
	return &http.Client{Jar: jar}
}

func pedir(t *testing.T, c *http.Client, metodo, url string, cuerpo any, tipo ...string) (int, string) {
	t.Helper()
	var r io.Reader
	ct := "application/json"
	switch b := cuerpo.(type) {
	case nil:
	case *bytes.Buffer:
		r, ct = b, tipo[0]
	default:
		crudo, _ := json.Marshal(b)
		r = bytes.NewReader(crudo)
	}
	req, _ := http.NewRequest(metodo, url, r)
	if cuerpo != nil {
		req.Header.Set("Content-Type", ct)
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(out)
}

func (e *entorno) precio(t *testing.T, variante, lista string) string {
	var p string
	_ = e.pool.QueryRow(context.Background(), `select price::text from price_list_items where variant_id = $1 and price_list_id = $2`, variante, lista).Scan(&p)
	return p
}

func TestGrillaYEdicion(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	u := e.srv.URL + "/api/v1/admin/precios"

	_, b := pedir(t, ven, "GET", u+"?busqueda=fen", nil)
	var grilla []FilaPrecio
	_ = json.Unmarshal([]byte(b), &grilla)
	if len(grilla) != 2 || grilla[0].SKU != "FEN18" || grilla[0].PrecioGeneral != "84500.00" || grilla[0].PrecioProfesional != "70000.00" ||
		grilla[0].Brecha == nil || *grilla[0].Brecha != 17.2 || grilla[1].PrecioProfesional != "0" || grilla[1].Brecha != nil || grilla[0].Desactualizado {
		t.Fatalf("grilla: %s", b)
	}
	// El vendedor ve la grilla pero no cambia precios (la pantalla es del admin).
	if c, _ := pedir(t, ven, "POST", u+"/editar", map[string]string{"variantId": e.fen18, "priceListId": e.general, "precio": "1"}); c != 403 {
		t.Errorf("el vendedor editó un precio: %d", c)
	}
	if c, b := pedir(t, adm, "POST", u+"/editar", map[string]string{"variantId": e.fen18, "priceListId": e.general, "precio": "-1"}); c != 422 || !strings.Contains(b, "número positivo") {
		t.Errorf("precio negativo: %d %s", c, b)
	}
	if c, _ := pedir(t, adm, "POST", u+"/editar", map[string]string{"variantId": e.fen18, "priceListId": e.general, "precio": "86000.125"}); c != 204 {
		t.Fatal("editar")
	}
	if p := e.precio(t, e.fen18, e.general); p != "86000.13" {
		t.Errorf("toFixed(2) de 86000.125: %s", p)
	}
	// El mismo precio otra vez no deja historial.
	pedir(t, adm, "POST", u+"/editar", map[string]string{"variantId": e.fen18, "priceListId": e.general, "precio": "86000.13"})
	_, b = pedir(t, ven, "GET", u+"/historial", nil)
	var hist []CambioDePrecio
	_ = json.Unmarshal([]byte(b), &hist)
	if len(hist) != 1 || hist[0].PrecioAnterior == nil || *hist[0].PrecioAnterior != "84500.00" || hist[0].PrecioNuevo != "86000.13" || hist[0].Origen != "manual" {
		t.Errorf("historial: %s", b)
	}
}

func TestAjusteMasivo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	u := e.srv.URL + "/api/v1/admin/precios/ajuste"

	if c, b := pedir(t, adm, "POST", u, map[string]string{"porcentaje": "0"}); c != 422 || !strings.Contains(b, "distinto de cero") {
		t.Errorf("0 %%: %d %s", c, b)
	}
	// +10 % a la general, redondeado a la centena.
	if c, b := pedir(t, adm, "POST", u, map[string]string{"porcentaje": "10", "listaSlug": "general", "redondeo": "centena"}); c != 200 || !strings.Contains(b, "Se actualizaron 3 precios.") {
		t.Fatalf("ajuste: %d %s", c, b)
	}
	if p := e.precio(t, e.fen18, e.general); p != "93000.00" {
		t.Errorf("84500 +10%% a la centena: %s", p)
	}
	if p := e.precio(t, e.fen12, e.general); p != "67100.00" {
		t.Errorf("61000 +10%%: %s", p)
	}
	if p := e.precio(t, e.fen18, e.profesional); p != "70000.00" {
		t.Errorf("la profesional no se tenía que tocar: %s", p)
	}
	var motivo string
	_ = e.pool.QueryRow(context.Background(), `select motivo from price_history where origen = 'ajuste_masivo' limit 1`).Scan(&motivo)
	if motivo != "Aumento del 10%" {
		t.Errorf("motivo: %q", motivo)
	}
	// Desde el costo con elaboración: 40000.5 × 1,2 = 48000.6, +25 % = 60000.75.
	// Los que no tienen costo quedan igual y se cuentan.
	if c, b := pedir(t, adm, "POST", u, map[string]string{"porcentaje": "25", "listaSlug": "general", "base": "costo_elaborado"}); c != 200 ||
		!strings.Contains(b, "Se actualizaron 1 precio. 2 quedaron igual porque no tienen costo cargado.") {
		t.Fatalf("desde costo: %d %s", c, b)
	}
	if p := e.precio(t, e.fen18, e.general); p != "60000.75" {
		t.Errorf("desde el costo elaborado: %s", p)
	}
	if c, b := pedir(t, adm, "POST", u, map[string]string{"porcentaje": "5", "categoria": "no-existe"}); c != 422 || !strings.Contains(b, "No se encontraron precios") {
		t.Errorf("sin nada que ajustar: %d %s", c, b)
	}
}

func TestImportacion(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	u := e.srv.URL + "/api/v1/admin/precios/importar"
	subir := func(contenido string) (int, string) {
		var b bytes.Buffer
		w := multipart.NewWriter(&b)
		p, _ := w.CreateFormFile("archivo", "precios.csv")
		_, _ = p.Write([]byte(contenido))
		_ = w.Close()
		return pedir(t, adm, "POST", u+"/previa", &b, w.FormDataContentType())
	}
	if _, b := subir("%PDF-1.4"); !strings.Contains(b, `"error":"Esto es un PDF."`) {
		t.Errorf("pdf: %s", b)
	}
	_, b := subir("FEN18;84500.00;72000\nFEN12;61500;\nNOEXISTE;10;\nMEL18;;")
	var v VistaPrevia
	_ = json.Unmarshal([]byte(b), &v)
	if v.Cambian != 2 || v.Iguales != 0 || v.Problemas != 2 {
		t.Fatalf("vista previa: %s", b)
	}
	if f := v.Filas[0]; f.GeneralNuevo != nil || f.ProfesionalNuevo == nil || *f.ProfesionalNuevo != "72000" || f.Estado != "cambia" {
		t.Errorf("FEN18 (la general no cambia: 84500.00 = 84500): %+v", f)
	}
	if v.Filas[2].Estado != "sin-sku" || v.Filas[3].Estado != "error" {
		t.Errorf("problemas: %s", b)
	}
	cambios := map[string]any{"cambios": []map[string]string{{"sku": "FEN18", "profesionalNuevo": "72000"}, {"sku": "FEN12", "generalNuevo": "61500"}, {"sku": "NOEXISTE", "generalNuevo": "1"}}}
	if c, b := pedir(t, adm, "POST", u, cambios); c != 200 || !strings.Contains(b, "Se aplicaron 2 cambios de precio.") {
		t.Fatalf("confirmar: %d %s", c, b)
	}
	if p := e.precio(t, e.fen12, e.general); p != "61500.00" {
		t.Errorf("FEN12: %s", p)
	}
	var lotes int
	_ = e.pool.QueryRow(context.Background(), `select count(distinct lote_id) from price_history where origen = 'importacion'`).Scan(&lotes)
	if lotes != 1 {
		t.Errorf("tienen que quedar en un solo lote: %d", lotes)
	}
	if c, _ := pedir(t, adm, "POST", u, map[string]any{"cambios": []any{}}); c != 422 {
		t.Errorf("sin cambios: %d", c)
	}
}

func TestListasYDescuentos(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	u := e.srv.URL + "/api/v1/admin/precios/"

	if c, _ := pedir(t, ven, "PUT", u+"listas/"+e.profesional+"/porcentaje", map[string]string{"porcentaje": "-5"}); c != 403 {
		t.Errorf("el vendedor cambió una lista: %d", c)
	}
	if c, b := pedir(t, adm, "PUT", u+"listas/"+e.general+"/porcentaje", map[string]string{"porcentaje": "-5"}); c != 422 || !strings.Contains(b, "no se deriva de sí misma") {
		t.Errorf("la general: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "PUT", u+"listas/"+e.profesional+"/porcentaje", map[string]string{"porcentaje": "-12,345"}); c != 200 {
		t.Fatalf("porcentaje: %d %s", c, b)
	}
	_, b := pedir(t, ven, "GET", u+"listas", nil)
	if !strings.Contains(b, `"porcentajeSobreGeneral":"-12.35"`) || !strings.HasPrefix(b, `[{"id":"`+e.general) {
		t.Errorf("listas: %s", b)
	}
	pedir(t, adm, "PUT", u+"listas/"+e.profesional+"/porcentaje", map[string]string{"porcentaje": ""})
	if _, b := pedir(t, ven, "GET", u+"listas", nil); !strings.Contains(b, `"porcentajeSobreGeneral":null`) {
		t.Errorf("sin porcentaje: %s", b)
	}

	desc := map[string]any{"medio": "efectivo", "desdeMonto": "100.000", "porcentaje": "10", "etiqueta": "Contado", "activo": true}
	if c, b := pedir(t, adm, "POST", u+"descuentos", desc); c != 204 {
		t.Fatalf("descuento: %d %s", c, b)
	}
	var desde string
	_ = e.pool.QueryRow(context.Background(), `select desde_monto::text from payment_discounts`).Scan(&desde)
	if desde != "100000.00" {
		t.Errorf("«100.000» son cien mil: %s", desde)
	}
	if c, b := pedir(t, adm, "POST", u+"descuentos", desc); c != 422 || !strings.Contains(b, "mismo monto desde") {
		t.Errorf("repetido: %d %s", c, b)
	}
	desc["porcentaje"] = "95"
	if c, b := pedir(t, adm, "POST", u+"descuentos", desc); c != 422 || !strings.Contains(b, "entre 1 y 90") {
		t.Errorf("95 %%: %d %s", c, b)
	}
}

// Con el lector de verdad: una planilla CSV de las del golden de planilla.
func TestImportacionConElLectorReal(t *testing.T) {
	csv := "\uFEFFSKU;Producto;Medida;Categoria;Precio lista;Precio profesional\r\nFEN18;Fenólico;18 mm;Placas;84.500,00;72.000\r\nFEN12;Fenólico;12 mm;Placas;$ 61.500;\r\n;sin código;;;1;\r\n"
	filas, e := LeerPlanilla([]byte(csv))
	if e != "" || len(filas) != 3 {
		t.Fatalf("leer: %v %q", filas, e)
	}
	if *filas[0].PrecioGeneral != "84500.00" || *filas[0].PrecioProfesional != "72000.00" || filas[2].Error == "" {
		t.Errorf("filas: %+v %+v %+v", filas[0], filas[1], filas[2])
	}
	if _, e := LeerPlanilla([]byte("%PDF-1.4 algo")); e == "" {
		t.Error("un PDF tenía que dar error")
	}
}
