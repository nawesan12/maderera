package migracion

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/migracionapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

type entorno struct {
	srv  *httptest.Server
	pool *pgxpool.Pool
	ses  *auth.Servicio
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-la-migracion-de-32-caracteres", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	migracionapi.HandlerWithOptions(
		migracionapi.NewStrictHandlerWithOptions(NuevaAPI(Nuevo(pool, silencio)),
			[]migracionapi.StrictMiddlewareFunc{plataforma.ConPedido[migracionapi.StrictHandlerFunc]},
			migracionapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		migracionapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := migracionapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := migracionapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)

	// Lo que la migración espera encontrar: las dos sucursales y las dos
	// listas de precios.
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO branches (slug, name) VALUES ('casa-central', 'Casa Central'), ('aserradero', 'Aserradero');
		INSERT INTO price_lists (slug, name, is_default) VALUES ('general', 'General', true), ('profesional', 'Profesional', false);`); err != nil {
		t.Fatal(err)
	}
	return &entorno{srv: srv, pool: pool, ses: ses}
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

func pedir(t *testing.T, c *http.Client, metodo, url string, cuerpo, destino any) int {
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
	return hacer(t, c, req, destino)
}

func hacer(t *testing.T, c *http.Client, req *http.Request, destino any) int {
	t.Helper()
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 200 && destino != nil {
		if err := json.Unmarshal(b, destino); err != nil {
			t.Fatalf("%s: %v (%s)", req.URL.Path, err, b)
		}
	}
	return resp.StatusCode
}

func subir(t *testing.T, c *http.Client, url, entidad, nombre string, datos []byte, destino any) int {
	t.Helper()
	var cuerpo bytes.Buffer
	w := multipart.NewWriter(&cuerpo)
	_ = w.WriteField("entidad", entidad)
	if datos != nil {
		p, _ := w.CreateFormFile("archivo", nombre)
		_, _ = p.Write(datos)
	}
	_ = w.Close()
	req, _ := http.NewRequest("POST", url, &cuerpo)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return hacer(t, c, req, destino)
}

func muestra(t *testing.T, nombre string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dirGolden, "archivos", nombre))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// sinLaAlicuotaRota es la muestra de artículos sin el renglón con IVA 105 %,
// que no entra en numeric(4,2) y deshace su lote entero (como en el TS; ver
// TestLoteQueFallaSeDejaSinEfecto).
func sinLaAlicuotaRota(t *testing.T) []byte {
	b := muestra(t, "articulos-isis.csv")
	return bytes.Replace(b, []byte("MIG-IVA-01;Raro;Varios;;Juego;;100;;105;;;\r\n"), nil, 1)
}

func contarFilas(t *testing.T, pool *pgxpool.Pool, consulta string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), consulta, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", consulta, err)
	}
	return n
}

type totales struct{ creados, actualizados, omitidos, conError int }

// migrar corre una entidad de punta a punta como la pantalla: analizar,
// vista previa, abrir la corrida, los lotes de a Lote filas y cerrar.
func migrar(t *testing.T, e *entorno, c *http.Client, entidad, nombre string, datos []byte) (totales, []Rechazo, []Control) {
	t.Helper()
	u := e.srv.URL + "/api/v1/admin/migracion/"
	var a ArchivoAnalizado
	if s := subir(t, c, u+"analizar", entidad, nombre, datos, &a); s != 200 || a.Error != "" {
		t.Fatalf("analizar %s: %d %q", nombre, s, a.Error)
	}
	cuerpo := map[string]any{"entidad": entidad, "mapeo": a.Mapeo, "filas": a.Filas}
	var previa VistaPrevia
	if s := pedir(t, c, "POST", u+"previa", cuerpo, &previa); s != 200 || previa.Error != "" {
		t.Fatalf("previa %s: %d %q", nombre, s, previa.Error)
	}
	var corrida struct{ RunID string }
	if s := pedir(t, c, "POST", u+"corridas", map[string]any{"entidad": entidad, "archivo": a.Archivo,
		"codificacion": a.Codificacion, "mapeo": a.Mapeo, "filasTotales": len(a.Filas)}, &corrida); s != 200 {
		t.Fatalf("iniciar %s: %d", nombre, s)
	}
	var tot totales
	var rechazos []Rechazo
	for desde := 0; desde < len(a.Filas); desde += Lote {
		hasta := min(desde+Lote, len(a.Filas))
		var l struct {
			Error string `json:"error"`
			Resultado
		}
		if s := pedir(t, c, "POST", u+"corridas/"+corrida.RunID+"/lote", map[string]any{"entidad": entidad, "mapeo": a.Mapeo,
			"filas": a.Filas[desde:hasta]}, &l); s != 200 || l.Error != "" {
			t.Fatalf("lote %s: %d %q", nombre, s, l.Error)
		}
		tot.creados += l.Creados
		tot.actualizados += l.Actualizados
		tot.omitidos += l.Omitidos
		tot.conError += l.ConError
		rechazos = append(rechazos, l.Rechazos...)
	}
	var cierre struct{ Controles []Control }
	if s := pedir(t, c, "POST", u+"corridas/"+corrida.RunID+"/cerrar", cuerpo, &cierre); s != 200 {
		t.Fatalf("cerrar %s: %d", nombre, s)
	}
	return tot, rechazos, cierre.Controles
}

// lo que tiene que quedar igual al repetir una corrida.
const fotoDeLaBase = `SELECT
	(SELECT count(*) FROM customers), (SELECT count(*) FROM products), (SELECT count(*) FROM product_variants),
	(SELECT count(*) FROM categories), (SELECT count(*) FROM price_list_items), (SELECT count(*) FROM price_history),
	(SELECT count(*) FROM inventory), (SELECT coalesce(sum(qty), 0) FROM inventory), (SELECT count(*) FROM inventory_movements),
	(SELECT count(*) FROM account_movements), (SELECT coalesce(sum(monto), 0) FROM account_movements),
	(SELECT count(*) FROM suppliers), (SELECT count(*) FROM supplier_movements),
	(SELECT count(*) FROM historical_sales), (SELECT coalesce(sum(total), 0) FROM historical_sales),
	(SELECT count(*) FROM historical_invoices)`

func foto(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	rows, err := pool.Query(context.Background(), fotoDeLaBase)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	rows.Next()
	v, err := rows.Values()
	if err != nil {
		t.Fatal(err)
	}
	return fmt.Sprint(v...)
}

var orden = []struct{ entidad, archivo string }{
	{"clientes", "clientes-isis.csv"},
	{"clientes", "clientes-utf8.csv"},
	{"productos", "articulos-isis.csv"},
	{"productos", "articulos-isis.xlsx"},
	{"stock", "existencias-isis.csv"},
	{"saldos", "saldos-isis.csv"},
	{"proveedores", "proveedores-isis.csv"},
	{"ventas_historicas", "ventas-isis.csv"},
	{"ventas_historicas", "ventas-isis.xlsx"},
	{"comprobantes_historicos", "comprobantes-isis.csv"},
}

func datosDe(t *testing.T, archivo string) []byte {
	if archivo == "articulos-isis.csv" {
		return sinLaAlicuotaRota(t)
	}
	return muestra(t, archivo)
}

func TestMigracionCompletaYRepetible(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ctx := context.Background()

	primera := map[string]totales{}
	for _, o := range orden {
		tot, rech, _ := migrar(t, e, adm, o.entidad, o.archivo, datosDe(t, o.archivo))
		primera[o.archivo] = tot
		t.Logf("%s: %+v, %d rechazos", o.archivo, tot, len(rech))
	}

	// Lo que dejó la primera pasada.
	for consulta, esperado := range map[string]int{
		// 5 fichas del CSV de ISIS (la 00012 viene dos veces, la de López sin
		// código ni CUIT se crea por nombre y dos no entran) y 4 del de UTF-8.
		`SELECT count(*) FROM customers`:                                                     9,
		`SELECT count(*) FROM customers WHERE codigo_legacy = '00012'`:                       1,
		`SELECT count(*) FROM product_variants WHERE sku LIKE 'MIG-%'`:                       8,
		`SELECT count(*) FROM products WHERE name = 'Tirante pino'`:                          1,
		`SELECT count(*) FROM products WHERE name = 'Machimbre'`:                             1,
		`SELECT count(*) FROM price_history WHERE origen = 'importacion'`:                    12,
		`SELECT count(*) FROM inventory`:                                                     2,
		`SELECT count(*) FROM account_movements WHERE referencia = 'SALDO-INICIAL'`:          1,
		`SELECT count(*) FROM supplier_movements WHERE referencia = 'SALDO-INICIAL-PROV'`:    2,
		`SELECT count(*) FROM historical_sales`:                                              7,
		`SELECT count(*) FROM historical_invoices`:                                           3,
		`SELECT count(*) FROM migration_runs WHERE estado = 'completada'`:                    len(orden),
		`SELECT count(*) FROM audit_log WHERE entidad = 'migracion' AND accion = 'importar'`: len(orden),
	} {
		if n := contarFilas(t, e.pool, consulta); n != esperado {
			t.Errorf("%s: %d, se esperaba %d", consulta, n, esperado)
		}
	}
	var monto string
	_ = e.pool.QueryRow(ctx, `SELECT sum(monto)::text FROM account_movements`).Scan(&monto)
	if monto != "12345.67" { // solo la 00012: la 00013 no entró (límite negativo)
		t.Errorf("saldos migrados: %s", monto)
	}

	// La segunda pasada: los mismos archivos, la base igual.
	antes := foto(t, e.pool)
	for _, o := range orden {
		tot, _, _ := migrar(t, e, adm, o.entidad, o.archivo, datosDe(t, o.archivo))
		if tot.creados != 0 {
			t.Errorf("%s: la segunda vez creó %d (primera: %+v, segunda: %+v)", o.archivo, tot.creados, primera[o.archivo], tot)
		}
		if p := primera[o.archivo]; tot.conError != p.conError {
			t.Errorf("%s: rechazos %d la segunda vez, %d la primera", o.archivo, tot.conError, p.conError)
		}
	}
	if despues := foto(t, e.pool); despues != antes {
		t.Errorf("repetir la migración cambió la base:\n  antes:   %s\n  después: %s", antes, despues)
	}
}

func TestInformeDeIntegridad(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	migrar(t, e, adm, "clientes", "clientes-isis.csv", muestra(t, "clientes-isis.csv"))
	_, rechazos, controles := migrar(t, e, adm, "saldos", "saldos-isis.csv", muestra(t, "saldos-isis.csv"))

	// Del archivo (12.345,67 − 1.500 − 200 = 10.645,67) solo entró la 00012:
	// la 00013 no tiene ficha (su límite era negativo) y el CUIT de la
	// última tampoco. El sistema tiene más de lo que suma el archivo, así que
	// la suma «cuadra»; la cantidad de clientes con saldo, no.
	if len(controles) != 2 || controles[0].SegunElArchivo != "10645.67" || controles[0].EnElSistema != "12345.67" || !controles[0].Ok ||
		controles[1].SegunElArchivo != "3" || controles[1].EnElSistema != "1" || controles[1].Ok {
		t.Errorf("controles: %+v", controles)
	}
	encontrado := false
	for _, r := range rechazos {
		if r.Identificador == "Construcciones Ñandú SRL" && strings.Contains(r.Motivo, "No se encontró la ficha del cliente") {
			encontrado = true
		}
	}
	if !encontrado {
		t.Errorf("rechazos: %+v", rechazos)
	}
	// Lo que quedó afuera se guarda en la corrida, para mandarlo al cliente.
	if n := contarFilas(t, e.pool, `SELECT jsonb_array_length(rechazos) FROM migration_runs WHERE entidad = 'saldos'`); n != 5 {
		t.Errorf("rechazos guardados: %d", n)
	}
	var estado Estado
	if s := pedir(t, adm, "GET", e.srv.URL+"/api/v1/admin/migracion/estado", nil, &estado); s != 200 || estado.SaldosMigrados != 1 ||
		estado.ClientesMigrados != 4 || estado.Clientes != 5 {
		t.Errorf("estado: %d %+v", s, estado)
	}
	var historial []Corrida
	if s := pedir(t, adm, "GET", e.srv.URL+"/api/v1/admin/migracion/corridas", nil, &historial); s != 200 || len(historial) != 2 ||
		historial[0].Entidad != "saldos" || historial[0].Estado != "completada" || historial[0].ConError != 5 {
		t.Errorf("historial: %d %+v", s, historial)
	}
}

// El TS buscaba la ficha por `lower(nombre) = sin tildes`: un cliente,
// producto o proveedor con tildes y sin código se duplicaba en cada corrida.
func TestNombresConTildesNoSeDuplican(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	clientes := []byte("Nombre;Teléfono\r\nJosé  Pérez;1\r\nMARÍA LÓPEZ;2\r\n")
	productos := []byte("SKU;Nombre;Rubro\r\nT-1;Tirante de álamo;Maderas\r\n")
	productos2 := []byte("SKU;Nombre;Rubro\r\nT-2;Tirante de Álamo;Maderas\r\n")
	proveedores := []byte("Proveedor;Teléfono\r\nAserradero Ñandú;1\r\n")
	for i := 0; i < 2; i++ {
		migrar(t, e, adm, "clientes", "c.csv", clientes)
		migrar(t, e, adm, "proveedores", "p.csv", proveedores)
	}
	migrar(t, e, adm, "productos", "a.csv", productos)
	migrar(t, e, adm, "productos", "b.csv", productos2)
	for consulta, esperado := range map[string]int{
		`SELECT count(*) FROM customers`:        2,
		`SELECT count(*) FROM suppliers`:        1,
		`SELECT count(*) FROM products`:         1,
		`SELECT count(*) FROM product_variants`: 2,
	} {
		if n := contarFilas(t, e.pool, consulta); n != esperado {
			t.Errorf("%s: %d, se esperaba %d", consulta, n, esperado)
		}
	}
}

// Dos existencias de la misma medida a la vez (o una venta en el medio): sin
// el candado del stock las dos leen la misma existencia anterior y el libro
// de movimientos deja de sumar lo que dice el stock.
func TestStockSimultaneoCierraConElLibro(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	var variante string
	if err := e.pool.QueryRow(ctx, `WITH c AS (INSERT INTO categories (slug, name) VALUES ('m', 'M') RETURNING id),
		p AS (INSERT INTO products (slug, name, category_id) SELECT 'p', 'P', id FROM c RETURNING id)
		INSERT INTO product_variants (product_id, sku, label) SELECT id, 'S-1', 'S' FROM p RETURNING id`).Scan(&variante); err != nil {
		t.Fatal(err)
	}
	def, _ := DefinicionDe("stock")
	var wg sync.WaitGroup
	for i := 1; i <= 20; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			filas := NormalizarFilas(def, Mapeo{"sku": 0, "sucursal": 1, "cantidad": 2}, [][]string{{"S-1", "Casa Central", fmt.Sprint(n * 10)}})
			if _, err := AplicarLote(ctx, e.pool, "stock", filas, Opciones{LoteID: "00000000-0000-0000-0000-000000000000"}); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	var qty, libro float64
	_ = e.pool.QueryRow(ctx, `SELECT qty::float8 FROM inventory WHERE variant_id = $1`, variante).Scan(&qty)
	_ = e.pool.QueryRow(ctx, `SELECT coalesce(sum(qty), 0)::float8 FROM inventory_movements WHERE variant_id = $1`, variante).Scan(&libro)
	if qty != libro {
		t.Errorf("existencia %v, pero el libro de movimientos suma %v", qty, libro)
	}
}

func TestLoteQueFallaSeDejaSinEfecto(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	u := e.srv.URL + "/api/v1/admin/migracion/"
	mapeo := map[string]int{"sku": 0, "nombre": 1, "categoria": 2, "alicuotaIva": 3}
	var corrida struct{ RunID string }
	pedir(t, adm, "POST", u+"corridas", map[string]any{"entidad": "productos", "archivo": "x.csv", "codificacion": "utf-8",
		"mapeo": mapeo, "filasTotales": 2}, &corrida)
	// La segunda fila tiene una alícuota que no entra en numeric(4,2): el
	// lote entero se deshace, también la primera.
	var l LoteAplicado
	if s := pedir(t, adm, "POST", u+"corridas/"+corrida.RunID+"/lote", map[string]any{"entidad": "productos", "mapeo": mapeo,
		"filas": [][]string{{"OK-1", "Bueno", "Varios", "21"}, {"MAL-1", "Malo", "Varios", "105"}}}, &l); s != 200 ||
		!strings.HasPrefix(l.Error, "El lote no se pudo aplicar y se dejó sin efecto: ") {
		t.Fatalf("lote: %d %+v", s, l)
	}
	if n := contarFilas(t, e.pool, `SELECT count(*) FROM product_variants`); n != 0 {
		t.Errorf("quedaron %d medidas de un lote deshecho", n)
	}
	if n := contarFilas(t, e.pool, `SELECT count(*) FROM migration_runs WHERE estado = 'interrumpida'`); n != 1 {
		t.Errorf("la corrida no quedó interrumpida")
	}
	// Sin las columnas obligatorias, el lote ni se intenta.
	if s := pedir(t, adm, "POST", u+"corridas/"+corrida.RunID+"/lote", map[string]any{"entidad": "productos",
		"mapeo": map[string]int{"sku": 0}, "filas": [][]string{{"X"}}}, &l); s != 200 || l.Error != "Faltan emparejar columnas. Fijate las que están marcadas con *." {
		t.Errorf("sin mapeo: %d %+v", s, l)
	}
}

func TestPermisosYErroresDelArchivo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	u := e.srv.URL + "/api/v1/admin/migracion/"

	if s := subir(t, ven, u+"analizar", "clientes", "c.csv", muestra(t, "clientes-isis.csv"), nil); s != 403 {
		t.Errorf("analizar del vendedor: %d", s)
	}
	if s := pedir(t, ven, "POST", u+"corridas", map[string]any{"entidad": "clientes", "archivo": "x", "codificacion": "utf-8",
		"mapeo": map[string]int{}, "filasTotales": 0}, nil); s != 403 {
		t.Errorf("iniciar del vendedor: %d", s)
	}
	// Leer el estado y el historial, cualquiera del panel (como el DAL).
	if s := pedir(t, ven, "GET", u+"estado", nil, nil); s != 200 {
		t.Errorf("estado del vendedor: %d", s)
	}
	if s := pedir(t, &http.Client{}, "GET", u+"corridas", nil, nil); s != 401 {
		t.Errorf("historial sin sesión: %d", s)
	}
	var defs struct {
		Lote      int
		Entidades []Entidad
	}
	if s := pedir(t, adm, "GET", u+"entidades", nil, &defs); s != 200 || defs.Lote != 200 || len(defs.Entidades) != 7 {
		t.Errorf("entidades: %d %+v", s, defs)
	}

	for _, c := range []struct {
		nombre string
		datos  []byte
		error  string
	}{
		{"vacio.csv", nil, "Elegí un archivo."},
		{"viejo.xls", muestra(t, "viejo.xls"), "Esto es un Excel viejo (.xls)."},
		{"solo.csv", muestra(t, "solo-encabezado.csv"), "El archivo está vacío."},
		{"grande.csv", bytes.Repeat([]byte("a;b\r\n"), TopeDeBytes/5+1), "El archivo pasa los 8 MB."},
		{"muchas.csv", bytes.Repeat([]byte("1\n"), TopeDeFilas+2), "Son 100.001 filas y el tope por archivo es 100.000."},
	} {
		var a ArchivoAnalizado
		if s := subir(t, adm, u+"analizar", "clientes", c.nombre, c.datos, &a); s != 200 || !strings.HasPrefix(a.Error, c.error) {
			t.Errorf("%s: %d %q", c.nombre, s, a.Error)
		}
	}
	var previa VistaPrevia
	if s := pedir(t, adm, "POST", u+"previa", map[string]any{"entidad": "productos", "mapeo": map[string]int{"sku": 0},
		"filas": [][]string{{"X"}}}, &previa); s != 200 || previa.Error != "Falta indicar qué columna es Nombre del producto, Categoría." {
		t.Errorf("previa sin mapeo: %d %+v", s, previa)
	}
}
