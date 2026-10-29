package mostrador

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
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/mostradorapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

type entorno struct {
	srv              *httptest.Server
	pool             *pgxpool.Pool
	ses              *auth.Servicio
	svc              *Servicio
	central, otra    string
	placa, tornillo  string
	general, profe   string
	cliente, mayor   string
	u                string
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-del-mostrador-de-32-caracteres", URL: "http://localhost"}, pool)
	svc := Nuevo(pool, silencio)
	m := http.NewServeMux()
	svc.Rutas(m)
	mostradorapi.HandlerWithOptions(
		mostradorapi.NewStrictHandlerWithOptions(NuevaAPI(svc),
			[]mostradorapi.StrictMiddlewareFunc{plataforma.ConPedido[mostradorapi.StrictHandlerFunc]},
			mostradorapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		mostradorapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := mostradorapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := mostradorapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	e := &entorno{srv: srv, pool: pool, ses: ses, svc: svc, u: srv.URL}
	q := func(sql string, args ...any) string {
		var id string
		if err := pool.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	cat := q(`insert into categories (slug, name, description) values ('placas', 'Placas', '') returning id`)
	pp := q(`insert into products (slug, name, category_id, description, unit, forma_de_venta, brand) values ('fenolico', 'Fenólico', $1, '', 'placa', 'entera_o_media', 'Faplac') returning id`, cat)
	pt := q(`insert into products (slug, name, category_id, description, unit) values ('tornillo', 'Tornillo', $1, '', 'unidad') returning id`, cat)
	e.placa = q(`insert into product_variants (product_id, sku, label, largo_mm, ancho_mm) values ($1, 'FEN18', '18 mm', 2440, 1220) returning id`, pp)
	e.tornillo = q(`insert into product_variants (product_id, sku, label) values ($1, 'TOR', '6x40') returning id`, pt)
	e.central = q(`insert into branches (slug, name, sort_order, fondo_base) values ('casa-central', 'Casa Central', 1, 1000) returning id`)
	e.otra = q(`insert into branches (slug, name, sort_order) values ('aserradero', 'Aserradero', 2) returning id`)
	e.general = q(`insert into price_lists (name, slug, is_default) values ('General', 'general', true) returning id`)
	e.profe = q(`insert into price_lists (name, slug) values ('Profesional', 'profesional') returning id`)
	q(`insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 45000.50) returning id`, e.general, e.placa)
	q(`insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 150) returning id`, e.general, e.tornillo)
	q(`insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 40000) returning id`, e.profe, e.placa)
	q(`insert into inventory (variant_id, branch_id, qty) values ($1, $2, 100) returning id`, e.placa, e.central)
	q(`insert into inventory (variant_id, branch_id, qty) values ($1, $2, 1000) returning id`, e.tornillo, e.central)
	e.cliente = q(`insert into customers (nombre, cuit, limite_credito) values ('Ana Gómez', '20123456786', 1000000) returning id`)
	e.mayor = q(`insert into customers (nombre, price_list_id) values ('Carpintería Pérez', $1) returning id`, e.profe)
	return e
}

func (e *entorno) staff(t *testing.T, correo string, rol sqlc.StaffRole) *http.Client {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeStaff(ctx, correo, "una clave larga", "Persona "+string(rol), rol); err != nil {
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

func pedir(t *testing.T, c *http.Client, metodo, url string, cuerpo any) (int, map[string]any, string) {
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
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	return resp.StatusCode, m, string(b)
}

func (e *entorno) num(t *testing.T, sql string, args ...any) float64 {
	t.Helper()
	var f float64
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&f); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return f
}

func (e *entorno) txt(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var s string
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&s); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return s
}

var claves int

func clave() string {
	claves++
	return fmt.Sprintf("8f2b5c1e-1d2a-4c3b-9a8e-%012d", claves)
}

func (e *entorno) venta(medio string, lineas ...map[string]any) map[string]any {
	return map[string]any{
		"clave": clave(), "branchId": e.central, "lineas": lineas, "customerId": nil,
		"contactoNombre": "Consumidor final", "medioPago": medio,
	}
}

func (e *entorno) lineaPlaca(cantidad float64) map[string]any {
	return map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "unidad": "placa", "cantidad": cantidad, "precioUnitario": 45000.5}
}

func (e *entorno) abrir(t *testing.T, c *http.Client, sucursal string, fondo float64) {
	t.Helper()
	if st, m, b := pedir(t, c, "POST", e.u+"/api/v1/mostrador/caja/abrir", map[string]any{"branchId": sucursal, "fondoInicial": fondo}); st != 200 {
		t.Fatalf("abrir caja: %d %v %s", st, m, b)
	}
}

func TestVentaEnLineaYAnulacion(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	ctx := context.Background()

	// Sin caja abierta, el efectivo no se cobra.
	v := e.venta("efectivo", e.lineaPlaca(2))
	st, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != false || m["error"] != "No hay caja abierta en esta sucursal. Abrila antes de cobrar en efectivo." {
		t.Fatalf("sin caja: %d %v", st, m)
	}
	// Abrir con menos que la base avisa.
	st, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/abrir", map[string]any{"branchId": e.central, "fondoInicial": 500})
	if st != 200 || m["ok"] != "Caja abierta, pero el fondo quedó por debajo de la base de $1000.00. Reponé el cambio." {
		t.Fatalf("abrir: %d %v", st, m)
	}
	st, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/abrir", map[string]any{"branchId": e.central, "fondoInicial": 500})
	if st != 422 || !strings.Contains(fmt.Sprint(m["errores"]), "Ya hay una caja abierta en esta sucursal.") {
		t.Fatalf("abrir dos veces: %d %v", st, m)
	}

	// El descuento automático por efectivo (10 % desde 0).
	if _, err := e.pool.Exec(ctx, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta) values ('efectivo', 0, 10, 'Contado -10%')`); err != nil {
		t.Fatal(err)
	}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != true || m["nueva"] != true || m["numero"] != "PED-1000" || m["total"] != 81000.9 {
		t.Fatalf("venta: %d %s", st, b)
	}
	pedido := m["orderId"].(string)
	if d := e.txt(t, `select descuento::text || ' ' || descuento_motivo || ' ' || subtotal::text || ' ' || estado || ' ' || estado_pago from orders where id = $1`, pedido); d != "9000.10 Contado -10% 90001.00 entregado pagado" {
		t.Fatalf("pedido: %q", d)
	}
	if q := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != 98 {
		t.Fatalf("stock: %v", q)
	}
	if c := e.num(t, `select sum(monto)::float8 from cash_movements`); c != 500+81000.9 {
		t.Fatalf("caja: %v", c)
	}
	if n := e.num(t, `select count(*)::float8 from payments where order_id = $1 and estado = 'aprobado' and medio = 'efectivo'`, pedido); n != 1 {
		t.Fatalf("pagos: %v", n)
	}
	if d := e.txt(t, `select descripcion from audit_log order by created_at desc limit 1`); d != "Venta de mostrador PED-1000 por $81000.90" {
		t.Fatalf("bitácora: %q", d)
	}

	// La misma clave otra vez: la misma venta, sin tocar nada.
	st, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["nueva"] != false || m["orderId"] != pedido {
		t.Fatalf("repetida: %d %v", st, m)
	}
	if q := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != 98 {
		t.Fatalf("stock tras repetir: %v", q)
	}

	// Un esquema roto: el primer error de zod.
	st, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", map[string]any{"clave": "x"})
	if st != 422 || fmt.Sprint(m["errores"]) != "map[error:Invalid UUID]" {
		t.Fatalf("esquema: %d %v", st, m)
	}

	// Anular: el stock vuelve, la caja devuelve, el pedido queda cancelado.
	st, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas/"+pedido+"/anular", map[string]any{"motivo": "  "})
	if st != 422 {
		t.Fatalf("anular sin motivo: %d %v", st, m)
	}
	st, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas/"+pedido+"/anular", map[string]any{"motivo": "Se equivocó de medida"})
	if st != 200 || m["ok"] != "Venta anulada." {
		t.Fatalf("anular: %d %v", st, m)
	}
	if q := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != 100 {
		t.Fatalf("stock tras anular: %v", q)
	}
	if c := e.num(t, `select sum(monto)::float8 from cash_movements`); c != 500 {
		t.Fatalf("caja tras anular: %v", c)
	}
	if s := e.txt(t, `select estado || ' ' || estado_pago || ' ' || notas from orders where id = $1`, pedido); s != "cancelado reintegrado Anulada: Se equivocó de medida" {
		t.Fatalf("anulado: %q", s)
	}
	st, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas/"+pedido+"/anular", map[string]any{"motivo": "otra vez"})
	if st != 422 || fmt.Sprint(m["errores"]) != "map[error:Esa venta ya estaba anulada.]" {
		t.Fatalf("anular dos veces: %d %v", st, m)
	}
}

func TestVentaPartidaACuentaYMedia(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	// Media placa (descuenta 0,5), un tornillo suelto y pago partido:
	// transferencia + cuenta corriente.
	v := e.venta("transferencia",
		map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "unidad": "placa", "cantidad": 1, "precioUnitario": 23000, "presentacion": "media_largo"},
		map[string]any{"variantId": nil, "descripcion": "Flete", "unidad": "unidad", "cantidad": 1, "precioUnitario": 1000},
	)
	v["customerId"] = e.cliente
	v["contactoNombre"] = "Ana Gómez"
	v["pagos"] = []any{
		map[string]any{"medio": "transferencia", "importe": 4000},
		map[string]any{"medio": "cuenta_corriente", "importe": 20000},
	}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != true {
		t.Fatalf("venta: %d %s", st, b)
	}
	pedido := m["orderId"].(string)
	if q := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != 99.5 {
		t.Fatalf("media placa: %v", q)
	}
	if s := e.txt(t, `select medio_pago || ' ' || estado_pago from orders where id = $1`, pedido); s != "cuenta_corriente parcial" {
		t.Fatalf("pedido: %q", s)
	}
	if d := e.num(t, `select sum(monto)::float8 from account_movements where customer_id = $1`, e.cliente); d != 20000 {
		t.Fatalf("deuda: %v", d)
	}
	if p := e.txt(t, `select presentacion || ' ' || stock_por_unidad::text from order_items where order_id = $1 and variant_id is not null`, pedido); p != "media_largo 0.500000" {
		t.Fatalf("línea: %q", p)
	}
	// Los pagos que suman distinto del total, con el mensaje del TS.
	v2 := e.venta("debito", e.lineaPlaca(1))
	v2["pagos"] = []any{map[string]any{"medio": "debito", "importe": 100}}
	_, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v2)
	if m["error"] != "Los pagos suman 100.00 y la venta es de 45000.50." {
		t.Fatalf("pagos: %v", m)
	}
	// El profesional no paga con crédito.
	v3 := e.venta("credito", e.lineaPlaca(1))
	v3["customerId"] = e.mayor
	_, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v3)
	if !strings.HasPrefix(fmt.Sprint(m["error"]), "Este cliente tiene precio de profesional") {
		t.Fatalf("profesional: %v", m)
	}
	// Anular la venta a cuenta: la deuda se cancela con una nota de crédito.
	if st, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas/"+pedido+"/anular", map[string]any{"motivo": "No la quiso"}); st != 200 {
		t.Fatalf("anular: %d %v", st, m)
	}
	if d := e.num(t, `select sum(monto)::float8 from account_movements where customer_id = $1`, e.cliente); d != 0 {
		t.Fatalf("deuda tras anular: %v", d)
	}
	if q := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != 100 {
		t.Fatalf("stock tras anular: %v", q)
	}
}

// Veinte ventas a la vez contra el mismo candado de la serie y el mismo
// stock: números sin huecos ni repetidos, y el stock baja exactamente.
func TestVentasSimultaneasNumeranSinHuecos(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000)
	var wg sync.WaitGroup
	numeros := make([]string, 20)
	fallas := make([]string, 20)
	ventas := make([]map[string]any, 20)
	for i := range ventas {
		ventas[i] = e.venta("efectivo", e.lineaPlaca(1), map[string]any{"variantId": e.tornillo, "descripcion": "Tornillo", "unidad": "unidad", "cantidad": 3, "precioUnitario": 150})
	}
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", ventas[i])
			if st != 200 || m["ok"] != true {
				fallas[i] = b
				return
			}
			numeros[i] = m["numero"].(string)
		}(i)
	}
	wg.Wait()
	for _, f := range fallas {
		if f != "" {
			t.Fatalf("una venta falló: %s", f)
		}
	}
	sort.Strings(numeros)
	for i, n := range numeros {
		if n != fmt.Sprintf("PED-%d", 1000+i) {
			t.Fatalf("numeración: %v", numeros)
		}
	}
	if q := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != 80 {
		t.Fatalf("stock de placas: %v", q)
	}
	if q := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.tornillo, e.central); q != 940 {
		t.Fatalf("stock de tornillos: %v", q)
	}
	if n := e.num(t, `select count(*)::float8 from cash_movements where tipo = 'venta'`); n != 20 {
		t.Fatalf("movimientos de caja: %v", n)
	}
}

// La misma venta tocada veinte veces a la vez (la doble mano): una sola.
func TestMismaClaveVeinteVecesEsUnaVenta(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 0)
	v := e.venta("efectivo", e.lineaPlaca(2))
	var wg sync.WaitGroup
	ids := make([]string, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
			ids[i], _ = m["orderId"].(string)
		}(i)
	}
	wg.Wait()
	for _, id := range ids {
		if id == "" || id != ids[0] {
			t.Fatalf("ventas distintas: %v", ids)
		}
	}
	if n := e.num(t, `select count(*)::float8 from orders`); n != 1 {
		t.Fatalf("pedidos: %v", n)
	}
	if q := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != 98 {
		t.Fatalf("stock: %v", q)
	}
}

// La venta toma el candado del stock: una corrección de la ficha (que lee el
// físico y lo escribe entero, con el candado, como internal/productos) no
// le pisa el descuento. Sin el candado en la venta, la venta se pierde.
func TestVentaContraFichaNoPierdeStock(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 0)
	ctx := context.Background()
	for ronda := 0; ronda < 5; ronda++ {
		inicial := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central)
		var wg sync.WaitGroup
		wg.Add(2)
		listo := make(chan struct{})
		go func() {
			defer wg.Done()
			tx, err := e.pool.Begin(ctx)
			if err != nil {
				t.Error(err)
				return
			}
			defer tx.Rollback(ctx)
			if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1::text || $2::text))`, e.placa, e.central); err != nil {
				t.Error(err)
				return
			}
			var q float64
			_ = tx.QueryRow(ctx, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central).Scan(&q)
			close(listo)
			time.Sleep(150 * time.Millisecond)
			// La ficha guarda lo que leyó (sin cambios de cantidad).
			if _, err := tx.Exec(ctx, `update inventory set qty = $3 where variant_id = $1 and branch_id = $2`, e.placa, e.central, q); err != nil {
				t.Error(err)
				return
			}
			_ = tx.Commit(ctx)
		}()
		go func() {
			defer wg.Done()
			<-listo
			if st, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", e.venta("efectivo", e.lineaPlaca(1))); st != 200 || m["ok"] != true {
				t.Errorf("venta: %d %v", st, m)
			}
		}()
		wg.Wait()
		if q := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != inicial-1 {
			t.Fatalf("ronda %d: la ficha pisó la venta: %v en vez de %v", ronda, q, inicial-1)
		}
	}
}

