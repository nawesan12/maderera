package reportes

import (
	"context"
	"encoding/json"
	"fmt"
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
	// Pendiente de entrega, pero facturado: ya es venta (H162).
	a2 := e.pedido(t, "A-2", e.aserradero, "pendiente", "tienda", time.Date(2026, 10, 10, 10, 0, 0, 0, Argentina), nil,
		[4]any{placa, 1.0, 605.0, 250.0})
	e.facturaConCae(t, nil, 90, 605, "2026-10-10T14:00:00Z", &a2)
	e.pedido(t, "A-3", e.central, "cancelado", "mostrador", time.Date(2026, 10, 11, 10, 0, 0, 0, Argentina), nil,
		[4]any{placa, 50.0, 99999.0, 1.0})
	e.pedido(t, "S-1", e.central, "entregado", "mostrador", time.Date(2026, 9, 30, 22, 0, 0, 0, Argentina), nil,
		[4]any{placa, 1.0, 700.0, nil})

	_, b, _ := pedir(t, adm, e.u+"reportes/ventas?corte=producto&periodo=mes")
	var rep ReporteDeVentas
	_ = json.Unmarshal([]byte(b), &rep)
	filas := rep.Filas
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
	if c, b, _ := pedir(t, adm, e.u+"reportes/ventas?corte=canal&periodo=mes&sucursal=no-es-un-id"); c != 200 || !strings.HasPrefix(b, `{"filas":[],`) {
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
	r1 := e.pedido(t, "R-1", e.central, "entregado", "mostrador", ahoraDePrueba.Add(-5*24*time.Hour), nil, [4]any{placa, 60.0, 1.0, nil})
	r2 := e.pedido(t, "R-2", e.central, "cancelado", "mostrador", ahoraDePrueba.Add(-5*24*time.Hour), nil, [4]any{placa, 600.0, 1.0, nil})
	r3 := e.pedido(t, "R-3", e.central, "entregado", "mostrador", ahoraDePrueba.Add(-40*24*time.Hour), nil, [4]any{tirante, 9.0, 1.0, nil})

	_, b, _ := pedir(t, adm, e.u+"reportes/reposicion?dias=30&objetivo=30")
	var r ReporteDeReposicion
	_ = json.Unmarshal([]byte(b), &r)
	if len(r.Filas) != 2 || r.Filas[0].VariantID != placa || r.Filas[0].Disponible != 13 || r.Filas[0].Vendido != 60 ||
		*r.Filas[0].Cobertura != 7 || r.Filas[0].Sugerido != 47 || r.Filas[1].Vendido != 0 || r.Filas[1].Cobertura != nil {
		t.Fatalf("reposición: %s", b)
	}

	// Lo devuelto no es demanda: 20 de las 60 placas de R-1 vuelven (una
	// parte rota). La devolución de R-3 (fuera de la ventana) no cambia
	// nada, y la de R-2 (cancelado) no resta dos veces.
	usuario := e.id(t, `select id from "user" limit 1`)
	devolver := func(pedido string, numero int, partes ...[2]any) {
		t.Helper()
		factura := e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
			values ('factura_b', 3, $1, 'X', 1, 0, 0, 0, 0, 1, 'autorizada', now(), '7612', $2) returning id`, numero, pedido)
		dev := e.id(t, `insert into devoluciones (clave, order_id, invoice_id, importe, destino, motivo, created_by_user_id)
			values ($1, $2, $3, 1, 'afuera', 'sobró', $4) returning id`, fmt.Sprint("d", numero), pedido, factura, usuario)
		renglon := e.id(t, `select id from order_items where order_id = $1`, pedido)
		item := e.id(t, `insert into invoice_items (invoice_id, descripcion, cantidad, precio_unitario, neto, iva, subtotal, order_item_id)
			values ($1, 'renglón', 1, 1, 1, 0, 1, $2) returning id`, factura, renglon)
		for _, p := range partes {
			e.exec(t, `insert into devolucion_items (devolucion_id, invoice_item_id, order_item_id, cantidad, al_stock, importe) values ($1, $2, $3, $4, $5, 1)`,
				dev, item, renglon, p[0], p[1])
		}
	}
	devolver(r1, 901, [2]any{15.0, true}, [2]any{5.0, false})
	devolver(r2, 902, [2]any{100.0, true})
	devolver(r3, 903, [2]any{9.0, true})
	_, b, _ = pedir(t, adm, e.u+"reportes/reposicion?dias=30&objetivo=30")
	_ = json.Unmarshal([]byte(b), &r)
	if len(r.Filas) != 2 || r.Filas[0].Vendido != 40 || r.Filas[0].Sugerido != 27 || r.Filas[1].Vendido != 0 {
		t.Fatalf("reposición con devoluciones: %s", b)
	}
	if want := ArmarReposicion([]StockDeVariante{{VariantID: placa, DisponibleCentral: 8, DisponibleAserradero: 5}},
		map[string]float64{placa: 40}, 30, 30, "todos").Filas[0]; *r.Filas[0].Cobertura != *want.Cobertura {
		t.Errorf("cobertura: %v, quería %v", *r.Filas[0].Cobertura, *want.Cobertura)
	}
	if len(r.PorCategoria) != 1 || r.PorCategoria[0].Nombre != "Placas" {
		t.Errorf("por categoría: %+v", r.PorCategoria)
	}
	_, b, _ = pedir(t, adm, e.u+"reportes/reposicion?dias=60&sucursal=aserradero&rubro=fenolicos&objetivo=1000")
	_ = json.Unmarshal([]byte(b), &r)
	if len(r.Filas) != 1 || r.Filas[0].Disponible != 5 || r.Filas[0].Vendido != 0 || r.CoberturaObjetivo != 180 || r.DiasDelPeriodo != 60 {
		t.Errorf("aserradero y fenólicos: %s", b)
	}
	// El mismo slug en otra categoría: por slug salen los dos, por id solo
	// el elegido (tercera prueba del mes, H069).
	otraCat := e.id(t, `insert into categories (slug, name, description) values ('herrajes', 'Herrajes', '') returning id`)
	otroSub := e.id(t, `insert into subcategories (category_id, slug, name) values ($1, 'fenolicos', 'Fenólicos') returning id`, otraCat)
	otroProd := e.id(t, `insert into products (slug, name, category_id, subcategory_id, description, unit) values ('bisagra', 'Bisagra', $1, $2, '', 'unidad') returning id`, otraCat, otroSub)
	e.exec(t, `insert into product_variants (product_id, sku, label) values ($1, 'BIS', '35 mm')`, otroProd)
	if _, b, _ = pedir(t, adm, e.u+"reportes/reposicion?rubro=fenolicos"); json.Unmarshal([]byte(b), &r) != nil || len(r.Filas) != 2 {
		t.Errorf("por slug: %s", b)
	}
	if _, b, _ = pedir(t, adm, e.u+"reportes/reposicion?rubro="+otroSub); json.Unmarshal([]byte(b), &r) != nil || len(r.Filas) != 1 || r.Filas[0].Producto != "Bisagra" {
		t.Errorf("por id: %s", b)
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
	// Sin entregar y facturado: es venta del mes de la factura (H162).
	i1 := e.pedido(t, "I-1", e.central, "pendiente", "mostrador", time.Date(2026, 10, 1, 0, 30, 0, 0, Argentina), nil, [4]any{placa, 1.0, 1000.0, nil})
	e.facturaConCae(t, nil, 91, 1000, "2026-10-01T03:30:00Z", &i1)
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
	if !strings.HasSuffix(b, `{"mes":"Sep","sucursales":[{"sucursal":"casa-central","nombre":"Casa Central","total":0},{"sucursal":"aserradero","nombre":"Aserradero","total":500}],"central":0,"aserradero":500},`+
		`{"mes":"Oct","sucursales":[{"sucursal":"casa-central","nombre":"Casa Central","total":1000},{"sucursal":"aserradero","nombre":"Aserradero","total":0}],"central":1000,"aserradero":0}]`+"\n") {
		t.Errorf("por sucursal: %s", b)
	}
	_, b, _ = pedir(t, adm, e.u+"inicio/reponer")
	if !strings.Contains(b, `"sucursal":"Casa Central","qty":8,"minQty":20`) {
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

// deudores es lo que los asientos le restan a Deudores por ventas (haber −
// debe), y cuántos asientos lo tocan.
func deudores(asientos []Asiento) (float64, int) {
	neto, n := 0.0, 0
	for _, a := range asientos {
		toca := false
		for _, r := range a.Renglones {
			if r.Cuenta == Cuentas.Deudores {
				neto += r.Haber - r.Debe
				toca = true
			}
		}
		if toca {
			n++
		}
	}
	return redondear(neto), n
}

func buscarAsiento(asientos []Asiento, concepto string) *Asiento {
	for i := range asientos {
		if strings.HasPrefix(asientos[i].Concepto, concepto) {
			return &asientos[i]
		}
	}
	return nil
}

// Bug: los asientos de cobro salían solo de los cobros de una factura. El
// cobro de cuenta corriente desde la ficha o el mostrador, el de Mercado
// Pago, la transferencia o la retención (todos con recibo, sin factura) no
// se asentaban, y Deudores del CSV no daba lo que las cuentas corrientes.
// Ahora salen de los recibos; el cobro de una factura con recibo no se
// asienta dos veces, y la venta del mostrador facturada asienta su cobro.
func TestCierreAsientaLosCobrosDesdeLosRecibos(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre, razon_social) values ('Juan Pérez', 'Pérez SRL') returning id`)
	recibo := func(numero, origen string, total float64, emitido string, anulado *string, partes ...[2]any) string {
		estado := "emitido"
		if anulado != nil {
			estado = "anulado"
		}
		id := e.id(t, `insert into receipts (numero, customer_id, recibido_de, total, estado, origen, created_at, anulado_at)
			values ($1, $2, 'Pérez SRL', $3, $4, $5, $6, $7) returning id`, numero, cliente, total, estado, origen, emitido, anulado)
		for i, p := range partes {
			e.exec(t, `insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, $2, $3, $4)`, id, p[0], p[1], i)
		}
		return id
	}
	// Lo que el cliente debe facturado: el cobro de la ficha lo cancela
	// entero contra Deudores. Sin esto el recibo sería del circuito B
	// (TestReciboPorCircuito).
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, customer_id)
		values ('factura_a', 3, 199, 'Pérez SRL', 826.45, 173.55, 0, 0, 0, 1000, 'autorizada', '2026-10-01T15:00:00Z', '76123456789011', $1)`, cliente)
	// Cobro de cuenta corriente desde la ficha, partido en cuatro medios.
	recibo("REC-0001", "panel", 1000, "2026-10-10T15:00:00Z", nil,
		[2]any{"efectivo", 300}, [2]any{"cheque", 500}, [2]any{"retencion", 50}, [2]any{"transferencia", 150})
	// Emitido en septiembre y anulado en octubre: solo el contraasiento.
	anulado := "2026-10-12T15:00:00Z"
	recibo("REC-0002", "mercado_pago", 200, "2026-09-20T15:00:00Z", &anulado, [2]any{"mercado_pago", 200})
	// El 31 de octubre a las 23:30 de Buenos Aires es noviembre en UTC: es de octubre.
	recibo("REC-0003", "mostrador", 70, "2026-11-01T02:30:00Z", nil, [2]any{"efectivo", 70})
	// El 1.º de octubre a las 0:30 UTC es 30 de septiembre en Buenos Aires: no es de octubre.
	recibo("REC-0004", "panel", 40, "2026-10-01T00:30:00Z", nil, [2]any{"efectivo", 40})
	// El cobro de una factura con recibo: un asiento, no dos.
	fac := e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, customer_id)
		values ('factura_a', 3, 200, 'Pérez SRL', 1000, 210, 0, 0, 0, 1210, 'autorizada', '2026-10-05T15:00:00Z', '76123456789012', $1) returning id`, cliente)
	rf := recibo("REC-0005", "factura", 1210, "2026-10-06T15:00:00Z", nil, [2]any{"efectivo", 1210})
	e.exec(t, `insert into invoice_payments (invoice_id, medio, monto, receipt_id, fecha) values ($1, 'efectivo', 1210, $2, '2026-10-06T15:00:00Z')`, fac, rf)

	// Una venta del mostrador cobrada al contado, sin recibo, facturada dos
	// días después: el cobro se asienta en la fecha de la factura.
	m1 := e.pedido(t, "M-0001", e.central, "entregado", "mostrador", time.Date(2026, 10, 18, 12, 0, 0, 0, Argentina), &cliente)
	e.exec(t, `insert into payments (order_id, customer_id, tipo, proveedor, medio, monto, estado, conciliado_at, created_at)
		values ($1, $2, 'pedido', 'mostrador', 'efectivo', 800, 'aprobado', '2026-10-18T15:00:00Z', '2026-10-18T15:00:00Z')`, m1, cliente)
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
		values ('factura_b', 3, 201, 'Pérez SRL', 661.16, 138.84, 0, 0, 0, 800, 'autorizada', '2026-10-20T15:00:00Z', '76123456789013', $1)`, m1)
	// Sin factura no hay asiento de venta, así que tampoco de cobro.
	m2 := e.pedido(t, "M-0002", e.central, "entregado", "mostrador", time.Date(2026, 10, 18, 13, 0, 0, 0, Argentina), nil)
	e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, created_at)
		values ($1, 'pedido', 'mostrador', 'efectivo', 999, 'aprobado', '2026-10-18T16:00:00Z')`, m2)
	// Una venta con cheque, facturada y anulada después: cobro y reintegro.
	m3 := e.pedido(t, "M-0003", e.central, "cancelado", "mostrador", time.Date(2026, 10, 21, 12, 0, 0, 0, Argentina), &cliente)
	e.exec(t, `insert into payments (order_id, customer_id, tipo, proveedor, medio, monto, estado, created_at, updated_at)
		values ($1, $2, 'pedido', 'mostrador', 'cheque', 400, 'reintegrado', '2026-10-21T15:00:00Z', '2026-10-25T15:00:00Z')`, m3, cliente)
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
		values ('factura_b', 3, 202, 'Pérez SRL', 330.58, 69.42, 0, 0, 0, 400, 'autorizada', '2026-10-21T15:00:00Z', '76123456789014', $1)`, m3)

	// Un pago de Mercado Pago con recibo, devuelto en parte: el tramo que
	// volvió a la cuenta es el cobro al revés.
	mp := e.id(t, `insert into payments (customer_id, tipo, proveedor, medio, monto, estado) values ($1, 'deuda', 'mercado_pago', 'visa', 90, 'aprobado') returning id`, cliente)
	r6 := recibo("REC-0006", "mercado_pago", 90, "2026-10-14T15:00:00Z", nil, [2]any{"mercado_pago", 90})
	e.exec(t, `update receipt_parts set payment_id = $1 where receipt_id = $2`, mp, r6)
	mov := e.id(t, `insert into account_movements (customer_id, tipo, monto, referencia) values ($1, 'ajuste', 25, '555') returning id`, cliente)
	e.exec(t, `insert into payment_refunds (payment_id, importe, acumulado, referencia, account_movement_id, created_at)
		values ($1, 25, 25, '555', $2, '2026-10-16T15:00:00Z')`, mp, mov)

	p := PeriodoDelCierre("2026-10", ahoraDePrueba)
	asientos, err := e.s.AsientosDelPeriodo(ctx, p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range asientos {
		if !a.Balancea {
			t.Errorf("no cierra: %+v", a)
		}
	}
	r1 := buscarAsiento(asientos, "Recibo REC-0001")
	if r1 == nil || len(r1.Renglones) != 5 || r1.Renglones[0] != renglon(Cuentas.Caja, 300, 0) ||
		r1.Renglones[1] != renglon(Cuentas.ValoresADepositar, 500, 0) || r1.Renglones[2] != renglon(Cuentas.RetencionesSufridas, 50, 0) ||
		r1.Renglones[3] != renglon(Cuentas.Banco, 150, 0) || r1.Renglones[4] != renglon(Cuentas.Deudores, 0, 1000) {
		t.Errorf("el recibo partido: %+v", r1)
	}
	if a := buscarAsiento(asientos, "Recibo REC-0002"); a != nil {
		t.Errorf("el recibo de septiembre no es de octubre: %+v", a)
	}
	// El de septiembre no tenía nada facturado detrás: fue al B, y su
	// anulación también.
	if a := buscarAsiento(asientos, "Anulación del recibo REC-0002"); a == nil || a.Circuito != CircuitoNegro ||
		a.Renglones[1] != renglon(Cuentas.VentasSinFactura, 200, 0) {
		t.Errorf("el contraasiento de la anulación: %+v", a)
	}
	if buscarAsiento(asientos, "Recibo REC-0003") == nil || buscarAsiento(asientos, "Recibo REC-0004") != nil {
		t.Errorf("el corte es el mes argentino")
	}
	if a := buscarAsiento(asientos, "Cobro Factura A"); a != nil {
		t.Errorf("el cobro de la factura con recibo se asentó dos veces: %+v", a)
	}
	m := buscarAsiento(asientos, "Cobro Factura B 0003-00000201 (pedido M-0001)")
	if m == nil || !m.Fecha.Equal(time.Date(2026, 10, 20, 15, 0, 0, 0, time.UTC)) || m.Renglones[0] != renglon(Cuentas.Caja, 800, 0) {
		t.Errorf("la venta del mostrador facturada: %+v", m)
	}
	if a := buscarAsiento(asientos, "Reintegro Factura B 0003-00000202"); a == nil || a.Renglones[1] != renglon(Cuentas.ValoresADepositar, 0, 400) {
		t.Errorf("la venta anulada: %+v", a)
	}
	// El recibo de Mercado Pago fue al B (no había nada facturado): su
	// reintegro parcial vuelve al B.
	if a := buscarAsiento(asientos, "Reintegro parcial del recibo REC-0006"); a == nil || a.Circuito != CircuitoNegro ||
		a.Renglones[0] != renglon(Cuentas.VentasSinFactura, 25, 0) {
		t.Errorf("el reintegro parcial: %+v", a)
	}
	// Deudores: las cuatro facturas suben 3410 (1000 + 1210 + 800 + 400) y
	// los cobros blancos bajan 3010 (recibos: 1210 + 1000; ventas: 800 +
	// 400 − 400). Los recibos sin nada facturado detrás no lo tocan.
	if neto, n := deudores(asientos); neto != -400 {
		t.Errorf("Deudores baja %v (en %d asientos de cobro)", neto, n)
	}
	for _, a := range asientos {
		if strings.Contains(a.Concepto, "M-0002") {
			t.Errorf("la venta sin factura no tiene asiento: %+v", a)
		}
	}
}

// Cuando compras agregue retenciones_practicadas.anulada_at (00089), el
// resumen del cierre deja de contar las anuladas; sin la columna no falla.
func TestCierreSinRetencionesPracticadasAnuladas(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	prov := e.id(t, `insert into suppliers (nombre) values ('Maderas del Sur') returning id`)
	pago := e.id(t, `insert into supplier_payments (supplier_id, total, neto, medio, fecha) values ($1, 1000, 970, 'transferencia', '2026-10-08T15:00:00Z') returning id`, prov)
	reg := e.id(t, `insert into regimenes_retencion (codigo, nombre, impuesto, alicuota, alicuota_no_inscripto) values ('IIBB', 'IIBB Misiones', 'iibb', 3, 3) returning id`)
	retencion := func(numero string) string {
		return e.id(t, `insert into retenciones_practicadas (payment_id, supplier_id, regimen_id, numero, codigo_regimen, impuesto, base, alicuota, importe, fecha)
			values ($1, $2, $3, $4, 'IIBB', 'iibb', 1000, 3, 30, '2026-10-08T15:00:00Z') returning id`, pago, prov, reg, numero)
	}
	retencion("R-1")
	anulada := retencion("R-2")
	p := PeriodoDelCierre("2026-10", ahoraDePrueba)
	r, err := e.s.ResumenDelMes(ctx, p.Desde, p.Hasta)
	if err != nil || r.RetencionesPracticadas.Cantidad != 2 {
		t.Fatalf("sin la columna cuentan las dos: %+v %v", r.RetencionesPracticadas, err)
	}
	e.exec(t, `alter table retenciones_practicadas add column if not exists anulada_at timestamptz`)
	e.exec(t, `update retenciones_practicadas set anulada_at = now() where id = $1`, anulada)
	r, err = e.s.ResumenDelMes(ctx, p.Desde, p.Hasta)
	if err != nil || r.RetencionesPracticadas.Cantidad != 1 || r.RetencionesPracticadas.Total != 30 {
		t.Errorf("la anulada no cuenta: %+v %v", r.RetencionesPracticadas, err)
	}
}

// Un pago a proveedor de octubre anulado en noviembre: octubre no cambia (el
// pago sigue ahí) y noviembre lleva el contraasiento.
func TestElPagoAnuladoVaConSuContraasiento(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	prov := e.id(t, `insert into suppliers (nombre) values ('Aserradero Norte') returning id`)
	e.exec(t, `insert into supplier_payments (supplier_id, total, neto, medio, referencia, fecha, anulado_at, motivo_anulacion)
		values ($1, 1000, 1000, 'transferencia', 'TR 9', '2026-10-15T15:00:00Z', '2026-11-03T15:00:00Z', 'mal cargado')`, prov)
	conceptos := func(periodo string) []string {
		_, b, _ := pedir(t, adm, e.u+"cierre/asientos?periodo="+periodo)
		var as []Asiento
		_ = json.Unmarshal([]byte(b), &as)
		var c []string
		for _, a := range as {
			c = append(c, a.Concepto)
			if !a.Balancea {
				t.Errorf("%s no balancea", a.Concepto)
			}
		}
		return c
	}
	if c := conceptos("2026-10"); fmt.Sprint(c) != "[Pago a Aserradero Norte · TR 9]" {
		t.Errorf("octubre: %v", c)
	}
	if c := conceptos("2026-11"); fmt.Sprint(c) != "[Anulación · Pago a Aserradero Norte · TR 9]" {
		t.Errorf("noviembre: %v", c)
	}
}

// Un pedido para entregar hoy no está atrasado en ningún momento del día
// argentino, ni a las 21 h (medianoche UTC) ni a las 0 h; el de ayer, sí.
func TestPedidoParaHoyNoEstaAtrasado(t *testing.T) {
	e := armar(t)
	ar, _ := time.LoadLocation("America/Argentina/Buenos_Aires")
	creado := time.Date(2026, 11, 10, 12, 0, 0, 0, ar)
	hoy := e.pedido(t, "P-HOY", e.central, "pendiente", "mostrador", creado, nil)
	ayer := e.pedido(t, "P-AYER", e.central, "pendiente", "mostrador", creado, nil)
	e.exec(t, `update orders set entregar_el = '2026-11-18' where id = $1`, hoy)
	e.exec(t, `update orders set entregar_el = '2026-11-17' where id = $1`, ayer)
	ve := func(string) bool { return true }
	for _, ahora := range []time.Time{
		time.Date(2026, 11, 18, 0, 5, 0, 0, ar),
		time.Date(2026, 11, 18, 12, 0, 0, 0, ar),
		time.Date(2026, 11, 18, 21, 30, 0, 0, ar),
	} {
		o, err := e.s.otrosPendientes(context.Background(), ve, ahora)
		if err != nil {
			t.Fatal(err)
		}
		if o.pedidosAtrasados != 1 {
			t.Fatalf("a las %s: %d atrasados (solo el de ayer)", ahora.Format("15:04"), o.pedidosAtrasados)
		}
	}
	// El 17 a las 21 h (ya 18 en UTC), el de ayer todavía es de hoy.
	o, err := e.s.otrosPendientes(context.Background(), ve, time.Date(2026, 11, 17, 21, 30, 0, 0, ar))
	if err != nil {
		t.Fatal(err)
	}
	if o.pedidosAtrasados != 0 {
		t.Fatalf("el 17 a las 21 h: %d atrasados", o.pedidosAtrasados)
	}
}

// T7: un cheque o una factura de compra que vence en las próximas 48 horas
// va en «Para hoy» (urgente); lo que vence más adelante en la semana queda
// en «Pendientes».
func TestLoQueVenceEn48HorasEsDeHoy(t *testing.T) {
	e := armar(t)
	e.exec(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado) values
		('recibido', '2001', 'Nación', now() + interval '20 hours', 100, 'cartera'),
		('entregado', '2002', 'Nación', now() + interval '5 days', 100, 'entregado')`)
	prov := e.id(t, `insert into suppliers (nombre) values ('Maderas del Sur') returning id`)
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision, fecha_vencimiento)
		values ($1, 'factura_a', 1, 1, 100, 0, 0, 0, 0, 100, $2, $2::timestamptz + interval '30 hours'),
		       ($1, 'factura_a', 1, 2, 100, 0, 0, 0, 0, 100, $2, $2::timestamptz + interval '6 days'),
		       ($1, 'factura_a', 1, 3, 100, 0, 0, 0, 0, 100, $2::timestamptz - interval '20 days', $2::timestamptz - interval '2 days'),
		       ($1, 'factura_a', 1, 4, 100, 0, 0, 0, 0, 100, $2::timestamptz - interval '20 days', $2::timestamptz - interval '3 days')`, prov, ahoraDePrueba)
	// Los cortes de día de las facturas son los de «Debo» (el día de la
	// prueba), y cuentan solo si el libro del proveedor debe algo.
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto) values ($1, 'factura', 400)`, prov)
	ps, err := e.s.PendientesDelRol(context.Background(), "admin")
	if err != nil {
		t.Fatal(err)
	}
	quiere := map[string]bool{"cheques-48h": true, "cheques": false, "compras-48h": true, "compras": false}
	vistos := map[string]bool{}
	for _, p := range ps {
		// Lo que vence pronto es de hoy, pero no está vencido: no va en rojo.
		if p.Vencido && p.Clave != "cheques-vencidos" && p.Clave != "compras-vencidas" && p.Clave != "pedidos-atrasados" &&
			p.Clave != "presupuestos-sin-responder" && p.Clave != "deuda-vencida" {
			t.Errorf("%s marcado vencido", p.Clave)
		}
		if u, ok := quiere[p.Clave]; ok {
			vistos[p.Clave] = true
			if p.Urgente != u || p.Cantidad != 1 {
				t.Errorf("%s: urgente %v, cantidad %d", p.Clave, p.Urgente, p.Cantidad)
			}
		}
	}
	if len(vistos) != len(quiere) {
		t.Errorf("faltan pendientes: %v", vistos)
	}
	// Las tres cuentas de las compras salen de una sola pasada: las
	// vencidas no se mezclan con las que vencen pronto.
	vencidas := 0
	for _, p := range ps {
		if p.Clave == "compras-vencidas" {
			vencidas = p.Cantidad
		}
	}
	if vencidas != 2 {
		t.Errorf("compras vencidas: %d, quería 2", vencidas)
	}
	// El depósito no ve cheques ni compras.
	ps, err = e.s.PendientesDelRol(context.Background(), "deposito")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range ps {
		if strings.HasPrefix(p.Clave, "cheques") || strings.HasPrefix(p.Clave, "compras") {
			t.Errorf("el depósito ve %s", p.Clave)
		}
	}
}
