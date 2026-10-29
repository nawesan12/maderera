package cortes

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/cortesapi"
	"mjbj/internal/auth"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

const secretoInterno = "secreto-interno-de-prueba-de-cortes"
const tokenAgente = "token-del-agente-de-prueba-1234"

type entorno struct {
	srv                         *httptest.Server
	pool                        *pgxpool.Pool
	ses                         *auth.Servicio
	melamina, fenolico, central string
	general, mayorista          string
	cliente                     string
}

func armar(t *testing.T) *entorno {
	t.Helper()
	t.Setenv("CORTES_AGENTE_TOKEN", tokenAgente)
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-los-cortes-de-32-caracteres", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	a := NuevaAPI(Nuevo(pool, silencio), limites.Nuevo(sqlc.New(pool), silencio), plataforma.ConfigInterna{Secreto: secretoInterno})
	a.Registrar(m)
	cortesapi.HandlerWithOptions(
		cortesapi.NewStrictHandlerWithOptions(a,
			[]cortesapi.StrictMiddlewareFunc{plataforma.ConPedido[cortesapi.StrictHandlerFunc]},
			cortesapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		cortesapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := cortesapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := cortesapi.GetSwagger()
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
	tab := q(`insert into categories (slug, name, description) values ('tableros', 'Tableros de madera', '') returning id`)
	pm := q(`insert into products (slug, name, category_id, description, unit, forma_de_venta, precio_media_pct) values ('melamina', 'Melamina Blanca', $1, '', 'placa', 'entera_o_media', 55) returning id`, cat)
	pf := q(`insert into products (slug, name, category_id, description, unit) values ('fenolico', 'Fenólico', $1, '', 'placa') returning id`, tab)
	e.melamina = q(`insert into product_variants (product_id, sku, label, largo_mm, ancho_mm) values ($1, 'MEL18', '2750 x 1830 — 18mm', 2750, 1830) returning id`, pm)
	e.fenolico = q(`insert into product_variants (product_id, sku, label, largo_mm, ancho_mm) values ($1, 'FEN18', '2440 x 1220', 2440, 1220) returning id`, pf)
	e.central = q(`insert into branches (slug, name, sort_order) values ('casa-central', 'Casa Central', 1) returning id`)
	e.general = q(`insert into price_lists (slug, name, is_default) values ('general', 'General', true) returning id`)
	e.mayorista = q(`insert into price_lists (slug, name, porcentaje_sobre_general) values ('mayorista', 'Mayorista', -10) returning id`)
	_ = q(`insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 84500), ($1, $3, 60000.55) returning id`, e.general, e.melamina, e.fenolico)
	_ = q(`insert into cutting_rates (material, price_list_id, precio_por_pasada, precio_por_metro_canto) values ('Placas', null, 1200, 850), ('Placas', $1, 996, 700) returning id`, e.mayorista)
	e.cliente = q(`insert into customers (nombre, razon_social, price_list_id) values ('Gómez', 'Carpintería Gómez', $1) returning id`, e.mayorista)
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
	return resp.StatusCode, strings.NewReplacer(`\u003c`, "<", `\u003e`, ">", `\u0026`, "&").Replace(string(b))
}

func pieza(l, a, n any, extra ...any) map[string]any {
	p := map[string]any{"largoMm": l, "anchoMm": a, "cantidad": n, "respetaVeta": false}
	for i := 0; i+1 < len(extra); i += 2 {
		p[extra[i].(string)] = extra[i+1]
	}
	return p
}

func TestAltaColaYFicha(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	u := e.srv.URL + "/api/v1/admin/cortes"

	// Las validaciones del alta, en el orden del esquema de zod.
	casos := []struct {
		cuerpo map[string]any
		msg    string
	}{
		{map[string]any{"contactoNombre": "A", "materialDescripcion": "Melamina", "piezas": []any{}}, "Poné para quién es."},
		{map[string]any{"contactoNombre": "Gómez", "materialDescripcion": "", "piezas": []any{}}, "Falta decir qué placa se corta."},
		{map[string]any{"contactoNombre": "Gómez", "materialDescripcion": "Melamina", "placaLargoMm": "12,5", "piezas": []any{}}, "Invalid input: expected number, received NaN"},
		{map[string]any{"contactoNombre": "Gómez", "materialDescripcion": "Melamina", "placaLargoMm": "7000", "piezas": []any{}}, "Too big: expected number to be <=6000"},
		{map[string]any{"contactoNombre": "Gómez", "materialDescripcion": "Melamina", "piezas": []any{}}, "Agregá al menos una pieza al despiece."},
		{map[string]any{"contactoNombre": "Gómez", "materialDescripcion": "Melamina", "piezas": []any{pieza(0, 300, 1)}}, "Hay una pieza con medidas incompletas."},
		{map[string]any{"contactoNombre": "Gómez", "materialDescripcion": "Melamina", "piezas": []any{pieza(600, 300, 1, "respetaVeta", 1)}}, "Hay una pieza con medidas incompletas."},
	}
	for _, c := range casos {
		if code, b := pedir(t, ven, "POST", u, c.cuerpo); code != 422 || !strings.Contains(b, c.msg) {
			t.Errorf("%v: %d %s (quería %q)", c.cuerpo, code, b, c.msg)
		}
	}

	alta := map[string]any{
		"contactoNombre": "  Gómez  ", "materialDescripcion": "Melamina Blanca — 2750 x 1830 — 18mm",
		"variantId": e.melamina, "customerId": e.cliente, "anchoSierraMm": "4,4", "urgente": true,
		"piezas": []any{
			pieza(900, 600, 4, "cantoLargo", 2, "etiqueta", " Puerta "),
			pieza("700", "400", 2, "respetaVeta", true, "cantoAncho", true),
		},
	}
	code, b := pedir(t, ven, "POST", u, alta)
	if code != 200 || !strings.Contains(b, `"numero":"CRT-1"`) {
		t.Fatalf("alta: %d %s", code, b)
	}
	var id string
	_ = e.pool.QueryRow(context.Background(), `select id::text from cutting_orders where numero = 'CRT-1'`).Scan(&id)

	_, b = pedir(t, ven, "GET", u+"?busqueda=gomez&estado=en-cola", nil)
	var cola []CorteListado
	_ = json.Unmarshal([]byte(b), &cola)
	if len(cola) != 1 || cola[0].Piezas != 6 || !cola[0].Urgente || cola[0].Cliente != "Gómez" || cola[0].Sucursal == nil || cola[0].MetrosCuadrados != 2.72 {
		t.Fatalf("cola: %s", b)
	}

	_, b = pedir(t, ven, "GET", u+"/"+id, nil)
	var f Ficha
	if err := json.Unmarshal([]byte(b), &f); err != nil {
		t.Fatal(err)
	}
	// El cliente es mayorista: la placa a −10 % y la tarifa de su lista.
	if f.Corte.PrecioPlaca == nil || *f.Corte.PrecioPlaca != 76050 || f.Tarifa == nil || f.Tarifa.PrecioPorPasada != 996 {
		t.Errorf("precios del mayorista: %s", b)
	}
	if f.Corte.AnchoSierraMm != 4.4 || f.Corte.Piezas[0].Etiqueta == nil || *f.Corte.Piezas[0].Etiqueta != "Puerta" || f.Corte.Piezas[1].RespetaVeta != 1 || f.Corte.Piezas[1].CantoAncho != 1 {
		t.Errorf("lo guardado: %+v", f.Corte)
	}
	if f.MetrosCanto != 8 {
		t.Errorf("metros de canto: %v", f.MetrosCanto)
	}
	plano := PlanoDelCorte(f.Corte)
	if got, _ := json.Marshal(plano); !bytes.Contains([]byte(b), got) {
		t.Errorf("el plano de la ficha no es el del motor")
	}

	// La cola: avanza hasta retirado y ahí se frena.
	for _, quiere := range []string{"quedó en la máquina", "quedó terminado", "quedó retirado", "El corte ya está retirado."} {
		_, b := pedir(t, ven, "POST", u+"/"+id+"/avanzar", nil)
		if !strings.Contains(b, quiere) {
			t.Errorf("avanzar: %s (quería %q)", b, quiere)
		}
	}
	_, _ = e.pool.Exec(context.Background(), `update cutting_orders set estado = 'cancelado' where id = $1`, id)
	if code, b := pedir(t, ven, "POST", u+"/"+id+"/avanzar", nil); code != 422 || !strings.Contains(b, "está cancelado") {
		t.Errorf("cancelado: %d %s", code, b)
	}
	if _, b := pedir(t, ven, "POST", u+"/"+id+"/urgente", nil); !strings.Contains(b, "volvió al orden normal") {
		t.Errorf("urgente: %s", b)
	}
	if code, _ := pedir(t, ven, "POST", u+"/"+id+"/pasadas", map[string]any{"pasadas": 7.9}); code != 204 {
		t.Errorf("pasadas: %d", code)
	}
	var pasadas int
	_ = e.pool.QueryRow(context.Background(), `select pasadas from cutting_orders where id = $1`, id).Scan(&pasadas)
	if pasadas != 7 {
		t.Errorf("pasadas guardadas: %d", pasadas)
	}
	// El disco no se cambia en un trabajo que ya pasó por la máquina.
	if code, b := pedir(t, ven, "PUT", u+"/"+id+"/sierra", map[string]any{"valor": "3,2"}); code != 422 || !strings.Contains(b, "ya pasó por la máquina") {
		t.Errorf("sierra: %d %s", code, b)
	}
	_, _ = e.pool.Exec(context.Background(), `update cutting_orders set estado = 'en-cola', motor_plano = 1 where id = $1`, id)
	if code, b := pedir(t, ven, "PUT", u+"/"+id+"/sierra", map[string]any{"valor": "11"}); code != 422 || !strings.Contains(b, "entre 0,5 y 10 mm") {
		t.Errorf("sierra fuera de rango: %d %s", code, b)
	}
	if _, b := pedir(t, ven, "PUT", u+"/"+id+"/sierra", map[string]any{"valor": "3,2"}); !strings.Contains(b, "el plano se rehizo con 3,2 mm") && !strings.Contains(b, "el plano se rehizo con 3.2 mm") {
		t.Errorf("sierra: %s", b)
	}
	var motor int
	var sierra float64
	_ = e.pool.QueryRow(context.Background(), `select motor_plano, ancho_sierra_mm::float8 from cutting_orders where id = $1`, id).Scan(&motor, &sierra)
	if motor != 2 || sierra != 3.2 {
		t.Errorf("motor %d, sierra %v", motor, sierra)
	}
	// El acomodo a mano: se guarda y vuelve al automático con la lista vacía.
	if _, b := pedir(t, ven, "PUT", u+"/"+id+"/acomodo", map[string]any{"fijadas": []any{map[string]any{"indice": 0, "unidad": 1, "placa": 2, "girada": true}}}); !strings.Contains(b, "Acomodo guardado.") {
		t.Errorf("acomodo: %s", b)
	}
	var acomodo *string
	_ = e.pool.QueryRow(context.Background(), `select acomodo_manual from cutting_orders where id = $1`, id).Scan(&acomodo)
	if acomodo == nil || *acomodo != `[{"indice":0,"unidad":1,"placa":2,"girada":true}]` {
		t.Errorf("acomodo guardado: %v", acomodo)
	}
	if _, b := pedir(t, ven, "PUT", u+"/"+id+"/acomodo", map[string]any{"fijadas": []any{}}); !strings.Contains(b, "vuelve al automático") {
		t.Errorf("acomodo vacío: %s", b)
	}
	if code, _ := pedir(t, ven, "GET", u+"/"+id+"/hoja", nil); code != 200 {
		t.Errorf("hoja: %d", code)
	}
	var n int
	_ = e.pool.QueryRow(context.Background(), `select count(*) from audit_log where entidad = 'corte'`).Scan(&n)
	if n < 6 {
		t.Errorf("bitácora: %d líneas", n)
	}
	// Sin sesión no se ve nada.
	if code, _ := pedir(t, http.DefaultClient, "GET", u, nil); code != 401 {
		t.Errorf("sin sesión: %d", code)
	}
}

// Veinte altas a la vez: CRT-1…CRT-20 sin huecos ni repetidos, con el mismo
// candado que el TS.
func TestNumeracionConcurrente(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", map[string]any{
				"contactoNombre": "Gómez", "materialDescripcion": "Melamina", "piezas": []any{pieza(500, 400, 1)},
			})
		})
	}
	wg.Wait()
	filas, _ := e.pool.Query(context.Background(), `select numero from cutting_orders`)
	var numeros []string
	for filas.Next() {
		var n string
		_ = filas.Scan(&n)
		numeros = append(numeros, n)
	}
	sort.Strings(numeros)
	vistos := map[string]bool{}
	for _, n := range numeros {
		vistos[n] = true
	}
	for i := 1; i <= 20; i++ {
		if !vistos[fmt.Sprintf("CRT-%d", i)] {
			t.Fatalf("falta CRT-%d: %v", i, numeros)
		}
	}
	if len(numeros) != 20 {
		t.Fatalf("hay %d cortes: %v", len(numeros), numeros)
	}
}