func TestCajaArqueoYMovimientos(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1500)
	_, m, _ := pedir(t, ven, "GET", e.u+"/api/v1/mostrador/pantalla?sucursal="+e.central, nil)
	turno := m["turno"].(map[string]any)
	sesion := turno["id"].(string)
	if turno["esperado"] != 1500.0 || turno["fondoBase"] != 1000.0 || m["listaGeneral"] != e.general {
		t.Fatalf("pantalla: %v", m)
	}
	mov := func(tipo string, monto float64, motivo string) (int, map[string]any) {
		st, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/movimiento", map[string]any{"sessionId": sesion, "tipo": tipo, "monto": monto, "motivo": motivo})
		return st, m
	}
	if st, m := mov("retiro", 600, "Proveedor"); st != 422 || fmt.Sprint(m["errores"]) != "map[error:Ese retiro deja el cajón sin el cambio de la base ($1000.00). Podés retirar hasta $500.00.]" {
		t.Fatalf("retiro de más: %d %v", st, m)
	}
	if st, m := mov("retiro", 500, "Proveedor"); st != 200 || m["ok"] != "Retiro registrado." {
		t.Fatalf("retiro: %d %v", st, m)
	}
	if st, m := mov("ingreso", 0, "x"); st != 422 || fmt.Sprint(m["errores"]) != "map[error:El monto tiene que ser mayor a cero.]" {
		t.Fatalf("monto cero: %d %v", st, m)
	}
	// Una caja física con ventas sin subir frena el cierre.
	if _, err := e.pool.Exec(context.Background(), `insert into pos_devices (codigo, branch_id, secreto, pendientes, ultima_vez_at) values ('CAJA1', $1, 's', 2, now())`, e.central); err != nil {
		t.Fatal(err)
	}
	cerrar := func(contado float64, notas string) (int, map[string]any) {
		st, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/cerrar", map[string]any{"sessionId": sesion, "contado": contado, "notas": notas})
		return st, m
	}
	if st, m := cerrar(1000, ""); st != 422 || !strings.Contains(fmt.Sprint(m["errores"]), "Hay ventas sin subir en CAJA1 (2).") {
		t.Fatalf("cierre con pendientes: %d %v", st, m)
	}
	if _, err := e.pool.Exec(context.Background(), `update pos_devices set pendientes = 0`); err != nil {
		t.Fatal(err)
	}
	if st, m := cerrar(900, ""); st != 422 || fmt.Sprint(m["errores"]) != "map[error:Hay un faltante de $100.00. Escribí qué pasó antes de cerrar: mañana nadie se va a acordar.]" {
		t.Fatalf("faltante sin nota: %d %v", st, m)
	}
	if st, m := cerrar(900, "Un billete falso"); st != 200 || m["ok"] != "Caja cerrada con un faltante de $100.00. Ojo: quedan $900.00 en el cajón y la base de cambio es $1000.00." {
		t.Fatalf("cierre: %d %v", st, m)
	}
	if st, m := cerrar(900, "otra"); st != 422 || fmt.Sprint(m["errores"]) != "map[error:Esa caja ya estaba cerrada.]" {
		t.Fatalf("cerrar dos veces: %d %v", st, m)
	}
}

