package productos

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
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/productosapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
	"mjbj/internal/subidas"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

type entorno struct {
	srv  *httptest.Server
	pool *pgxpool.Pool
	ses  *auth.Servicio
	cat  string
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-productos-32-caracteres", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	productosapi.HandlerWithOptions(
		productosapi.NewStrictHandlerWithOptions(NuevaAPI(Nuevo(pool, subidas.Nuevo(subidas.Config{Carpeta: t.TempDir()}), silencio)),
			[]productosapi.StrictMiddlewareFunc{plataforma.ConPedido[productosapi.StrictHandlerFunc]},
			productosapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		productosapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := productosapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := productosapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	e := &entorno{srv: srv, pool: pool, ses: ses}
	ctx := context.Background()
	_ = pool.QueryRow(ctx, `insert into categories (slug, name, description) values ('placas', 'Placas', '') returning id`).Scan(&e.cat)
	_, _ = pool.Exec(ctx, `insert into price_lists (slug, name, is_default) values ('general', 'General', true), ('profesional', 'Profesional', false)`)
	_, _ = pool.Exec(ctx, `insert into branches (slug, name, sort_order) values ('casa-central', 'Casa Central', 1), ('aserradero', 'Aserradero', 2)`)
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

func pedir(t *testing.T, c *http.Client, metodo, url string, cuerpo any) (int, string) {
	t.Helper()
	var r io.Reader
	tipo := "application/json"
	switch b := cuerpo.(type) {
	case nil:
	case *bytes.Buffer:
		r = b
		tipo = ""
	default:
		crudo, _ := json.Marshal(b)
		r = bytes.NewReader(crudo)
	}
	req, _ := http.NewRequest(metodo, url, r)
	if cuerpo != nil && tipo != "" {
		req.Header.Set("Content-Type", tipo)
	}
	if mp, ok := cuerpo.(*bytes.Buffer); ok && mp != nil {
		req.Header.Set("Content-Type", tipoMultipart)
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(out)
}

var tipoMultipart string

func (e *entorno) ficha(nombre string, variantes ...map[string]string) map[string]any {
	vs := []map[string]string{}
	for _, v := range variantes {
		base := map[string]string{"sku": "FEN18", "label": "18 mm", "precioGeneral": "84500", "precioProfesional": "70000",
			"stockCentral": "3", "stockAserradero": "0", "minCentral": "1", "minAserradero": "0"}
		for k, x := range v {
			base[k] = x
		}
		vs = append(vs, base)
	}
	return map[string]any{"name": nombre, "slug": GenerarSlug(nombre), "categoryId": e.cat, "unit": "placa",
		"formaDeVenta": "entera", "precioMediaPct": "50", "alicuotaIva": "21", "active": true, "variantes": vs}
}

func TestLaFichaDeProducto(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", "admin")
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/"

	// El depósito ve las categorías (las usa la pantalla de stock) pero no
	// carga productos.
	if c, _ := pedir(t, dep, "GET", u+"categorias", nil); c != 200 {
		t.Errorf("categorías para el depósito: %d", c)
	}
	if c, _ := pedir(t, dep, "POST", u+"productos", e.ficha("Fenólico")); c != 403 {
		t.Errorf("el depósito cargó un producto: %d", c)
	}
	// El error de zod, con su campo.
	if c, b := pedir(t, adm, "POST", u+"productos", e.ficha("Fenólico", map[string]string{"sku": "F"})); c != 422 ||
		!strings.Contains(b, `"variantes.0.sku":"El código tiene que tener al menos 2 letras o números."`) {
		t.Errorf("sku corto: %d %s", c, b)
	}

	c, b := pedir(t, adm, "POST", u+"productos", e.ficha("Fenólico", map[string]string{}, map[string]string{"sku": "FEN12", "label": "12 mm", "stockAserradero": "2,5"}))
	if c != 201 {
		t.Fatalf("crear: %d %s", c, b)
	}
	var creado struct{ ID string }
	_ = json.Unmarshal([]byte(b), &creado)
	_, b = pedir(t, adm, "GET", u+"productos/"+creado.ID, nil)
	var f Ficha
	_ = json.Unmarshal([]byte(b), &f)
	if f.AlicuotaIva != "21.00" || f.PrecioMediaPct != 50 || len(f.Variantes) != 2 || f.Variantes[0].PrecioGeneral != "84500.00" ||
		f.Variantes[0].PrecioProfesional != "70000.00" || f.Variantes[0].StockCentral != 3 || f.Variantes[1].StockAserradero != 2.5 {
		t.Fatalf("la ficha: %s", b)
	}
	// Cada cantidad que cambió dejó su movimiento.
	var notas []string
	filas, _ := e.pool.Query(ctx, `select note from inventory_movements order by note`)
	for filas.Next() {
		var n string
		_ = filas.Scan(&n)
		notas = append(notas, n)
	}
	filas.Close()
	if len(notas) != 3 || notas[0] != "Ajuste manual desde la ficha del producto (0 → 2,5)" {
		t.Errorf("movimientos: %q", notas)
	}

	// Editar: el 12 mm no viene (se desactiva, no se borra), el stock cambia.
	edit := e.ficha("Fenólico", map[string]string{"id": f.Variantes[0].ID, "stockCentral": "1"})
	if c, b := pedir(t, adm, "PUT", u+"productos/"+creado.ID, edit); c != 200 {
		t.Fatalf("editar: %d %s", c, b)
	}
	var activas int
	_ = e.pool.QueryRow(ctx, `select count(*) from product_variants where product_id = $1 and active`, creado.ID).Scan(&activas)
	var ultima string
	_ = e.pool.QueryRow(ctx, `select note || ' ' || qty::text from inventory_movements where note like '%(3 → 1)%'`).Scan(&ultima)
	if activas != 1 || ultima != "Ajuste manual desde la ficha del producto (3 → 1) -2.000" {
		t.Errorf("después de editar: %d activas, movimiento %q", activas, ultima)
	}

	// Otro «Fenólico» nuevo: el slug sale con sufijo. Editando, choca.
	if c, b := pedir(t, adm, "POST", u+"productos", e.ficha("Fenólico", map[string]string{"sku": "FEN18B"})); c != 201 {
		t.Fatalf("segundo: %d %s", c, b)
	}
	var slugs string
	_ = e.pool.QueryRow(ctx, `select string_agg(slug, ',' order by slug) from products`).Scan(&slugs)
	if slugs != "fenolico,fenolico-2" {
		t.Errorf("slugs: %s", slugs)
	}
	otro := e.ficha("Fenólico", map[string]string{"id": f.Variantes[0].ID})
	otro["slug"] = "fenolico-2"
	if c, b := pedir(t, adm, "PUT", u+"productos/"+creado.ID, otro); c != 422 || !strings.Contains(b, "misma dirección web") {
		t.Errorf("slug ajeno al editar: %d %s", c, b)
	}

	// El listado (el stock total suma también la medida desactivada, como el TS).
	// El listado es de /admin/productos: el depósito no (antes sí, por la API).
	if c, _ := pedir(t, dep, "GET", u+"productos?busqueda=fenol", nil); c != 403 {
		t.Errorf("el depósito leyó el listado: %d", c)
	}
	_, b = pedir(t, adm, "GET", u+"productos?busqueda=fenol", nil)
	var lista []ProductoAdmin
	_ = json.Unmarshal([]byte(b), &lista)
	if len(lista) != 2 {
		t.Fatalf("listado: %s", b)
	}
	for _, p := range lista {
		if p.ID == creado.ID && (p.Variantes != 2 || p.StockTotal != 6.5 || p.PrecioDesde == nil || *p.PrecioDesde != "84500" || !p.SinFoto) {
			t.Errorf("fila del listado: %+v", p)
		}
	}
	// Darlo de baja.
	if c, _ := pedir(t, adm, "POST", u+"productos/"+creado.ID+"/activo", map[string]bool{"activo": false}); c != 204 {
		t.Error("baja")
	}
	var bitacora int
	_ = e.pool.QueryRow(ctx, `select count(*) from audit_log where entidad = 'producto'`).Scan(&bitacora)
	if bitacora != 4 {
		t.Errorf("bitácora: %d líneas", bitacora)
	}
}

// La ficha toma el candado del stock (lib/inventario/locks.ts): una venta
// que baja el stock a la vez que alguien edita la ficha no se pierde. Sin el
// candado, la ficha leía el «anterior» antes de la venta y lo pisaba.
func TestFichaConCandado(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", "admin")
	u := e.srv.URL + "/api/v1/admin/productos"
	_, b := pedir(t, adm, "POST", u, e.ficha("Melamina", map[string]string{"stockCentral": "500"}))
	var creado struct{ ID string }
	_ = json.Unmarshal([]byte(b), &creado)
	_, b = pedir(t, adm, "GET", u+"/"+creado.ID, nil)
	var f Ficha
	_ = json.Unmarshal([]byte(b), &f)
	var central string
	_ = e.pool.QueryRow(ctx, `select id from branches where slug = 'casa-central'`).Scan(&central)
	vid := f.Variantes[0].ID

	var wg sync.WaitGroup
	for i := range 6 {
		wg.Add(2)
		go func() { // una venta, como las reservas del TS
			defer wg.Done()
			for range 5 {
				tx, err := e.pool.Begin(ctx)
				if err != nil {
					t.Error(err)
					return
				}
				_, _ = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1::text || $2::text))`, vid, central)
				_, _ = tx.Exec(ctx, `update inventory set qty = qty - 1 where variant_id = $1 and branch_id = $2`, vid, central)
				_, _ = tx.Exec(ctx, `insert into inventory_movements (variant_id, branch_id, type, qty) values ($1, $2, 'venta', -1)`, vid, central)
				_ = tx.Commit(ctx)
			}
		}()
		go func() {
			defer wg.Done()
			pedir(t, adm, "PUT", u+"/"+creado.ID, e.ficha("Melamina", map[string]string{"id": vid, "stockCentral": strconv.Itoa(400 + i)}))
		}()
	}
	wg.Wait()
	// Sumados, los movimientos dan el stock final.
	var suma, final float64
	_ = e.pool.QueryRow(ctx, `select coalesce(sum(qty), 0)::float8 from inventory_movements where variant_id = $1 and branch_id = $2`, vid, central).Scan(&suma)
	_ = e.pool.QueryRow(ctx, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, vid, central).Scan(&final)
	if suma != final {
		t.Errorf("los movimientos suman %v y el stock es %v", suma, final)
	}
}

func TestRubrosSugeridosImagenesYCandidatos(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	u := e.srv.URL + "/api/v1/admin/"

	ids := []string{}
	for _, n := range []string{"Fenólico", "Melamina blanca"} {
		_, b := pedir(t, adm, "POST", u+"productos", e.ficha(n, map[string]string{"sku": GenerarSlug(n)}))
		var c struct{ ID string }
		_ = json.Unmarshal([]byte(b), &c)
		ids = append(ids, c.ID)
	}
	_, _ = e.pool.Exec(ctx, `update products set subcategory = 'Fenólicos' where id = $1`, ids[0])

	// Rubros: crear, el repetido no, enganchar el que estaba como texto.
	if c, b := pedir(t, ven, "POST", u+"rubros", map[string]string{"categoryId": e.cat, "name": "Fenolicos"}); c != 204 {
		t.Fatalf("rubro: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", u+"rubros", map[string]string{"categoryId": e.cat, "name": "Fenólicos"}); c != 422 || !strings.Contains(b, "ya tiene un rubro") {
		t.Errorf("rubro repetido: %d %s", c, b)
	}
	_, b := pedir(t, ven, "GET", u+"rubros/por-categoria", nil)
	if !strings.Contains(b, `"productos":0,"sueltos":1`) {
		t.Errorf("antes de enganchar: %s", b)
	}
	var rubro string
	_ = e.pool.QueryRow(ctx, `select id from subcategories`).Scan(&rubro)
	if _, b := pedir(t, ven, "POST", u+"rubros/"+rubro+"/enganchar", nil); !strings.Contains(b, `1 producto enganchado a \"Fenolicos\".`) {
		t.Errorf("enganchar: %s", b)
	}
	if _, b := pedir(t, ven, "GET", u+"rubros/por-categoria", nil); !strings.Contains(b, `"productos":1,"sueltos":0`) {
		t.Errorf("después de enganchar: %s", b)
	}

	// Sugeridos.
	if c, b := pedir(t, ven, "POST", u+"productos/"+ids[0]+"/sugeridos", map[string]string{"relatedProductId": ids[0], "tipo": "similar"}); c != 422 || !strings.Contains(b, "a sí mismo") {
		t.Errorf("sugerirse a sí mismo: %d %s", c, b)
	}
	if _, b := pedir(t, ven, "POST", u+"productos/"+ids[0]+"/sugeridos", map[string]string{"relatedProductId": ids[1], "tipo": "complementario"}); !strings.Contains(b, "Melamina blanca quedó como complementario.") {
		t.Errorf("sugerir: %s", b)
	}
	if c, b := pedir(t, ven, "POST", u+"productos/"+ids[0]+"/sugeridos", map[string]string{"relatedProductId": ids[1], "tipo": "complementario"}); c != 422 || !strings.Contains(b, "ya estaba en la lista") {
		t.Errorf("repetido: %d %s", c, b)
	}
	_, b = pedir(t, ven, "GET", u+"productos/"+ids[0]+"/sugeridos", nil)
	var sug []Sugerido
	_ = json.Unmarshal([]byte(b), &sug)
	if len(sug) != 1 || sug[0].Categoria != "Placas" || sug[0].Imagen != nil {
		t.Fatalf("sugeridos: %s", b)
	}
	if c, _ := pedir(t, ven, "DELETE", u+"productos/"+ids[0]+"/sugeridos/"+sug[0].ID, nil); c != 204 {
		t.Error("quitar")
	}

	// Imágenes: subir dos, hacer principal la segunda, borrar.
	png := append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 64)...)
	subir := func() string {
		var cuerpo bytes.Buffer
		w := multipart.NewWriter(&cuerpo)
		p, _ := w.CreatePart(map[string][]string{"Content-Disposition": {`form-data; name="archivo"; filename="f.png"`}, "Content-Type": {"image/png"}})
		_, _ = p.Write(png)
		_ = w.Close()
		tipoMultipart = w.FormDataContentType()
		c, b := pedir(t, ven, "POST", u+"productos/"+ids[0]+"/imagenes", &cuerpo)
		if c != 201 {
			t.Fatalf("subir: %d %s", c, b)
		}
		var r struct{ ID string }
		_ = json.Unmarshal([]byte(b), &r)
		return r.ID
	}
	_, segunda := subir(), subir()
	if _, b := pedir(t, ven, "POST", u+"imagenes/"+segunda+"/principal", nil); !strings.Contains(b, ids[0]) {
		t.Errorf("principal: %s", b)
	}
	_, b = pedir(t, ven, "GET", u+"productos/"+ids[0], nil)
	var f Ficha
	_ = json.Unmarshal([]byte(b), &f)
	if len(f.Galeria) != 2 || f.Galeria[0].ID != segunda {
		t.Errorf("galería: %s", b)
	}
	if c, _ := pedir(t, ven, "DELETE", u+"imagenes/"+segunda, nil); c != 200 {
		t.Error("borrar imagen")
	}

	// Candidatos: el umbral es del admin; uno viejo sin ventas aparece.
	if c, _ := pedir(t, ven, "PUT", u+"productos-candidatos", map[string]int{"meses": 6}); c != 403 {
		t.Errorf("el vendedor cambió el umbral: %d", c)
	}
	if c, b := pedir(t, adm, "PUT", u+"productos-candidatos", map[string]int{"meses": 61}); c != 422 || !strings.Contains(b, "entre 1 y 60") {
		t.Errorf("61 meses: %d %s", c, b)
	}
	_, _ = pedir(t, adm, "PUT", u+"productos-candidatos", map[string]int{"meses": 6})
	_, _ = e.pool.Exec(ctx, `update products set created_at = now() - interval '1 year' where id = $1`, ids[1])
	_, _ = e.pool.Exec(ctx, `update inventory set qty = 0`)
	_, b = pedir(t, ven, "GET", u+"productos-candidatos", nil)
	var cands struct {
		Meses      int
		Candidatos []Candidato
	}
	_ = json.Unmarshal([]byte(b), &cands)
	if cands.Meses != 6 || len(cands.Candidatos) != 2 || cands.Candidatos[0].ID != ids[1] ||
		strings.Join(cands.Candidatos[0].Motivos, "|") != "Nunca se vendió|Sin stock en ninguna sucursal" {
		t.Errorf("candidatos: %s", b)
	}
	_ = time.Now
}
