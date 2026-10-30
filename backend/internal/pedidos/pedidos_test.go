package pedidos

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
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/ventasapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

const secretoInterno = "secreto-interno-de-prueba"

type entorno struct {
	srv      *httptest.Server
	pool     *pgxpool.Pool
	ses      *auth.Servicio
	s        *Servicio
	sucursal string
	placa    string // variante con costo, 100 en el depósito
	otra     string // variante sin costo
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-pedidos-de-32-caracteres", URL: "http://localhost"}, pool)
	s := Nuevo(pool, silencio)
	m := http.NewServeMux()
	ventasapi.HandlerWithOptions(
		ventasapi.NewStrictHandlerWithOptions(NuevaAPI(s, plataforma.ConfigInterna{Secreto: secretoInterno}),
			[]ventasapi.StrictMiddlewareFunc{plataforma.ConPedido[ventasapi.StrictHandlerFunc]},
			ventasapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		ventasapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := ventasapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := ventasapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	e := &entorno{srv: srv, pool: pool, ses: ses, s: s}
	e.sucursal = e.id(t, `insert into branches (slug, name) values ('casa-central', 'Casa Central') returning id`)
	cat := e.id(t, `insert into categories (slug, name, description) values ('placas', 'Placas', '') returning id`)
	prod := e.id(t, `insert into products (slug, name, category_id, description, alicuota_iva) values ('fenolico', 'Fenólico', $1, '', 21) returning id`, cat)
	e.placa = e.id(t, `insert into product_variants (product_id, sku, label) values ($1, 'FEN18', '18 mm') returning id`, prod)
	e.otra = e.id(t, `insert into product_variants (product_id, sku, label) values ($1, 'FEN12', '12 mm') returning id`, prod)
	e.exec(t, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 1, 40000.5)`, e.placa)
	e.exec(t, `insert into inventory (variant_id, branch_id, qty) values ($1, $3, 100), ($2, $3, 100)`, e.placa, e.otra, e.sucursal)
	return e
}

func (e *entorno) id(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var id string
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (e *entorno) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func (e *entorno) numero(t *testing.T, sql string, args ...any) float64 {
	t.Helper()
	var n float64
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (e *entorno) reservado(t *testing.T, variante string) float64 {
	return e.numero(t, `select reservado::float8 from inventory where variant_id = $1 and branch_id = $2`, variante, e.sucursal)
}

func (e *entorno) cliente(cookies []*http.Cookie) *http.Client {
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u.URL, cookies)
	return &http.Client{Jar: jar}
}

func (e *entorno) entrar(t *testing.T, correo string) (*http.Client, *auth.Sesion) {
	t.Helper()
	w := httptest.NewRecorder()
	ses, err := e.ses.Entrar(context.Background(), w, correo, "una clave larga", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	return e.cliente(w.Result().Cookies()), ses
}

func (e *entorno) staff(t *testing.T, correo string, rol sqlc.StaffRole) (*http.Client, *auth.Sesion) {
	t.Helper()
	if _, err := e.ses.AltaDeStaff(context.Background(), correo, "una clave larga", "Persona "+string(rol), rol); err != nil {
		t.Fatal(err)
	}
	return e.entrar(t, correo)
}

func (e *entorno) web(t *testing.T, correo string) (*http.Client, string) {
	t.Helper()
	if _, err := e.ses.AltaDeCliente(context.Background(), correo, "una clave larga", "Cliente Web"); err != nil {
		t.Fatal(err)
	}
	c, ses := e.entrar(t, correo)
	return c, e.id(t, `select id from customers where user_id = $1`, ses.UserID)
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
	return resp.StatusCode, string(b)
}

func leer[T any](t *testing.T, cuerpo string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(cuerpo), &v); err != nil {
		t.Fatalf("%v: %s", err, cuerpo)
	}
	return v
}

// alta arma el cuerpo de un presupuesto con una placa y una línea suelta.
func (e *entorno) alta(nombre string, cantidad float64, extra map[string]any) map[string]any {
	cab := map[string]any{"contactoNombre": nombre, "branchId": e.sucursal, "diasValidez": 15.0}
	for k, v := range extra {
		cab[k] = v
	}
	return map[string]any{"cabecera": cab, "lineas": []any{
		map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "unidad": "unidad", "cantidad": cantidad, "precioUnitario": 84500.0},
		map[string]any{"variantId": nil, "descripcion": "Flete", "unidad": "unidad", "cantidad": 1.0, "precioUnitario": "12000.5"},
	}}
}

func TestPresupuestoAPedidoYDeVuelta(t *testing.T) {
	e := armar(t)
	adm, _ := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	dep, _ := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	dueno, propio := e.web(t, "cliente@prueba.test")
	otro, _ := e.web(t, "otro@prueba.test")
	u := e.srv.URL + "/api/v1/admin/"

	// El alta valida como zod, y el primer error es el que se muestra.
	if c, b := pedir(t, ven, "POST", u+"presupuestos", map[string]any{"cabecera": map[string]any{"contactoNombre": "J"}, "lineas": []any{}}); c != 422 ||
		!strings.Contains(b, "Poné a nombre de quién va.") {
		t.Fatalf("nombre corto: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", u+"presupuestos", map[string]any{"cabecera": map[string]any{"contactoNombre": "Juan"}, "lineas": []any{}}); c != 422 ||
		!strings.Contains(b, "Agregá al menos un producto.") {
		t.Fatalf("sin líneas: %d %s", c, b)
	}
	// El depósito no entra a presupuestos.
	if c, _ := pedir(t, dep, "POST", u+"presupuestos", e.alta("Juan", 3, nil)); c != 403 {
		t.Fatalf("depósito: %d", c)
	}

	c, b := pedir(t, ven, "POST", u+"presupuestos", e.alta("Juan Pérez", 3, map[string]any{"customerId": propio, "contactoEmail": " juan@prueba.com "}))
	if c != 200 {
		t.Fatalf("alta: %d %s", c, b)
	}
	alta := leer[Resultado](t, b)
	anio := time.Now().In(argentina).Year()
	if !strings.HasPrefix(alta.Numero, "P-") || alta.Ok != "Se creó el presupuesto "+alta.Numero+"." || alta.Numero[2:6] != jsTexto(anio) {
		t.Fatalf("alta: %+v", alta)
	}
	if n := e.numero(t, `select count(*) from audit_log where entidad = 'presupuesto' and entidad_id = $1`, alta.Numero); n != 1 {
		t.Errorf("bitácora del alta: %v", n)
	}

	// La ficha y el listado.
	c, b = pedir(t, ven, "GET", u+"presupuestos/"+alta.ID, nil)
	ficha := leer[FichaDePresupuesto](t, b)
	if c != 200 || ficha.Total != "265500.50" || ficha.Email == nil || *ficha.Email != "juan@prueba.com" || len(ficha.Items) != 2 ||
		ficha.Items[0].AlicuotaIva == nil || *ficha.Items[0].AlicuotaIva != "21.00" || ficha.Items[1].AlicuotaIva != nil ||
		ficha.Asesor == nil || *ficha.Asesor != "Persona vendedor" || ficha.Origen != "telefono" {
		t.Fatalf("ficha: %d %s", c, b)
	}
	c, b = pedir(t, ven, "GET", u+"presupuestos?estado=abiertos&busqueda=juan%20perez", nil)
	lista := leer[[]PresupuestoListado](t, b)
	if c != 200 || len(lista) != 1 || lista[0].Total != 265500.5 || lista[0].Items != 2 || lista[0].Vencido {
		t.Fatalf("listado: %d %s", c, b)
	}

	// El PDF: el personal, el dueño y el servidor de Next; a los demás, 404.
	pdf := e.srv.URL + "/api/v1/presupuestos/" + alta.ID + "/pdf"
	for _, caso := range []struct {
		nombre string
		c      *http.Client
		cab    []string
		codigo int
	}{
		{"personal", dep, nil, 200}, {"dueño", dueno, nil, 200}, {"otro cliente", otro, nil, 404},
		{"sin sesión", http.DefaultClient, nil, 404}, {"interno", http.DefaultClient, []string{"Authorization", "Bearer " + secretoInterno}, 200},
	} {
		c, b := pedir(t, caso.c, "GET", pdf, nil, caso.cab...)
		if c != caso.codigo || (c == 200 && !strings.HasPrefix(b, "%PDF")) {
			t.Errorf("PDF, %s: %d", caso.nombre, c)
		}
	}

	// Aceptar y pasar a pedido.
	if c, b := pedir(t, ven, "POST", u+"presupuestos/"+alta.ID+"/estado", map[string]any{"estado": "otro"}); c != 422 || !strings.Contains(b, "Ese estado no existe.") {
		t.Fatalf("estado raro: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", u+"presupuestos/"+alta.ID+"/estado", map[string]any{"estado": "aceptado"}); c != 200 || !strings.Contains(b, "Presupuesto actualizado.") {
		t.Fatalf("aceptar: %d %s", c, b)
	}
	c, b = pedir(t, ven, "POST", u+"presupuestos/"+alta.ID+"/pedido", nil)
	if c != 200 {
		t.Fatalf("convertir: %d %s", c, b)
	}
	pedido := leer[Resultado](t, b)
	if pedido.Numero != "PED-1000" || pedido.Ok != "Se creó el pedido PED-1000." {
		t.Fatalf("convertir: %s", b)
	}
	if r := e.reservado(t, e.placa); r != 3 {
		t.Errorf("reservado: %v", r)
	}
	if c, b := pedir(t, ven, "POST", u+"presupuestos/"+alta.ID+"/pedido", nil); c != 422 || !strings.Contains(b, "Ya se convirtió en el pedido PED-1000.") {
		t.Fatalf("convertir dos veces: %d %s", c, b)
	}

	// La ficha del pedido: el margen es del admin.
	c, b = pedir(t, adm, "GET", u+"pedidos/"+pedido.ID, nil)
	fp := leer[FichaDePedido](t, b)
	if c != 200 || fp.Margen == nil || fp.Margen.SinCosto != 1 || fp.Items[0].CostoUnitario == nil || *fp.Items[0].CostoUnitario != "40000.5000" ||
		fp.Items[0].StockPorUnidad != 1 || len(fp.Historial) != 1 || *fp.Historial[0].Nota != "Generado desde el presupuesto "+alta.Numero {
		t.Fatalf("ficha del pedido: %d %s", c, b)
	}
	if c, b := pedir(t, dep, "GET", u+"pedidos/"+pedido.ID, nil); c != 200 || !strings.Contains(b, `"margen":null`) {
		t.Fatalf("ficha del depósito: %d %s", c, b)
	}
	if c, b := pedir(t, dep, "GET", u+"pedidos?estado=pendiente&sucursal=casa-central", nil); c != 200 || len(leer[[]PedidoListado](t, b)) != 1 {
		t.Fatalf("tablero: %d %s", c, b)
	}

	// Avanzar: retiro, así que de listo pasa a entregado.
	for _, quedo := range []string{"en preparación", "listo para retirar"} {
		if c, b := pedir(t, dep, "POST", u+"pedidos/"+pedido.ID+"/avanzar", nil); c != 200 || !strings.Contains(b, "PED-1000 quedó "+quedo+".") {
			t.Fatalf("avanzar: %d %s", c, b)
		}
	}
	// Cada avance deja su aviso al cliente en la cola, con el estado.
	if n := e.numero(t, `select count(*) from trabajos where tipo = 'pedido.estado' and carga->>'orderId' = $1
		and carga->>'estado' in ('preparando', 'listo')`, pedido.ID); n != 2 {
		t.Errorf("avisos encolados al avanzar: %v", n)
	}
	// Cobrarlo, dos veces.
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+pedido.ID+"/cobrado", nil); c != 200 || !strings.Contains(b, "PED-1000 quedó cobrado.") {
		t.Fatalf("cobrar: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+pedido.ID+"/cobrado", nil); c != 422 || !strings.Contains(b, "Ya figura como pagado.") {
		t.Fatalf("cobrar dos veces: %d %s", c, b)
	}
	// Cancelar libera lo reservado; cancelarlo de nuevo, no.
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+pedido.ID+"/cancelar", map[string]any{"motivo": "Se arrepintió"}); c != 200 ||
		!strings.Contains(b, "Pedido cancelado.") {
		t.Fatalf("cancelar: %d %s", c, b)
	}
	if r := e.reservado(t, e.placa); r != 0 {
		t.Errorf("reservado después de cancelar: %v", r)
	}
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+pedido.ID+"/cancelar", nil); c != 422 || !strings.Contains(b, "El pedido ya está cancelado.") {
		t.Fatalf("cancelar dos veces: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+pedido.ID+"/avanzar", nil); c != 422 || !strings.Contains(b, "El pedido está cancelado.") {
		t.Fatalf("avanzar cancelado: %d %s", c, b)
	}
	if c, _ := pedir(t, ven, "POST", u+"pedidos/00000000-0000-4000-8000-000000000000/avanzar", nil); c != 404 {
		t.Errorf("avanzar uno que no existe: %d", c)
	}
	if c, _ := pedir(t, ven, "POST", u+"presupuestos/00000000-0000-4000-8000-000000000000/estado", map[string]any{"estado": "rechazado"}); c != 404 {
		t.Errorf("estado de uno que no existe: %d", c)
	}
}

func jsTexto(n int) string { b, _ := json.Marshal(n); return string(b) }

// Sin nada cargado, los listados son [] y no null (el panel hace .map).
func TestListasVacias(t *testing.T) {
	e := armar(t)
	adm, _ := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	for _, ruta := range []string{"pedidos", "presupuestos", "presupuestos?estado=abiertos", "pedidos?estado=inexistente"} {
		if c, b := pedir(t, adm, "GET", e.srv.URL+"/api/v1/admin/"+ruta, nil); c != 200 || strings.TrimSpace(b) != "[]" {
			t.Errorf("%s: %d %s", ruta, c, b)
		}
	}
}

func TestGuardarYPasarAPedido(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	cuerpo := e.alta("Ana", 2, nil)
	cuerpo["convertir"] = true
	c, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/presupuestos", cuerpo)
	r := leer[Resultado](t, b)
	if c != 200 || !strings.HasPrefix(r.Ok, "Se creó el pedido PED-1000. Salió del presupuesto P-") || r.Numero != "PED-1000" {
		t.Fatalf("%d %s", c, b)
	}
	if e.reservado(t, e.placa) != 2 {
		t.Error("no reservó")
	}
	if n := e.numero(t, `select count(*) from quotes where estado = 'aceptado'`); n != 1 {
		t.Errorf("el presupuesto no quedó aceptado: %v", n)
	}
}

// El número del presupuesto lleva el año de la Argentina. El TS usaba el del
// servidor (UTC): el 31/12 a las 23:30 numeraba P-2027-0001.
func TestNumeroConElAnioDeLaArgentina(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.s.ahora = func() time.Time { return time.Date(2027, 1, 1, 2, 30, 0, 0, time.UTC) } // 31/12 23:30 en Buenos Aires
	alta := e.alta("Fin de año", 1, nil)
	r, err := e.s.CrearPresupuesto(context.Background(), ses, alta["cabecera"].(map[string]any), alta["lineas"].([]any), false)
	if err != nil {
		t.Fatal(err)
	}
	if r.Numero != "P-2026-0001" {
		t.Errorf("número: %s", r.Numero)
	}
	var vence time.Time
	_ = e.pool.QueryRow(context.Background(), `select valido_hasta from quotes where numero = $1`, r.Numero).Scan(&vence)
	if !vence.Equal(time.Date(2027, 1, 16, 2, 30, 0, 0, time.UTC)) {
		t.Errorf("vence: %v", vence)
	}
}