// Abrir la caja veinte veces a la vez: un solo turno (el índice único).
func TestAbrirCajaSimultaneoUnSoloTurno(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	var wg sync.WaitGroup
	oks := make([]bool, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			st, _, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/abrir", map[string]any{"branchId": e.central, "fondoInicial": 1000})
			oks[i] = st == 200
		}(i)
	}
	wg.Wait()
	n := 0
	for _, o := range oks {
		if o {
			n++
		}
	}
	if n != 1 || e.num(t, `select count(*)::float8 from cash_sessions`) != 1 || e.num(t, `select count(*)::float8 from cash_movements`) != 1 {
		t.Fatalf("se abrieron %d turnos", n)
	}
}

func TestBuscadorYClientes(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	c := &http.Client{Jar: ven.Jar}
	req, _ := http.NewRequest("GET", e.u+"/api/v1/mostrador/buscar?q=fenolico&sucursal="+e.central, nil)
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var rs []ResultadoDeMostrador
	_ = json.NewDecoder(resp.Body).Decode(&rs)
	resp.Body.Close()
	if len(rs) != 1 || rs[0].Precio != 45000.5 || rs[0].Stock != 100 || rs[0].FormaDeVenta != "entera_o_media" || *rs[0].Categoria != "Placas" {
		t.Fatalf("búsqueda: %+v", rs)
	}
	// El profesional ve su lista.
	req, _ = http.NewRequest("GET", e.u+"/api/v1/mostrador/buscar?q=FEN&sucursal="+e.central+"&cliente="+e.mayor, nil)
	resp, _ = c.Do(req)
	_ = json.NewDecoder(resp.Body).Decode(&rs)
	resp.Body.Close()
	if len(rs) != 1 || rs[0].Precio != 40000 {
		t.Fatalf("lista del profesional: %+v", rs)
	}
	st, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/precios", map[string]any{"variantIds": []string{e.placa, e.tornillo}, "customerId": e.mayor})
	if st != 200 || m[e.placa] != 40000.0 || m[e.tornillo] != 150.0 {
		t.Fatalf("precios: %v", m)
	}
	// Alta rápida: el documento repetido ofrece la ficha que ya existe.
	st, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/clientes", map[string]any{"nombre": "Otra Ana", "documento": "20-12345678-6", "condicionIva": "consumidor_final"})
	if st != 200 || m["error"] != "Ese documento ya es de Ana Gómez." || m["existente"].(map[string]any)["id"] != e.cliente {
		t.Fatalf("alta repetida: %v", m)
	}
	st, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/clientes", map[string]any{"nombre": " J ", "documento": "", "condicionIva": "consumidor_final"})
	if m["error"] != "Poné el nombre o la razón social." {
		t.Fatalf("alta corta: %v", m)
	}
	st, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/clientes", map[string]any{"nombre": " Juan Paz ", "documento": "30-71234567-1", "condicionIva": "responsable_inscripto", "rubro": "carpintero"})
	if st != 200 || m["ok"] != true {
		t.Fatalf("alta: %v", m)
	}
	nuevo := m["cliente"].(map[string]any)
	if nuevo["razonSocial"] != "Juan Paz" || nuevo["cuit"] != "30712345671" {
		t.Fatalf("alta: %v", nuevo)
	}
	if tipo := e.txt(t, `select tipo::text from customers where id = $1`, nuevo["id"]); tipo != "profesional" {
		t.Fatalf("tipo: %s", tipo)
	}
	req, _ = http.NewRequest("GET", e.u+"/api/v1/mostrador/clientes?q=gomez", nil)
	resp, _ = c.Do(req)
	var cs []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&cs)
	resp.Body.Close()
	if len(cs) != 1 || cs[0]["id"] != e.cliente {
		t.Fatalf("clientes: %v", cs)
	}
	_, m, b := pedir(t, ven, "GET", e.u+"/api/v1/mostrador/clientes/no-es-uuid", nil)
	if b != "null\n" {
		t.Fatalf("cliente inexistente: %q %v", b, m)
	}
}