func TestAgenteYArchivos(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	u := e.srv.URL
	pedir(t, ven, "POST", u+"/api/v1/admin/cortes", map[string]any{
		"contactoNombre": "Gómez", "materialDescripcion": "Melamina 18mm; blanca",
		"piezas": []any{pieza(1229, 600, 2, "cantoLargo", 2, "etiqueta", "Lateral")},
	})
	var id string
	_ = e.pool.QueryRow(context.Background(), `select id::text from cutting_orders`).Scan(&id)

	// El agente: sin token, 401; con token, la cola.
	if code, _ := pedir(t, http.DefaultClient, "GET", u+"/api/cortes/pendientes", nil); code != 401 {
		t.Errorf("sin token: %d", code)
	}
	code, b := pedir(t, http.DefaultClient, "GET", u+"/api/cortes/pendientes", nil, "Authorization", "Bearer "+tokenAgente)
	if code != 200 || !strings.Contains(b, `"numero":"CRT-1"`) || !strings.Contains(b, `"piezas":2`) {
		t.Fatalf("pendientes: %d %s", code, b)
	}
	// La lista: con el genérico, BOM y CRLF.
	code, b = pedir(t, http.DefaultClient, "GET", u+"/api/cortes/"+id+"/lista", nil, "Authorization", "Bearer "+tokenAgente)
	quiere := "\xef\xbb\xbfLargo;Ancho;Cantidad;Material;Etiqueta;Veta;Canto largo;Canto ancho\r\n1229;600;2;\"Melamina 18mm; blanca\";Lateral;No;2;No\r\n"
	if code != 200 || b != quiere {
		t.Errorf("lista: %d %q", code, b)
	}
	// Un formato propio, por defecto: en centímetros y con tabulador.
	if code, b := pedir(t, ven, "POST", u+"/api/v1/admin/cortes/perfiles", map[string]any{
		"nombre": "Cutty", "separador": "tab", "conEncabezado": false, "unidad": "cm", "decimal": ".",
		"finDeLinea": "lf", "porDefecto": true, "columnas": []any{map[string]any{"clave": "largo", "encabezado": "L"}, map[string]any{"clave": "numero", "encabezado": "N"}},
	}); code != 204 {
		t.Fatalf("perfil: %d %s", code, b)
	}
	if code, b := pedir(t, ven, "POST", u+"/api/v1/admin/cortes/perfiles", map[string]any{
		"nombre": "X", "separador": ";", "conEncabezado": false, "unidad": "mm", "decimal": ",", "finDeLinea": "lf", "porDefecto": false, "columnas": []any{},
	}); code != 422 || !strings.Contains(b, "Poné un nombre.") {
		t.Errorf("perfil sin nombre: %d %s", code, b)
	}
	_, b = pedir(t, ven, "GET", u+"/api/cortes/"+id+"/lista", nil)
	if b != "\xef\xbb\xbf122.9\tCRT-1\n" {
		t.Errorf("lista en cm: %q", b)
	}
	// El PTX: solo con sesión.
	if code, _ := pedir(t, http.DefaultClient, "GET", u+"/api/cortes/"+id+"/ptx", nil, "Authorization", "Bearer "+tokenAgente); code != 401 {
		t.Errorf("ptx con token: %d", code)
	}
	code, b = pedir(t, ven, "GET", u+"/api/cortes/"+id+"/ptx", nil)
	if code != 200 || !strings.HasPrefix(b, "HEADER,1.14,MJBJ CRT-1,0,0,1\r\n") || !strings.Contains(b, "PARTS_REQ,1,1,P1_LATERAL,1,1229.0,600.0,2,0,0,0,2,0,0,0\r\n") {
		t.Errorf("ptx: %d %q", code, b)
	}
	// Los perfiles: borrar.
	var pid string
	_ = e.pool.QueryRow(context.Background(), `select id::text from cutting_export_profiles`).Scan(&pid)
	if code, _ := pedir(t, ven, "DELETE", u+"/api/v1/admin/cortes/perfiles/"+pid, nil); code != 204 {
		t.Errorf("borrar: %d", code)
	}
	if code, b := pedir(t, ven, "DELETE", u+"/api/v1/admin/cortes/perfiles/"+pid, nil); code != 422 || !strings.Contains(b, "ya no estaba") {
		t.Errorf("borrar dos veces: %d %s", code, b)
	}
}

