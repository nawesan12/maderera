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
	var g []FilaStock
	_ = json.Unmarshal([]byte(b), &g)
	// En Casa Central hay 10 pero 7 reservados: disponible 3, mínimo 4 → bajo.
	if len(g) != 1 || g[0].QtyCentral != 10 || g[0].ReservadoCentral != 7 || g[0].NivelCentral != "bajo" || g[0].NivelAserradero != "alto" || g[0].Total != 12 {
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
	ctx := context.Background()
	_, _ = e.pool.Exec(ctx, `insert into orders (numero, contacto_nombre, branch_id, total, subtotal, estado) values
		('PED-1', 'Juan', $1, 1000, 1000, 'pendiente'), ('PED-2', 'Ana', $1, 500, 500, 'entregado'), ('PED-3', 'Sin sucursal', null, 10, 10, 'pendiente')`, e.central)
	_, b := pedir(t, dep, "GET", e.srv.URL+"/api/v1/admin/sucursales/metricas", nil)
	var m []MetricasDeSucursal
	_ = json.Unmarshal([]byte(b), &m)
	if len(m) != 2 || m[0].Slug != "casa-central" || m[0].VentasHoy != 1500 || m[0].PedidosHoy != 2 || m[0].ClientesAtendidos != 2 ||
		m[0].PedidosAbiertos != 1 || m[0].ProductosStockBajo != 0 {
		t.Errorf("métricas: %s", b)
	}
	if _, b := pedir(t, dep, "GET", e.srv.URL+"/api/v1/admin/sucursales/sin-asignar", nil); b != "{\"cortes\":0,\"pedidos\":1}\n" {
		t.Errorf("sin asignar: %s", b)
	}
	// 22:30 del 10 en Argentina es el 11 en UTC: el día es el 10.
	if d := InicioDelDia(time.Date(2026, 11, 11, 1, 30, 0, 0, time.UTC)); !d.Equal(time.Date(2026, 11, 10, 3, 0, 0, 0, time.UTC)) {
		t.Errorf("inicio del día: %v", d.UTC())
	}
}
