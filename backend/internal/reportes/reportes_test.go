package reportes

import (
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

	"mjbj/internal/api/reportesapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

const secretoInterno = "un-secreto-interno-de-prueba"

type entorno struct {
	srv                 *httptest.Server
	pool                *pgxpool.Pool
	ses                 *auth.Servicio
	s                   *Servicio
	central, aserradero string
	u                   string
}

// ahoraDePrueba: el 15 de octubre de 2026 a las 12 (hora argentina).
var ahoraDePrueba = time.Date(2026, 10, 15, 12, 0, 0, 0, Argentina)

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-reportes-de-32-caracteres", URL: "http://localhost"}, pool)
	s := Nuevo(pool, silencio)
	s.ahora = func() time.Time { return ahoraDePrueba }
	m := http.NewServeMux()
	reportesapi.HandlerWithOptions(
		reportesapi.NewStrictHandlerWithOptions(NuevaAPI(s, plataforma.ConfigInterna{Secreto: secretoInterno}),
			[]reportesapi.StrictMiddlewareFunc{plataforma.ConPedido[reportesapi.StrictHandlerFunc]},
			reportesapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		reportesapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := reportesapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := reportesapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	e := &entorno{srv: srv, pool: pool, ses: ses, s: s, u: srv.URL + "/api/v1/admin/"}
	e.central = e.id(t, `insert into branches (slug, name, sort_order) values ('casa-central', 'Casa Central', 1) returning id`)
	e.aserradero = e.id(t, `insert into branches (slug, name, sort_order) values ('aserradero', 'Aserradero', 2) returning id`)
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

func pedir(t *testing.T, c *http.Client, url string, cabeceras ...string) (int, string, http.Header) {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	for i := 0; i+1 < len(cabeceras); i += 2 {
		req.Header.Set(cabeceras[i], cabeceras[i+1])
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b), resp.Header
}

// catalogo arma dos productos (uno elaborado), sus medidas y el stock.
func (e *entorno) catalogo(t *testing.T) (placa, tirante string) {
	cat := e.id(t, `insert into categories (slug, name, description) values ('placas', 'Placas', '') returning id`)
	sub := e.id(t, `insert into subcategories (category_id, slug, name) values ($1, 'fenolicos', 'Fenólicos') returning id`, cat)
	cat2 := e.id(t, `insert into categories (slug, name, description) values ('maderas', 'Maderas', '') returning id`)
	pp := e.id(t, `insert into products (slug, name, category_id, subcategory_id, description, unit) values ('fenolico', 'Fenólico', $1, $2, '', 'placa') returning id`, cat, sub)
	pt := e.id(t, `insert into products (slug, name, category_id, description, unit, recargo_elaboracion_pct) values ('tirante', 'Tirante cepillado', $1, '', 'unidad', 15) returning id`, cat2)
	placa = e.id(t, `insert into product_variants (product_id, sku, label) values ($1, 'FEN18', '18 mm') returning id`, pp)
	tirante = e.id(t, `insert into product_variants (product_id, sku, label) values ($1, 'TIR', '2x4') returning id`, pt)
	e.exec(t, `insert into inventory (variant_id, branch_id, qty, min_qty, reservado) values ($1, $2, 10, 20, 2), ($1, $3, 5, 0, 0), ($4, $2, 100, 10, 0)`,
		placa, e.central, e.aserradero, tirante)
	return
}

func (e *entorno) pedido(t *testing.T, numero, sucursal, estado, origen string, creado time.Time, cliente *string, renglones ...[4]any) string {
	t.Helper()
	total := 0.0
	for _, r := range renglones {
		total += r[2].(float64)
	}
	id := e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, total, created_at, customer_id)
		values ($1, 'Mostrador', $2, $3, $4, $5, $6, $7) returning id`, numero, sucursal, origen, estado, total, creado, cliente)
	for _, r := range renglones {
		e.exec(t, `insert into order_items (order_id, variant_id, descripcion, cantidad, precio_unitario, subtotal, costo_unitario)
			values ($1, $2, 'renglón', $3, 0, $4, $5)`, id, r[0], r[1], r[2], r[3])
	}
	return id
}

func TestReporteDeVentasYMeses(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	placa, tirante := e.catalogo(t)
	carp := e.id(t, `insert into customers (nombre, rubro) values ('Carpintería Sur', 'carpintero') returning id`)
	// Octubre (este mes): dos ventas y una cancelada; una del 30/9 a las 22
	// (que en UTC ya es octubre) es de septiembre.
	e.pedido(t, "A-1", e.central, "entregado", "mostrador", time.Date(2026, 10, 2, 10, 0, 0, 0, Argentina), &carp,
		[4]any{placa, 2.0, 1210.0, 500.0}, [4]any{tirante, 3.0, 300.0, nil})
	e.pedido(t, "A-2", e.aserradero, "pendiente", "tienda", time.Date(2026, 10, 10, 10, 0, 0, 0, Argentina), nil,
		[4]any{placa, 1.0, 605.0, 250.0})
	e.pedido(t, "A-3", e.central, "cancelado", "mostrador", time.Date(2026, 10, 11, 10, 0, 0, 0, Argentina), nil,
		[4]any{placa, 50.0, 99999.0, 1.0})
	e.pedido(t, "S-1", e.central, "entregado", "mostrador", time.Date(2026, 9, 30, 22, 0, 0, 0, Argentina), nil,
		[4]any{placa, 1.0, 700.0, nil})

	_, b, _ := pedir(t, adm, e.u+"reportes/ventas?corte=producto&periodo=mes")
	var filas []FilaDeReporte
	_ = json.Unmarshal([]byte(b), &filas)
	if len(filas) != 2 || filas[0].Etiqueta != "Fenólico" || filas[0].Cantidad != 3 || filas[0].Total != 1815 || filas[0].NetoVenta != 1500 ||
		*filas[0].Costo != 1250 || filas[0].LineasSinCosto != 0 || *filas[0].Detalle != "18 mm" {
		t.Fatalf("por producto: %s", b)
	}
	if filas[1].Costo != nil || filas[1].LineasSinCosto != 1 {
		t.Errorf("sin costo no es costo cero: %+v", filas[1])
	}
	_, b, _ = pedir(t, adm, e.u+"reportes/ventas?corte=rubro&periodo=mes")
	if !strings.Contains(b, `"etiqueta":"Placas","detalle":"1 producto"`) {
		t.Errorf("por rubro: %s", b)
	}
	_, b, _ = pedir(t, adm, e.u+"reportes/ventas?corte=elaboracion&periodo=mes")
	if !strings.Contains(b, `"clave":"bruto"`) || !strings.Contains(b, `"etiqueta":"Se maquina en planta"`) {
		t.Errorf("elaboración: %s", b)
	}
	_, b, _ = pedir(t, adm, e.u+"reportes/ventas?corte=cliente&periodo=mes&rubro=carpintero")
	if !strings.Contains(b, `"etiqueta":"Carpintería Sur"`) || strings.Contains(b, "Mostrador") {
		t.Errorf("por cliente filtrado por rubro: %s", b)
	}
	_, b, _ = pedir(t, adm, e.u+"reportes/ventas?corte=sucursal&periodo=mes&sucursal="+e.aserradero)
	if !strings.Contains(b, `"etiqueta":"Aserradero"`) || strings.Contains(b, "Casa Central") {
		t.Errorf("por sucursal filtrado: %s", b)
	}
	if c, b, _ := pedir(t, adm, e.u+"reportes/ventas?corte=canal&periodo=mes&sucursal=no-es-un-id"); c != 200 || b != "[]\n" {
		t.Errorf("un id roto filtra todo, no rompe: %d %s", c, b)
	}
	_, b, _ = pedir(t, adm, e.u+"reportes/ventas?corte=canal&periodo=mes")
	if !strings.Contains(b, `"clave":"mostrador"`) || !strings.Contains(b, `"clave":"tienda"`) {
		t.Errorf("por canal: %s", b)
	}
	// Mes pasado: la del 30/9 a las 22 está, y el mes en curso no se suma en cero.
	_, b, _ = pedir(t, adm, e.u+"reportes/ventas/meses?periodo=mes-pasado")
	var meses []MesDelReporte
	_ = json.Unmarshal([]byte(b), &meses)
	if len(meses) != 1 || meses[0].Clave != "2026-09" || meses[0].Total != 700 || meses[0].Etiqueta != "sept" {
		t.Errorf("mes pasado: %s", b)
	}
	_, b, _ = pedir(t, adm, e.u+"reportes/ventas/meses?periodo=todo")
	_ = json.Unmarshal([]byte(b), &meses)
	if len(meses) != 6 || meses[4].Total != 700 || meses[5].Total != 2115 {
		t.Errorf("todo: %s", b)
	}
	if c, _, _ := pedir(t, ven, e.u+"reportes/ventas"); c != 403 {
		t.Errorf("el vendedor no ve los reportes: %d", c)
	}

	// Los archivos.
	c, b, h := pedir(t, adm, e.u+"reportes/ventas/archivo?corte=producto&periodo=mes")
	if c != 200 || !strings.HasPrefix(b, "\ufeff\"Producto\";\"Detalle\";\"Unidades\"") || !strings.Contains(h.Get("Content-Disposition"), "ventas-producto-mes.csv") {
		t.Errorf("csv: %d %q %v", c, b, h)
	}
	c, b, h = pedir(t, adm, e.u+"reportes/ventas/archivo?corte=producto&periodo=mes&formato=pdf&rubro=todos")
	if c != 200 || !strings.HasPrefix(b, "%PDF") || h.Get("Content-Type") != "application/pdf" {
		t.Errorf("pdf: %d %v", c, h)
	}
}

func TestReposicion(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, tirante := e.catalogo(t)
	// 60 placas en los últimos 30 días (2 por día): en las dos sucursales
	// hay 8 + 5 = 13 disponibles.
	e.pedido(t, "R-1", e.central, "entregado", "mostrador", ahoraDePrueba.Add(-5*24*time.Hour), nil, [4]any{placa, 60.0, 1.0, nil})
	e.pedido(t, "R-2", e.central, "cancelado", "mostrador", ahoraDePrueba.Add(-5*24*time.Hour), nil, [4]any{placa, 600.0, 1.0, nil})
	e.pedido(t, "R-3", e.central, "entregado", "mostrador", ahoraDePrueba.Add(-40*24*time.Hour), nil, [4]any{tirante, 9.0, 1.0, nil})

	_, b, _ := pedir(t, adm, e.u+"reportes/reposicion?dias=30&objetivo=30")
	var r ReporteDeReposicion
	_ = json.Unmarshal([]byte(b), &r)
	if len(r.Filas) != 2 || r.Filas[0].VariantID != placa || r.Filas[0].Disponible != 13 || r.Filas[0].Vendido != 60 ||
		*r.Filas[0].Cobertura != 7 || r.Filas[0].Sugerido != 47 || r.Filas[1].Vendido != 0 || r.Filas[1].Cobertura != nil {
		t.Fatalf("reposición: %s", b)
	}
	if len(r.PorCategoria) != 1 || r.PorCategoria[0].Nombre != "Placas" {
		t.Errorf("por categoría: %+v", r.PorCategoria)
	}
	_, b, _ = pedir(t, adm, e.u+"reportes/reposicion?dias=60&sucursal=aserradero&rubro=fenolicos&objetivo=1000")
	_ = json.Unmarshal([]byte(b), &r)
	if len(r.Filas) != 1 || r.Filas[0].Disponible != 5 || r.Filas[0].Vendido != 0 || r.CoberturaObjetivo != 180 || r.DiasDelPeriodo != 60 {
		t.Errorf("aserradero y fenólicos: %s", b)
	}
	c, b, h := pedir(t, adm, e.u+"reportes/reposicion/archivo?dias=45")
	if c != 200 || !strings.HasPrefix(b, "\ufeffProducto;Medida;Código") || !strings.Contains(h.Get("Content-Disposition"), "reposicion-30dias.csv") {
		t.Errorf("csv: %d %q %v", c, b, h)
	}
	c, b, _ = pedir(t, adm, e.u+"reportes/reposicion/archivo?formato=pdf")
	if c != 200 || !strings.HasPrefix(b, "%PDF") {
		t.Errorf("pdf: %d", c)
	}
}

func TestCierreDelMes(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	prov := e.id(t, `insert into suppliers (nombre) values ('Maderas del Sur') returning id`)
	fac := e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae)
		values ('factura_a', 3, 127, 'Constructora', 1000, 210, 0, 0, 0, 1210, 'autorizada', '2026-10-05T15:00:00Z', '76123456789012') returning id`)
	// La rechazada por ARCA (sin CAE) no cuenta para el fisco: ni en el
	// resumen ni en los asientos.
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae)
		values ('nota_credito_a', 3, 5, 'Constructora', 100, 21, 0, 0, 0, 121, 'autorizada', '2026-10-06T15:00:00Z', '76123456789013'),
		       ('factura_b', 3, 128, 'Borrador', 1, 0, 0, 0, 0, 1, 'borrador', '2026-10-06T15:00:00Z', null),
		       ('factura_b', 3, 129, 'Rechazada', 500, 105, 0, 0, 0, 605, 'rechazada', '2026-10-06T16:00:00Z', null)`)
	e.exec(t, `insert into invoice_payments (invoice_id, medio, monto, fecha) values ($1, 'efectivo', 1210, '2026-10-07T15:00:00Z')`, fac)
	// Pasarla a cuenta corriente no es un cobro: no se asienta.
	e.exec(t, `insert into invoice_payments (invoice_id, medio, monto, fecha) values ($1, 'cuenta_corriente', 50, '2026-10-07T16:00:00Z')`, fac)
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision)
		values ($1, 'factura_b', 1, 9, 500, 105, 0, 0, 0, 605, '2026-10-02T00:00:00Z')`, prov)
	e.exec(t, `insert into supplier_payments (supplier_id, total, neto, medio, referencia, fecha) values ($1, 605, 600, 'transferencia', 'TR 1', '2026-10-08T15:00:00Z')`, prov)
	// Un gasto cargado con el día del formulario (las 0 UTC del 1.º): es de octubre.
	e.exec(t, `insert into expenses (fecha, categoria, descripcion, importe, medio) values ('2026-10-01T00:00:00Z', 'flete', 'Flete "Oeste"', 300, 'efectivo')`)

	_, b, _ := pedir(t, adm, e.u+"cierre/asientos?periodo=2026-10")
	var asientos []Asiento
	_ = json.Unmarshal([]byte(b), &asientos)
	if len(asientos) != 6 {
		t.Fatalf("asientos: %s", b)
	}
	if asientos[0].Concepto != "flete · Flete \"Oeste\"" || asientos[1].Concepto != "Factura B 0001-00000009 · Maderas del Sur" ||
		asientos[2].Concepto != "Factura A 0003-00000127 · Constructora" || !asientos[2].Balancea {
		t.Errorf("orden y conceptos: %s", b)
	}
	_, b, _ = pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	var r ResumenDelMes
	_ = json.Unmarshal([]byte(b), &r)
	if r.Ventas.Neto != 900 || r.Ventas.Iva != 189 || r.Ventas.Cantidad != 2 || r.Compras.Iva != 0 || r.Compras.Total != 605 ||
		r.Gastos.Total != 300 || r.PosicionIva != 189 {
		t.Errorf("resumen: %s", b)
	}
	e.exec(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, (select id from "user" limit 1), '2026-10-30T12:00:00Z')`, e.central)
	_, b, _ = pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	if !strings.Contains(b, `"clave":"caja","titulo":"Turnos de caja sin cerrar"`) {
		t.Errorf("pendientes: %s", b)
	}
	c, b, h := pedir(t, adm, e.u+"cierre/asientos-csv?periodo=2026-10")
	if c != 200 || !strings.Contains(h.Get("Content-Disposition"), "asientos-2026-10.csv") || !strings.Contains(b, "\"00001\";01/10/2026;\"flete · Flete \"\"Oeste\"\"\"") ||
		!strings.Contains(b, "\"Totales\"") {
		t.Errorf("csv: %d %q", c, b)
	}
	if c, _, _ := pedir(t, ven, e.u+"cierre/resumen"); c != 403 {
		t.Errorf("el vendedor no ve el cierre: %d", c)
	}
}

func TestInicioDelPanel(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	placa, _ := e.catalogo(t)
	e.pedido(t, "I-1", e.central, "pendiente", "mostrador", time.Date(2026, 10, 1, 0, 30, 0, 0, Argentina), nil, [4]any{placa, 1.0, 1000.0, nil})
	e.pedido(t, "I-2", e.aserradero, "entregado", "mostrador", time.Date(2026, 9, 30, 22, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 500.0, nil})
	e.exec(t, `insert into quotes (numero, contacto_nombre, estado, total, valido_hasta) values ('P-1', 'X', 'enviado', 10, now() + interval '1 day'), ('P-2', 'Y', 'revision', 20, null)`)

	_, b, _ := pedir(t, adm, e.u+"inicio/metricas?periodo=mes")
	var m Metricas
	_ = json.Unmarshal([]byte(b), &m)
	// La del 30/9 a las 22 es del mes pasado (en UTC ya era octubre).
	if m.VentasMes != 1000 || m.VariacionVentas == nil || *m.VariacionVentas != 100 || m.PresupuestosPendientes != 2 ||
		m.PresupuestosRevision != 1 || m.ReponerCentral != 1 || m.Reponer != 1 || m.PedidosSinEntregar != 1 {
		t.Errorf("métricas: %s", b)
	}
	_, b, _ = pedir(t, adm, e.u+"inicio/ventas-por-sucursal")
	if !strings.HasSuffix(b, `{"mes":"Sep","central":0,"aserradero":500},{"mes":"Oct","central":1000,"aserradero":0}]`+"\n") {
		t.Errorf("por sucursal: %s", b)
	}
	_, b, _ = pedir(t, adm, e.u+"inicio/reponer")
	if !strings.Contains(b, `"sucursal":"Casa Central","qty":10,"minQty":20`) {
		t.Errorf("reponer: %s", b)
	}
	_, b, _ = pedir(t, adm, e.u+"inicio/actividad")
	if !strings.Contains(b, `"numero":"I-1"`) || strings.Contains(b, `"numero":"I-2"`) || !strings.Contains(b, `"numero":"P-2"`) {
		t.Errorf("actividad: %s", b)
	}
	if c, _, _ := pedir(t, dep, e.u+"inicio/metricas"); c != 403 {
		t.Errorf("el depósito no ve los números: %d", c)
	}
	// Lo pendiente: cada rol lo suyo.
	_, b, _ = pedir(t, adm, e.u+"inicio/pendientes")
	if !strings.Contains(b, `"clave":"preparar","cantidad":1`) || !strings.Contains(b, `"clave":"presupuestos"`) || !strings.Contains(b, `"clave":"reponer"`) {
		t.Errorf("admin: %s", b)
	}
	_, b, _ = pedir(t, dep, e.u+"inicio/pendientes")
	if strings.Contains(b, "presupuestos") || !strings.Contains(b, `"clave":"reponer"`) {
		t.Errorf("depósito: %s", b)
	}
	// Sin sesión, con el secreto: el parte del día del admin.
	c, b, _ := pedir(t, http.DefaultClient, e.u+"inicio/pendientes?rol=admin", "Authorization", "Bearer "+secretoInterno)
	if c != 200 || !strings.Contains(b, `"clave":"presupuestos"`) {
		t.Errorf("interno: %d %s", c, b)
	}
	if c, _, _ := pedir(t, http.DefaultClient, e.u+"inicio/pendientes?rol=admin"); c != 401 {
		t.Errorf("sin secreto ni sesión: %d", c)
	}
}