func TestTarifasParametrosYCalculadoras(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	u := e.srv.URL + "/api/v1/"
	if code, _ := pedir(t, ven, "POST", u+"admin/cortes/tarifas", map[string]any{"material": "Tableros", "precioPorPasada": "1.400", "activo": true}); code != 403 {
		t.Errorf("vendedor: %d", code)
	}
	if code, b := pedir(t, adm, "POST", u+"admin/cortes/tarifas", map[string]any{"material": "Tableros de madera", "precioPorPasada": "1.400", "activo": true}); code != 204 {
		t.Fatalf("tarifa: %d %s", code, b)
	}
	if code, b := pedir(t, adm, "POST", u+"admin/cortes/tarifas", map[string]any{"material": "Placas", "precioPorPasada": "1000", "activo": true}); code != 422 || !strings.Contains(b, `Ya hay una tarifa de \"Placas\"`) {
		t.Errorf("repetida: %d %s", code, b)
	}
	if code, b := pedir(t, adm, "POST", u+"admin/cortes/tarifas", map[string]any{"material": "Otra", "precioPorPasada": "0", "activo": true}); code != 422 || !strings.Contains(b, "mayor a cero") {
		t.Errorf("cero: %d %s", code, b)
	}
	_, b := pedir(t, ven, "GET", u+"admin/cortes/tarifas/activas", nil)
	if !strings.Contains(b, `"material":"Tableros de madera","priceListId":null,"precioPorPasada":1400`) {
		t.Errorf("activas: %s", b)
	}

	// Los parámetros: sin fila, los del código; después, los guardados.
	if _, b := pedir(t, http.DefaultClient, "GET", u+"calculadora/parametros", nil); !strings.Contains(b, `"mermaMachimbre":0.2`) {
		t.Errorf("por defecto: %s", b)
	}
	form := map[string]string{"mermaMachimbre": "25", "factorPendiente": "15", "margenSeguridad": "12", "anchoSierraMm": "4,44",
		"rindeRolloMembrana": "9", "rindeRolloAislacion": "21.6", "separacionTechoM": "0.6", "separacionPisoM": "0.4",
		"deckGrandisLargoM": "2.4", "deckGrandisAnchoM": "0.1", "deckPvcLargoM": "2.9", "deckPvcAnchoM": "0.14"}
	if code, b := pedir(t, adm, "PUT", u+"admin/calculadoras", form); code != 422 || !strings.Contains(b, "anchoSierraMm: Invalid input: expected number, received NaN") {
		t.Errorf("coma: %d %s", code, b)
	}
	form["anchoSierraMm"] = "4.44"
	form["margenSeguridad"] = "120"
	if code, b := pedir(t, adm, "PUT", u+"admin/calculadoras", form); code != 422 || !strings.Contains(b, "margenSeguridad: Más de 100 %") {
		t.Errorf("120 %%: %d %s", code, b)
	}
	form["margenSeguridad"] = "12"
	if code, b := pedir(t, adm, "PUT", u+"admin/calculadoras", form); code != 204 {
		t.Fatalf("guardar: %d %s", code, b)
	}
	if _, b := pedir(t, http.DefaultClient, "GET", u+"calculadora/parametros", nil); !strings.Contains(b, `"mermaMachimbre":0.25`) || !strings.Contains(b, `"anchoSierraMm":4.4`) {
		t.Errorf("guardados: %s", b)
	}
	// Las calculadoras, con los parámetros de la base.
	if _, b := pedir(t, http.DefaultClient, "POST", u+"calculadora/deck", map[string]any{"largo": 4, "ancho": 3, "material": "grandis"}); !strings.Contains(b, `"tablas":56`) {
		t.Errorf("deck: %s", b)
	}
	if _, b := pedir(t, http.DefaultClient, "POST", u+"calculadora/techo", map[string]any{"largo": 5, "ancho": 4, "tipo": "saligna"}); !strings.Contains(b, `"medida":"3\" x 6\" x 6m"`) {
		t.Errorf("techo: %s", b)
	}
	if code, _ := pedir(t, http.DefaultClient, "POST", u+"calculadora/placas", map[string]any{"piezas": []any{map[string]any{"ancho": 600, "largo": 900, "cantidad": 4}}, "placaAncho": 1830, "placaLargo": 2750}); code != 200 {
		t.Errorf("placas: %d", code)
	}
	if code, _ := pedir(t, http.DefaultClient, "POST", u+"calculadora/piso", map[string]any{"largo": 4, "ancho": 3}); code != 200 {
		t.Errorf("piso: %d", code)
	}
	if _, b := pedir(t, http.DefaultClient, "POST", u+"calculadora/sugerencias", map[string]any{"terminos": []string{"fenolico", "nada que exista"}}); !strings.Contains(b, `"precio":"60000.55"`) || strings.Count(b, "variantId") != 1 {
		t.Errorf("sugerencias: %s", b)
	}
}