func TestPresupuestoYCobroDeCuenta(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/presupuestos", map[string]any{
		"branchId": e.central, "customerId": e.cliente, "contactoNombre": "Ana", "lineas": []any{e.lineaPlaca(3)},
	})
	if st != 200 || !strings.HasPrefix(fmt.Sprint(m["numero"]), "P-") {
		t.Fatalf("presupuesto: %d %s", st, b)
	}
	if s := e.txt(t, `select total::text || ' ' || origen || ' ' || estado from quotes where id = $1`, m["quoteId"]); s != "135001.50 mostrador enviado" {
		t.Fatalf("presupuesto: %q", s)
	}
	// Cobro en efectivo sin caja: no.
	partes := `[{"medio":"efectivo","importe":"5000"}]`
	st, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/clientes/"+e.cliente+"/cobro", map[string]any{"branchId": e.central, "partes": partes})
	if st != 422 || fmt.Sprint(m["errores"]) != "map[error:No hay caja abierta: abrila para cobrar en efectivo.]" {
		t.Fatalf("cobro sin caja: %d %v", st, m)
	}
	e.abrir(t, ven, e.central, 1000)
	st, m, b = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/clientes/"+e.cliente+"/cobro", map[string]any{"branchId": e.central, "partes": partes})
	if st != 200 || m["ok"] != "Recibo REC-0001 por $ 5.000." {
		t.Fatalf("cobro: %d %s", st, b)
	}
	if c := e.num(t, `select sum(monto)::float8 from cash_movements`); c != 6000 {
		t.Fatalf("caja: %v", c)
	}
	if n := e.num(t, `select count(*)::float8 from trabajos where tipo = 'recibo.aviso'`); n != 1 {
		t.Fatalf("aviso: %v", n)
	}
	_, m, _ = pedir(t, ven, "GET", e.u+"/api/v1/mostrador/clientes/"+e.cliente+"/saldo", nil)
	if m["saldo"] != -5000.0 {
		t.Fatalf("saldo: %v", m)
	}
}
