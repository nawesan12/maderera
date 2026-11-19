package stock

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/stockapi"
	"mjbj/internal/auth"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

func TestValidacionComoZod(t *testing.T) {
	crudo, err := os.ReadFile("../../testdata/golden/stock/validacion.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Transferencias []struct {
			Entrada  map[string]string
			Error    string
			Cantidad float64
			Nota     *string
		}
		Lecturas []struct {
			T string
			N any
		}
		Redondeos []struct{ V, R float64 }
		Unidades  []struct{ U, Larga string }
	}
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	for _, c := range g.Transferencias {
		e := c.Entrada
		cant, nota, err := validarTransferencia(FormTransferencia{e["variantId"], e["origenId"], e["destinoId"], e["cantidad"], e["nota"]})
		if c.Error != "" {
			var p *plataforma.Problema
			if err == nil || !errorsAs(err, &p) || !strings.Contains(mensajes(p), c.Error) {
				t.Errorf("%v: Go %v, zod %q", e, err, c.Error)
			}
			continue
		}
		if err != nil || cant != c.Cantidad || (c.Nota != nil && *c.Nota != nota) {
			t.Errorf("%v: Go (%v, %q, %v), zod (%v, %v)", e, cant, nota, err, c.Cantidad, c.Nota)
		}
	}
	for _, c := range g.Lecturas {
		n := LeerCantidad(c.T)
		if s, ok := c.N.(string); ok && s == "NaN" {
			if !math.IsNaN(n) {
				t.Errorf("leerCantidad(%q) = %v, TS NaN", c.T, n)
			}
		} else if n != c.N.(float64) {
			t.Errorf("leerCantidad(%q) = %v, TS %v", c.T, n, c.N)
		}
	}
	for _, c := range g.Redondeos {
		if r := Cantidad(c.V); r != c.R {
			t.Errorf("cantidadDeStock(%v) = %v, TS %v", c.V, r, c.R)
		}
	}
	for _, c := range g.Unidades {
		if r := UnidadLarga(c.U); r != c.Larga {
			t.Errorf("formatearUnidadLarga(%q) = %q, TS %q", c.U, r, c.Larga)
		}
	}
}

func mensajes(p *plataforma.Problema) string {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(p)
	return b.String()
}

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