func TestArmadorPublicoYCarrito(t *testing.T) {
	e := armar(t)
	u := e.srv.URL + "/api/v1/cortes/"
	_, b := pedir(t, http.DefaultClient, "GET", u+"placas?publico=true", nil)
	var placas []PlacaCortable
	_ = json.Unmarshal([]byte(b), &placas)
	// El fenólico es de «Tableros de madera» y no tiene tarifa: no se ofrece.
	if len(placas) != 1 || placas[0].VariantID != e.melamina || placas[0].PrecioPorPasada != 1200 || !placas[0].AdmiteMedia {
		t.Fatalf("placas: %s", b)
	}
	if code, _ := pedir(t, http.DefaultClient, "GET", u+"placas?lista="+e.mayorista, nil); code != 403 {
		t.Errorf("lista sin secreto: %d", code)
	}
	if _, b := pedir(t, http.DefaultClient, "GET", u+"placas?lista="+e.mayorista, nil, "Authorization", "Bearer "+secretoInterno); !strings.Contains(b, `"precio":76050`) || !strings.Contains(b, `"precioPorPasada":996`) {
		t.Errorf("lista del mayorista: %s", b)
	}

	// El plano del navegador.
	code, b := pedir(t, http.DefaultClient, "POST", u+"plano", map[string]any{
		"piezas": []any{map[string]any{"largoMm": 900, "anchoMm": 600, "cantidad": 3, "respetaVeta": 0}}, "placaLargo": 2750, "placaAncho": 915,
		"presupuesto": map[string]any{"precioPorPlaca": 84500, "fraccion": 0.55, "tarifa": map[string]any{"material": "x", "priceListId": nil, "precioPorPasada": 1200, "precioPorMetroCanto": 0}},
	})
	if code != 200 || !strings.Contains(b, `"cuenta"`) || !strings.Contains(b, `"placasEnteras":1`) {
		t.Errorf("plano: %d %s", code, b)
	}

	// Cotizar para el carrito: las mismas validaciones que el esquema.
	cot := func(c map[string]any) (int, string) { return pedir(t, http.DefaultClient, "POST", u+"cotizar", c) }
	if code, b := cot(map[string]any{"variantId": "x", "piezas": []any{}}); code != 422 || !strings.Contains(b, "Invalid UUID") {
		t.Errorf("uuid: %d %s", code, b)
	}
	if code, b := cot(map[string]any{"variantId": e.melamina, "piezas": []any{map[string]any{"largoMm": 900, "anchoMm": 600, "cantidad": 201, "respetaVeta": 0, "cantoLargo": 0, "cantoAncho": 0}}}); code != 422 || !strings.Contains(b, "Too big: expected number to be <=200") {
		t.Errorf("cantidad: %d %s", code, b)
	}
	muchas := []any{}
	for range 6 {
		muchas = append(muchas, map[string]any{"largoMm": 100, "anchoMm": 100, "cantidad": 200, "respetaVeta": 0, "cantoLargo": 0, "cantoAncho": 0})
	}
	if code, b := cot(map[string]any{"variantId": e.melamina, "piezas": muchas}); code != 422 || !strings.Contains(b, "Son demasiadas piezas") {
		t.Errorf("tope: %d %s", code, b)
	}
	if code, b := cot(map[string]any{"variantId": e.melamina, "piezas": []any{map[string]any{"largoMm": 3000, "anchoMm": 600, "cantidad": 1, "respetaVeta": 1, "cantoLargo": 0, "cantoAncho": 0}}}); code != 422 || !strings.Contains(b, "Hay una pieza que no entra") {
		t.Errorf("no entra: %d %s", code, b)
	}
	code, b = cot(map[string]any{"variantId": e.melamina, "mitad": "largo", "cantoDescripcion": " Blanco ", "piezas": []any{map[string]any{"largoMm": "900", "anchoMm": 600, "cantidad": 3, "respetaVeta": 0, "cantoLargo": 1, "cantoAncho": 0, "etiqueta": nil}}})
	var c CorteCotizado
	_ = json.Unmarshal([]byte(b), &c)
	if code != 200 || c.PlacaAnchoMm != 915 || c.Placas != 1 || c.CantoDescripcion == nil || *c.CantoDescripcion != "Blanco" {
		t.Fatalf("cotizar: %d %s", code, b)
	}

	// El carrito: se guarda como lo haría Next y se resuelve con el secreto.
	piezas, _ := json.Marshal(c.Piezas)
	var cart string
	_ = e.pool.QueryRow(context.Background(), `insert into carts (token) values ('t') returning id::text`).Scan(&cart)
	_, err := e.pool.Exec(context.Background(), `insert into cart_cortes (cart_id, variant_id, material_descripcion, placa_largo_mm, placa_ancho_mm, mitad, canto_descripcion, piezas, placas, pasadas, total)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, cart, c.VariantID, c.MaterialDescripcion, c.PlacaLargoMm, c.PlacaAnchoMm, c.Mitad, c.CantoDescripcion, string(piezas), c.Placas, c.Pasadas, c.Total)
	if err != nil {
		t.Fatal(err)
	}
	if code, _ := pedir(t, http.DefaultClient, "POST", u+"carrito", map[string]any{"cartId": cart}); code != 403 {
		t.Errorf("carrito sin secreto: %d", code)
	}
	_, b = pedir(t, http.DefaultClient, "POST", u+"carrito", map[string]any{"cartId": cart}, "Authorization", "Bearer "+secretoInterno)
	var r struct {
		Resueltos []CorteResuelto `json:"resueltos"`
		Error     string          `json:"error"`
	}
	_ = json.Unmarshal([]byte(b), &r)
	if len(r.Resueltos) != 1 || r.Error != "" || jsonTotal(r.Resueltos[0]) != c.Total {
		t.Fatalf("carrito: %s", b)
	}
	if !strings.Contains(b, "media placa, partida a lo largo") || !strings.Contains(b, "Tapacanto pegado — Blanco") {
		t.Errorf("líneas: %s", b)
	}
}

func jsonTotal(c CorteResuelto) string {
	return fmt.Sprintf("%.2f", c.Cuenta.Total)
}