type entorno struct {
	srv                        *httptest.Server
	pool                       *pgxpool.Pool
	ses                        *auth.Servicio
	central, aserradero, placa string
	tornillo                   string
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-del-stock-de-32-caracteres", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	stockapi.HandlerWithOptions(
		stockapi.NewStrictHandlerWithOptions(NuevaAPI(Nuevo(pool, silencio)),
			[]stockapi.StrictMiddlewareFunc{plataforma.ConPedido[stockapi.StrictHandlerFunc]},
			stockapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		stockapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := stockapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := stockapi.GetSwagger()
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
	pp := q(`insert into products (slug, name, category_id, description, unit) values ('fenolico', 'Fenólico', $1, '', 'placa') returning id`, cat)
	pt := q(`insert into products (slug, name, category_id, description, unit) values ('tornillo', 'Tornillo', $1, '', 'unidad') returning id`, cat)
	e.placa = q(`insert into product_variants (product_id, sku, label) values ($1, 'FEN18', '18 mm') returning id`, pp)
	e.tornillo = q(`insert into product_variants (product_id, sku, label) values ($1, 'TOR', '6x40') returning id`, pt)
	e.central = q(`insert into branches (slug, name, sort_order) values ('casa-central', 'Casa Central', 1) returning id`)
	e.aserradero = q(`insert into branches (slug, name, sort_order) values ('aserradero', 'Aserradero', 2) returning id`)
	_, _ = pool.Exec(ctx, `insert into inventory (variant_id, branch_id, qty, min_qty, reservado) values ($1, $2, 10, 4, 7), ($1, $3, 2, 0, 0)`, e.placa, e.central, e.aserradero)
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

func (e *entorno) qty(t *testing.T, variante, sucursal string) float64 {
	var q float64
	_ = e.pool.QueryRow(context.Background(), `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, variante, sucursal).Scan(&q)
	return q
}

func TestGrillaYAjuste(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/"

	_, b := pedir(t, dep, "GET", u+"stock?busqueda=fenol", nil)
	var grilla GrillaDeStock
	_ = json.Unmarshal([]byte(b), &grilla)
	g := grilla.Filas
	// En Casa Central hay 10 pero 7 reservados: disponible 3, mínimo 4 → bajo.
	if len(g) != 1 || len(g[0].Sucursales) != 2 || g[0].Sucursales[0].Slug != "casa-central" || g[0].Sucursales[0].Qty != 10 ||
		g[0].Sucursales[0].Reservado != 7 || g[0].Sucursales[0].Nivel != "bajo" || g[0].Sucursales[1].Nivel != "alto" || g[0].Total != 12 {
		t.Fatalf("grilla: %s", b)
	}
	if _, b := pedir(t, dep, "GET", u+"stock/alertas", nil); !strings.Contains(b, `"branchName":"Casa Central"`) {
		t.Errorf("alertas: %s", b)
	}
	// El depósito ajusta: +2,5 placas.
	if c, b := pedir(t, dep, "POST", u+"stock/ajuste", map[string]any{"variantId": e.placa, "branchSlug": "casa-central", "cantidad": 2.5}); c != 200 || !strings.Contains(b, "Casa Central: 10 → 12,5") {
		t.Fatalf("ajuste: %d %s", c, b)
	}
	if c, b := pedir(t, dep, "POST", u+"stock/ajuste", map[string]any{"variantId": e.placa, "branchSlug": "aserradero", "cantidad": -3}); c != 422 || !strings.Contains(b, "Solo hay 2 en Aserradero.") {
		t.Errorf("negativo: %d %s", c, b)
	}
	if c, b := pedir(t, dep, "POST", u+"stock/ajuste", map[string]any{"variantId": e.tornillo, "branchSlug": "casa-central", "cantidad": 1.5}); c != 422 || !strings.Contains(b, "se cuenta por unidad") {
		t.Errorf("tornillo con decimales: %d %s", c, b)
	}
	if c, b := pedir(t, dep, "POST", u+"stock/ajuste", map[string]any{"variantId": e.placa, "branchSlug": "casa-central", "cantidad": 0}); c != 200 || b != "{}\n" {
		t.Errorf("cero: %d %s", c, b)
	}
	_, b = pedir(t, dep, "GET", u+"stock/movimientos", nil)
	if !strings.Contains(b, `"type":"ingreso"`) || !strings.Contains(b, "Ajuste rápido desde Stock (10 → 12,5)") {
		t.Errorf("movimientos: %s", b)
	}
	if _, b := pedir(t, dep, "GET", u+"sucursales", nil); !strings.Contains(b, `"fondoBase":"0.00"`) {
		t.Errorf("sucursales: %s", b)
	}
}

func TestTransferencia(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	u := e.srv.URL + "/api/v1/admin/stock/transferencia"
	tr := func(cant string) (int, string) {
		return pedir(t, ven, "POST", u, map[string]string{"variantId": e.placa, "origenId": e.central, "destinoId": e.aserradero, "cantidad": cant, "nota": "Para la obra"})
	}
	// Hay 10 en Casa Central, 7 reservados: se pueden mover 3, no 5.
	if c, b := tr("5"); c != 422 || !strings.Contains(b, "hay 10 (7 reservados para clientes). No se pueden mover 5.") {
		t.Errorf("mover lo reservado: %d %s", c, b)
	}
	if c, b := tr("2,5"); c != 204 {
		t.Fatalf("transferir: %d %s", c, b)
	}
	if e.qty(t, e.placa, e.central) != 7.5 || e.qty(t, e.placa, e.aserradero) != 4.5 {
		t.Errorf("después: %v y %v", e.qty(t, e.placa, e.central), e.qty(t, e.placa, e.aserradero))
	}
	var grupos int
	_ = e.pool.QueryRow(context.Background(), `select count(distinct transfer_group) from inventory_movements where type in ('transferencia_salida', 'transferencia_entrada')`).Scan(&grupos)
	if grupos != 1 {
		t.Errorf("los dos movimientos van en un grupo: %d", grupos)
	}
	if c, b := pedir(t, ven, "POST", u, map[string]string{"variantId": e.placa, "origenId": e.central, "destinoId": e.central, "cantidad": "1"}); c != 422 || !strings.Contains(b, "tienen que ser distintos") {
		t.Errorf("mismo origen y destino: %d %s", c, b)
	}
}

// Transferencias cruzadas y ventas a la vez: con los candados (en orden
// fijo) nada se traba y los movimientos cuadran con el stock.
func TestTransferenciasConCandado(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	ctx := context.Background()
	_, _ = e.pool.Exec(ctx, `update inventory set qty = 500, reservado = 0`)
	_, _ = e.pool.Exec(ctx, `insert into inventory_movements (variant_id, branch_id, type, qty) values ($1, $2, 'ajuste', 500), ($1, $3, 'ajuste', 500)`, e.placa, e.central, e.aserradero)
	u := e.srv.URL + "/api/v1/admin/stock/transferencia"
	var wg sync.WaitGroup
	for i := range 10 {
		wg.Add(2)
		go func() {
			defer wg.Done()
			o, d := e.central, e.aserradero
			if i%2 == 1 {
				o, d = d, o
			}
			pedir(t, ven, "POST", u, map[string]string{"variantId": e.placa, "origenId": o, "destinoId": d, "cantidad": "3"})
		}()
		go func() { // una venta, como las reservas del TS
			defer wg.Done()
			tx, _ := e.pool.Begin(ctx)
			_, _ = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1::text || $2::text))`, e.placa, e.central)
			_, _ = tx.Exec(ctx, `update inventory set qty = qty - 1 where variant_id = $1 and branch_id = $2`, e.placa, e.central)
			_, _ = tx.Exec(ctx, `insert into inventory_movements (variant_id, branch_id, type, qty) values ($1, $2, 'venta', -1)`, e.placa, e.central)
			_ = tx.Commit(ctx)
		}()
	}
	wg.Wait()
	for _, suc := range []string{e.central, e.aserradero} {
		var suma float64
		_ = e.pool.QueryRow(ctx, `select sum(qty)::float8 from inventory_movements where variant_id = $1 and branch_id = $2`, e.placa, suc).Scan(&suma)
		if q := e.qty(t, e.placa, suc); suma != q {
			t.Errorf("sucursal %s: movimientos %v, stock %v", suc, suma, q)
		}
	}
	_ = jsmath.Round
}

func errorsAs(err error, p **plataforma.Problema) bool { return errors.As(err, p) }

func TestMetricasDeSucursales(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	_, _ = e.pool.Exec(ctx, `insert into orders (numero, contacto_nombre, branch_id, total, subtotal, estado) values
		('PED-1', 'Juan', $1, 1000, 1000, 'pendiente'), ('PED-2', 'Ana', $1, 500, 500, 'entregado'), ('PED-3', 'Sin sucursal', null, 10, 10, 'pendiente')`, e.central)
	// Las métricas son de /admin/sucursales (el admin): el depósito no.
	if c, _ := pedir(t, dep, "GET", e.srv.URL+"/api/v1/admin/sucursales/metricas", nil); c != 403 {
		t.Errorf("el depósito leyó las métricas: %d", c)
	}
	_, b := pedir(t, adm, "GET", e.srv.URL+"/api/v1/admin/sucursales/metricas", nil)
	var m []MetricasDeSucursal
	_ = json.Unmarshal([]byte(b), &m)
	if len(m) != 2 || m[0].Slug != "casa-central" || m[0].VentasHoy != 1500 || m[0].PedidosHoy != 2 || m[0].ClientesAtendidos != 2 ||
		m[0].PedidosAbiertos != 1 || m[0].ProductosStockBajo != 0 {
		t.Errorf("métricas: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.srv.URL+"/api/v1/admin/sucursales/sin-asignar", nil); b != "{\"cortes\":0,\"pedidos\":1}\n" {
		t.Errorf("sin asignar: %s", b)
	}
	// 22:30 del 10 en Argentina es el 11 en UTC: el día es el 10.
	if d := InicioDelDia(time.Date(2026, 11, 11, 1, 30, 0, 0, time.UTC)); !d.Equal(time.Date(2026, 11, 10, 3, 0, 0, 0, time.UTC)) {
		t.Errorf("inicio del día: %v", d.UTC())
	}
}

// La grilla de a páginas: los conteos de cada grupo con el filtro puesto, el
// grupo elegido en la consulta y una columna por sucursal activa de la base
// (una tercera aparece sola; una dada de baja, no).
func TestGrillaPaginadaYSucursalesDeLaBase(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/stock"
	var prod string
	_ = e.pool.QueryRow(ctx, `select product_id from product_variants where id = $1`, e.placa).Scan(&prod)
	// Doce medidas más del fenólico, sin stock.
	for i := range 12 {
		_, _ = e.pool.Exec(ctx, `insert into product_variants (product_id, sku, label, sort_order) values ($1, $2, $3, $4)`,
			prod, "FENX"+string(rune('A'+i)), "x", i+1)
	}
	puerto := ""
	_ = e.pool.QueryRow(ctx, `insert into branches (slug, name, sort_order) values ('puerto', 'Puerto', 3) returning id`).Scan(&puerto)
	_, _ = e.pool.Exec(ctx, `insert into branches (slug, name, sort_order, active) values ('cerrada', 'Cerrada', 4, false)`)
	// El tornillo tiene stock solo en la sucursal nueva.
	_, _ = e.pool.Exec(ctx, `insert into inventory (variant_id, branch_id, qty) values ($1, $2, 5)`, e.tornillo, puerto)

	leer := func(q string) GrillaDeStock {
		t.Helper()
		c, b := pedir(t, dep, "GET", u+q, nil)
		if c != 200 {
			t.Fatalf("%s: %d %s", q, c, b)
		}
		var g GrillaDeStock
		_ = json.Unmarshal([]byte(b), &g)
		return g
	}
	g := leer("?limite=5")
	if g.Total != 14 || len(g.Filas) != 5 || g.Conteos != (ConteosDeStock{Todas: 14, SinStock: 12, Reponer: 1, ConStock: 1}) {
		t.Fatalf("primera página: total %d, %d filas, %+v", g.Total, len(g.Filas), g.Conteos)
	}
	if len(g.Sucursales) != 3 || g.Sucursales[2].Slug != "puerto" || len(g.Filas[0].Sucursales) != 3 {
		t.Errorf("sucursales: %+v", g.Sucursales)
	}
	// La última página trae lo que queda y no repite.
	ultima := leer("?limite=5&desplazamiento=10")
	if len(ultima.Filas) != 4 || ultima.Filas[0].VariantID == g.Filas[0].VariantID {
		t.Errorf("última página: %d filas", len(ultima.Filas))
	}
	// Los grupos.
	if r := leer("?estado=reponer"); r.Total != 1 || len(r.Filas) != 1 || r.Filas[0].VariantID != e.placa {
		t.Errorf("reponer: %+v", r)
	}
	if r := leer("?estado=con-stock"); r.Total != 1 || r.Filas[0].VariantID != e.tornillo || r.Filas[0].Total != 5 || r.Filas[0].Sucursales[2].Qty != 5 {
		t.Errorf("con stock: %+v", r)
	}
	if r := leer("?estado=sin-stock&busqueda=fenol"); r.Total != 12 || r.Conteos.Todas != 13 {
		t.Errorf("sin stock con búsqueda: %d de %d", r.Total, r.Conteos.Todas)
	}
	// Marca y proveedor.
	_, _ = e.pool.Exec(ctx, `update products set brand = 'Faplac' where id = $1`, prod)
	if r := leer("?marca=faplac"); r.Total != 13 {
		t.Errorf("por marca: %d", r.Total)
	}
	var prov string
	_ = e.pool.QueryRow(ctx, `insert into suppliers (nombre) values ('Maderas Sur') returning id`).Scan(&prov)
	_, _ = e.pool.Exec(ctx, `insert into supplier_variant_codes (supplier_id, variant_id, codigo) values ($1, $2, 'X1')`, prov, e.tornillo)
	// El depósito no entra a Compras: el filtro por proveedor se ignora (con
	// el id de un proveedor se deducía qué le compra la maderera a quién).
	if r := leer("?proveedor=" + prov); r.Total != 14 {
		t.Errorf("el depósito no filtra por proveedor: %d", r.Total)
	}
	adm := e.staff(t, "admin@prueba.test", "admin")
	porProveedor := func(q string) GrillaDeStock {
		t.Helper()
		c, b := pedir(t, adm, "GET", u+q, nil)
		if c != 200 {
			t.Fatalf("%s: %d %s", q, c, b)
		}
		var g GrillaDeStock
		_ = json.Unmarshal([]byte(b), &g)
		return g
	}
	if r := porProveedor("?proveedor=" + prov); r.Total != 1 || r.Filas[0].VariantID != e.tornillo {
		t.Errorf("por proveedor: %+v", r.Total)
	}
	if r := porProveedor("?proveedor=no-es-un-id"); r.Total != 0 {
		t.Errorf("proveedor inválido: %d", r.Total)
	}
	// El ajuste rápido anda en la sucursal nueva: antes solo aceptaba las dos
	// escritas en el código.
	if c, b := pedir(t, dep, "POST", e.srv.URL+"/api/v1/admin/stock/ajuste", map[string]any{"variantId": e.tornillo, "branchSlug": "puerto", "cantidad": 2}); c != 200 || !strings.Contains(b, "Puerto: 5 → 7") {
		t.Errorf("ajuste en la sucursal nueva: %d %s", c, b)
	}
	if c, _ := pedir(t, dep, "POST", e.srv.URL+"/api/v1/admin/stock/ajuste", map[string]any{"variantId": e.tornillo, "branchSlug": "no-existe", "cantidad": 2}); c != 422 {
		t.Errorf("ajuste en una sucursal que no existe: %d", c)
	}
}

// El motivo dice para qué lado va el stock (T4, hallazgo 21): un ingreso que
// resta o una rotura que suma dejaban el libro diciendo lo contrario de lo que
// pasó. La devolución y la corrección (el «Deshacer») van para los dos lados.
func TestElMotivoDiceLaDireccion(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/stock/ajuste"
	ajuste := func(cantidad float64, motivo string, contado *float64) (int, string) {
		cuerpo := map[string]any{"variantId": e.tornillo, "branchSlug": "casa-central", "cantidad": cantidad, "motivo": motivo}
		if contado != nil {
			cuerpo["contado"] = *contado
		}
		return pedir(t, dep, "POST", u, cuerpo)
	}
	diez := 10.0
	if c, b := ajuste(0, "conteo", &diez); c != 200 {
		t.Fatalf("conteo inicial: %d %s", c, b)
	}

	rechazos := []struct {
		cantidad float64
		motivo   string
		contado  *float64
		dice     string
	}{
		{-2, "ingreso", nil, "Un ingreso suma"},
		{2, "rotura", nil, "resta"},
		{2, "faltante", nil, "resta"},
		{-2, "conteo", nil, "cuánto hay"},
		{0, "rotura", &diez, "Conteo"},
	}
	for _, r := range rechazos {
		if c, b := ajuste(r.cantidad, r.motivo, r.contado); c != 422 || !strings.Contains(b, r.dice) {
			t.Errorf("%s %v: %d %s", r.motivo, r.cantidad, c, b)
		}
	}
	if q := e.qty(t, e.tornillo, e.central); q != 10 {
		t.Fatalf("un rechazo movió el stock: %v", q)
	}

	aceptados := []struct {
		cantidad float64
		motivo   string
	}{
		{3, "ingreso"}, {-1, "rotura"}, {-1, "faltante"}, {2, "devolucion"}, {-2, "devolucion"},
		{1, "correccion"}, {-1, "correccion"}, {1, "otro"}, {-1, "otro"},
	}
	for _, a := range aceptados {
		if c, b := ajuste(a.cantidad, a.motivo, nil); c != 200 {
			t.Errorf("%s %v: %d %s", a.motivo, a.cantidad, c, b)
		}
	}
	// 10 + 3 − 1 − 1 + 2 − 2 + 1 − 1 + 1 − 1
	if q := e.qty(t, e.tornillo, e.central); q != 11 {
		t.Fatalf("stock: %v", q)
	}
	var nota string
	_ = e.pool.QueryRow(context.Background(), `select note from inventory_movements where variant_id = $1 and note like 'Corrección%' order by created_at limit 1`, e.tornillo).Scan(&nota)
	if !strings.HasPrefix(nota, "Corrección desde Stock") {
		t.Fatalf("la corrección no quedó con su nombre en el libro: %q", nota)
	}
}
