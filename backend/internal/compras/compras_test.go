package compras

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
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/comprasapi"
	"mjbj/internal/auth"
	"mjbj/internal/caja"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

type entorno struct {
	srv                 *httptest.Server
	pool                *pgxpool.Pool
	ses                 *auth.Servicio
	central, aserradero string
	placa, tornillo     string
	proveedor           string
	u                   string
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-compras-de-32-caracteres", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	comprasapi.HandlerWithOptions(
		comprasapi.NewStrictHandlerWithOptions(NuevaAPI(Nuevo(pool, silencio)),
			[]comprasapi.StrictMiddlewareFunc{plataforma.ConPedido[comprasapi.StrictHandlerFunc]},
			comprasapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		comprasapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := comprasapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := comprasapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	e := &entorno{srv: srv, pool: pool, ses: ses, u: srv.URL + "/api/v1/admin/"}
	q := func(sql string, args ...any) string {
		var id string
		if err := pool.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
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
	e.proveedor = q(`insert into suppliers (nombre, cuit, dias_pago) values ('Maderas del Sur', '30-12345678-9', 30) returning id`)
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

func (e *entorno) numero(t *testing.T, sql string, args ...any) float64 {
	t.Helper()
	var n float64
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (e *entorno) saldo(t *testing.T) float64 {
	return e.numero(t, `select coalesce(sum(monto), 0)::float8 from supplier_movements where supplier_id = $1`, e.proveedor)
}

func idDe(t *testing.T, b string) string {
	t.Helper()
	var r struct{ ID string }
	if err := json.Unmarshal([]byte(b), &r); err != nil || r.ID == "" {
		t.Fatalf("sin id: %s", b)
	}
	return r.ID
}

func TestProveedores(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")

	if c, b := pedir(t, adm, "POST", e.u+"proveedores", map[string]any{"nombre": "x", "condicionIva": "exento", "diasPago": 0}); c != 422 || !strings.Contains(b, "Poné el nombre del proveedor.") {
		t.Errorf("nombre corto: %d %s", c, b)
	}
	c, b := pedir(t, adm, "POST", e.u+"proveedores", map[string]any{"nombre": "  Herrajes Sur  ", "condicionIva": "monotributista", "diasPago": 15, "cuit": "  "})
	if c != 200 || !strings.Contains(b, "Proveedor creado.") {
		t.Fatalf("alta: %d %s", c, b)
	}
	id := idDe(t, b)
	if c, _ := pedir(t, ven, "POST", e.u+"proveedores", map[string]any{"nombre": "Otro", "condicionIva": "exento", "diasPago": 0}); c != 403 {
		t.Errorf("el vendedor no da de alta: %d", c)
	}
	// La cuenta: una factura sube la deuda, un pago la baja (el signo lo pone el tipo).
	pedir(t, adm, "POST", e.u+"proveedores/"+id+"/movimientos", map[string]any{"tipo": "factura", "monto": 1000, "referencia": "A-1"})
	if c, b := pedir(t, adm, "POST", e.u+"proveedores/"+id+"/movimientos", map[string]any{"tipo": "pago", "monto": 400}); c != 200 {
		t.Fatalf("pago: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"proveedores/"+id+"/movimientos", map[string]any{"tipo": "pago", "monto": -1}); c != 422 || !strings.Contains(b, "El monto tiene que ser mayor a cero.") {
		t.Errorf("monto negativo: %d %s", c, b)
	}
	_, b = pedir(t, ven, "GET", e.u+"proveedores/"+id, nil)
	var p Proveedor
	_ = json.Unmarshal([]byte(b), &p)
	if p.Nombre != "Herrajes Sur" || p.Cuit != nil || p.Saldo != 600 || len(p.Movimientos) != 2 || p.Movimientos[0].Saldo != 600 || p.Movimientos[1].Saldo != 1000 {
		t.Errorf("ficha: %s", b)
	}
	// Condiciones y convenios.
	if c, b := pedir(t, adm, "POST", e.u+"proveedores/"+id+"/condiciones", map[string]string{"modalidad": "echeq", "plazoDias": "30", "bonificacionPct": "5,5"}); c != 200 {
		t.Fatalf("condición: %d %s", c, b)
	}
	if _, b := pedir(t, ven, "GET", e.u+"proveedores/"+id+"/condiciones", nil); !strings.Contains(b, `"bonificacionPct":"5.50"`) {
		t.Errorf("condiciones: %s", b)
	}
	if c, _ := pedir(t, adm, "PUT", e.u+"proveedores/"+id+"/convenios", map[string]string{"convenios": "  5% pagando a 10 días  "}); c != 204 {
		t.Errorf("convenios: %d", c)
	}
	// El listado, con búsqueda sin tildes, y la baja.
	if _, b := pedir(t, ven, "GET", e.u+"proveedores?busqueda=herrajes", nil); !strings.Contains(b, `"saldo":600`) || strings.Contains(b, "Maderas del Sur") {
		t.Errorf("listado: %s", b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"proveedores/"+id+"/baja", nil); c != 200 || !strings.Contains(b, "Herrajes Sur quedó inactivo.") {
		t.Errorf("baja: %d %s", c, b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/proveedores-activos", nil); strings.Contains(b, "Herrajes") {
		t.Errorf("el inactivo no se elige: %s", b)
	}
}

// El circuito entero: orden, recepción contra la orden, confirmación (stock,
// costo y deuda) y anulación.
func TestOrdenYRecepcion(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	linea := map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": 10, "costoUnitario": 100, "alicuotaIva": 21}
	c, b := pedir(t, adm, "POST", e.u+"compras/ordenes", map[string]any{"supplierId": e.proveedor, "branchId": e.central, "lineas": []any{linea}})
	if c != 200 {
		t.Fatalf("orden: %d %s", c, b)
	}
	orden := idDe(t, b)
	if _, b := pedir(t, adm, "GET", e.u+"compras/ordenes/"+orden, nil); !strings.Contains(b, `"numero":"OC-1"`) || !strings.Contains(b, `"cantidad":"10.0000"`) {
		t.Errorf("orden: %s", b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/recibir", map[string]string{"numeroRemito": "R-1"}); c != 422 || !strings.Contains(b, "Marcá la orden como enviada") {
		t.Errorf("recibir un borrador: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/enviada", nil); c != 200 || !strings.Contains(b, "OC-1 quedó como enviada.") {
		t.Fatalf("enviar: %d %s", c, b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/por-llegar", nil); !strings.Contains(b, `"pendiente":"10.0000"`) {
		t.Errorf("por llegar: %s", b)
	}
	// Lo lee la grilla de stock, que también abren el depósito y el vendedor
	// (en el TS pedía el admin y la página los echaba).
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	if c, b := pedir(t, dep, "GET", e.u+"compras/por-llegar", nil); c != 200 || !strings.Contains(b, `"pendiente":"10.0000"`) {
		t.Errorf("por llegar, el depósito: %d %s", c, b)
	}
	if c, _ := pedir(t, dep, "GET", e.u+"compras/ordenes", nil); c != 403 {
		t.Errorf("las órdenes siguen siendo del admin: %d", c)
	}
	c, b = pedir(t, adm, "POST", e.u+"compras/ordenes/"+orden+"/recibir", map[string]string{"numeroRemito": " R-1 "})
	if c != 200 {
		t.Fatalf("recibir: %d %s", c, b)
	}
	recepcion := idDe(t, b)
	// Llegaron 6 de las 10, con $121 de flete.
	_, _ = e.pool.Exec(context.Background(), `update goods_receipt_items set cantidad = 6 where receipt_id = $1`, recepcion)
	_, _ = e.pool.Exec(context.Background(), `update goods_receipts set gastos = 121 where id = $1`, recepcion)
	c, b = pedir(t, adm, "POST", e.u+"recepciones/"+recepcion+"/confirmar", nil)
	if c != 200 || b != `{"lineas":1,"neto":721}`+"\n" {
		t.Fatalf("confirmar: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+recepcion+"/confirmar", nil); c != 422 || !strings.Contains(b, "ya estaba confirmada") {
		t.Errorf("confirmar dos veces: %d %s", c, b)
	}
	// 6 placas a (600 + 121) / 6 = 120,1667 cada una; la deuda, con IVA: 6 × 120,1667 × 1,21.
	if q := e.numero(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != 6 {
		t.Errorf("stock: %v", q)
	}
	if costo := e.numero(t, `select costo_promedio::float8 from variant_costs where variant_id = $1`, e.placa); costo != 120.1667 {
		t.Errorf("costo: %v", costo)
	}
	if s := e.saldo(t); s != 872.41 {
		t.Errorf("deuda: %v", s)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/ordenes", nil); !strings.Contains(b, `"estado":"parcial"`) || !strings.Contains(b, `"pendientes":1`) {
		t.Errorf("la orden quedó parcial: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"recepciones/"+recepcion, nil); !strings.Contains(b, `"costoConGastos":"120.1667"`) || !strings.Contains(b, `"costoResultante":"120.1667"`) {
		t.Errorf("la cuenta en la línea: %s", b)
	}
	// Anular: el stock vuelve, la deuda baja, el costo queda.
	if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+recepcion+"/anular", map[string]string{"motivo": " "}); c != 422 || !strings.Contains(b, "Poné el motivo") {
		t.Errorf("sin motivo: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+recepcion+"/anular", map[string]string{"motivo": "Vino húmeda"}); c != 204 {
		t.Fatalf("anular: %d %s", c, b)
	}
	if q := e.numero(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != 0 {
		t.Errorf("stock después de anular: %v", q)
	}
	if s := e.saldo(t); s != 0 {
		t.Errorf("deuda después de anular: %v", s)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/ordenes", nil); !strings.Contains(b, `"estado":"enviada"`) {
		t.Errorf("la orden vuelve a enviada: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"recepciones", nil); !strings.Contains(b, `"estado":"anulada"`) || !strings.Contains(b, `"neto":721`) {
		t.Errorf("listado: %s", b)
	}
}

// Bug del TS: la nota de crédito de la anulación se buscaba por el remito; sin
// remito no encontraba la factura y la deuda quedaba cargada.
func TestAnularSinRemitoDevuelveLaDeuda(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	c, b := pedir(t, adm, "POST", e.u+"recepciones", map[string]any{"supplierId": e.proveedor, "branchId": e.central,
		"lineas": []any{map[string]any{"variantId": e.tornillo, "cantidad": 100, "costoUnitario": 10, "alicuotaIva": 21}}})
	if c != 200 {
		t.Fatalf("crear: %d %s", c, b)
	}
	id := idDe(t, b)
	pedir(t, adm, "POST", e.u+"recepciones/"+id+"/confirmar", nil)
	if s := e.saldo(t); s != 1210 {
		t.Fatalf("deuda: %v", s)
	}
	pedir(t, adm, "POST", e.u+"recepciones/"+id+"/anular", map[string]string{"motivo": "Error de carga"})
	if s := e.saldo(t); s != 0 {
		t.Errorf("la deuda tiene que volver a cero y quedó en %v", s)
	}
}

// Bug del TS: el costo es por variante y el candado era por variante y
// sucursal. Dos recepciones de la misma variante en sucursales distintas
// leían el mismo costo previo y la segunda pisaba la mezcla de la primera.
func TestRecepcionesSimultaneasNoPierdenLaMezcla(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	_, _ = e.pool.Exec(ctx, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 10, 100)`, e.placa)
	crear := func(sucursal string, costo float64) string {
		_, b := pedir(t, adm, "POST", e.u+"recepciones", map[string]any{"supplierId": e.proveedor, "branchId": sucursal,
			"lineas": []any{map[string]any{"variantId": e.placa, "cantidad": 10, "costoUnitario": costo, "alicuotaIva": 21}}})
		return idDe(t, b)
	}
	a, b := crear(e.central, 200), crear(e.aserradero, 400)

	// Cada una, después de leer el costo previo, espera a que la otra lo lea
	// también (o a que pase un rato, si la otra está esperando el candado).
	var leyeron sync.WaitGroup
	leyeron.Add(2)
	var mu sync.Mutex
	vistas := 0
	antesDeMezclar = func(string) {
		mu.Lock()
		vistas++
		mu.Unlock()
		leyeron.Done()
		listo := make(chan struct{})
		go func() { leyeron.Wait(); close(listo) }()
		select {
		case <-listo:
		case <-time.After(500 * time.Millisecond):
		}
	}
	defer func() { antesDeMezclar = func(string) {} }()
	var wg sync.WaitGroup
	for _, id := range []string{a, b} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+id+"/confirmar", nil); c != 200 {
				t.Errorf("confirmar: %d %s", c, b)
			}
		}()
	}
	wg.Wait()
	// 10 a 100 + 10 a 200 + 10 a 400: 30 unidades a 233,3333.
	base := e.numero(t, `select cantidad_base::float8 from variant_costs where variant_id = $1`, e.placa)
	costo := e.numero(t, `select costo_promedio::float8 from variant_costs where variant_id = $1`, e.placa)
	if base != 30 || costo != 233.3333 {
		t.Errorf("se perdió una mezcla: %v unidades a %v", base, costo)
	}
}

func (e *entorno) regimen(t *testing.T, codigo, impuesto string, alicuota float64) string {
	t.Helper()
	var id string
	if err := e.pool.QueryRow(context.Background(), `insert into regimenes_retencion (codigo, nombre, impuesto, alicuota, alicuota_no_inscripto)
		values ($1, $1, $2, $3, $4) returning id`, codigo, impuesto, alicuota, alicuota*2).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestPagoConRetencionesYCheques(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	iibb := e.regimen(t, "IIBB-MI", "iibb", 1.5)
	// Una factura de $1000 y un cheque en cartera de $500.
	c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 1274,
		"fechaEmision": "2026-10-01", "neto": 826.45, "iva21": 173.55, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0})
	if c != 200 {
		t.Fatalf("factura: %d %s", c, b)
	}
	factura := idDe(t, b)
	if c, b := pedir(t, adm, "POST", e.u+"compras/facturas", map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": 1274,
		"fechaEmision": "2026-10-01", "neto": 1, "iva21": 0, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0}); c != 422 || !strings.Contains(b, "ya está cargado") {
		t.Errorf("factura repetida: %d %s", c, b)
	}
	var cheque string
	_ = e.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado) values ('recibido', 'fisico', '12345678', now(), 500, 'cartera') returning id`).Scan(&cheque)
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); !strings.Contains(b, `"numero":"0003-00001274"`) || !strings.Contains(b, `"saldo":1000`) {
		t.Errorf("facturas con saldo: %s", b)
	}
	// Paga $1000: retiene 1,5 % ($15) y salen $985 en un endoso de $500 y $485 por transferencia.
	pago := map[string]any{"supplierId": e.proveedor, "total": 1000, "medio": "transferencia", "referencia": "TR-9",
		"retenciones":  []any{map[string]any{"regimenId": iibb, "base": 1000}},
		"imputaciones": []any{map[string]any{"purchaseInvoiceId": factura, "importe": 1000}},
		"partes": []any{map[string]any{"medio": "cheque", "importe": 500, "chequeId": cheque, "cheque": nil},
			map[string]any{"medio": "transferencia", "importe": 485}}}
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", pago)
	if c != 200 || !strings.Contains(b, "Pago registrado. Salieron $ 985 y se retuvieron $ 15.") || !strings.Contains(b, `"numero":"IIB-`+fmt.Sprint(time.Now().UTC().Year())+`-000001"`) {
		t.Fatalf("pago: %d %s", c, b)
	}
	if s := e.saldo(t); s != 0 {
		t.Errorf("la factura de 1000 y el pago de 1000 dejan la cuenta en cero: %v", s)
	}
	var estado string
	_ = e.pool.QueryRow(ctx, `select estado::text from cheques where id = $1`, cheque).Scan(&estado)
	if estado != "entregado" {
		t.Errorf("el cheque endosado: %s", estado)
	}
	// La misma factura ya no tiene saldo; el mismo cheque ya no está en cartera.
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", pago)
	if c != 422 || !strings.Contains(b, "A la factura 1274 le quedan $0.00 y se le están imputando $1000.00.") {
		t.Errorf("imputar dos veces: %d %s", c, b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/pagos", nil); !strings.Contains(b, `"retenido":15`) || !strings.Contains(b, `"numero":"3-1274"`) {
		t.Errorf("pagos: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/acumulado-del-mes", nil); !strings.Contains(b, `"retenido":"15.00"`) {
		t.Errorf("acumulado: %s", b)
	}
	numero := fmt.Sprintf("IIB-%d-000001", time.Now().UTC().Year())
	if _, b := pedir(t, adm, "GET", e.u+"compras/certificados/"+numero, nil); !strings.Contains(b, `"importe":"15.00"`) || !strings.Contains(b, `"pagoReferencia":"TR-9"`) {
		t.Errorf("certificado: %s", b)
	}
	if c, b := pedir(t, adm, "GET", e.u+"compras/pagos/retenciones-csv", nil); c != 200 || !strings.Contains(b, `"`+numero+`";"iibb";"IIBB-MI"`) || !strings.Contains(b, "1000,00;1,500;15,00") {
		t.Errorf("csv: %d %s", c, b)
	}
	// E-Cheq por el circuito B: no.
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 100, "medio": "echeq", "circuito": "negro", "retenciones": []any{},
		"partes": []any{map[string]any{"medio": "echeq", "importe": 100, "cheque": map[string]any{"tipo": "echeq", "numero": "0012-3456", "fechaPago": "2026-11-15T12:00:00.000Z"}}}})
	if c != 422 || !strings.Contains(b, "Un e-Cheq no puede salir por el circuito B") {
		t.Errorf("echeq en negro: %d %s", c, b)
	}
	// Un cheque propio: nace entregado, con el número normalizado.
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 100, "medio": "cheque", "retenciones": []any{},
		"partes": []any{map[string]any{"medio": "cheque", "importe": 100, "cheque": map[string]any{"tipo": "fisico", "numero": "0012-3456", "banco": "Nación", "fechaPago": "2026-11-15T12:00:00.000Z"}}}})
	if c != 200 || !strings.Contains(b, "Pago registrado por $ 100.") {
		t.Errorf("cheque propio: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from cheques where sentido = 'entregado' and numero = '00123456' and notas = 'Pago a Maderas del Sur'`); n != 1 {
		t.Errorf("el cheque propio: %v", n)
	}
	// Las partes tienen que sumar el neto.
	c, b = pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 100, "medio": "transferencia", "retenciones": []any{},
		"partes": []any{map[string]any{"medio": "transferencia", "importe": 90}}})
	if c != 422 || !strings.Contains(b, "Las partes del pago suman $90.00 y el neto a pagar es $100.00.") {
		t.Errorf("partes: %d %s", c, b)
	}
	// Y el libro IVA compras con la factura.
	if _, b := pedir(t, adm, "GET", e.u+"compras/libro-iva?desde=2026-10-01T00:00:00Z&hasta=2026-10-31T23:59:59.999Z", nil); !strings.Contains(b, `"iva21":173.55`) {
		t.Errorf("libro: %s", b)
	}
	if c, b := pedir(t, adm, "GET", e.u+"compras/libro-iva/csv?periodo=2026-10", nil); c != 200 || !strings.Contains(b, `01/10/2026;"Factura A";"0003-00001274"`) || !strings.Contains(b, `"Computable: 173,55"`) {
		t.Errorf("libro csv: %d %s", c, b)
	}
}

// Bug del TS: los pagos no tomaban candado. Dos pagos con retención a la vez
// sacaban el mismo número de certificado y el segundo abortaba.
func TestPagosSimultaneosNumeranSinRepetir(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	iibb := e.regimen(t, "IIBB-MI", "iibb", 1.5)
	var leyeron sync.WaitGroup
	const n = 4
	leyeron.Add(n)
	antesDeNumerar = func() {
		leyeron.Done()
		listo := make(chan struct{})
		go func() { leyeron.Wait(); close(listo) }()
		select {
		case <-listo:
		case <-time.After(300 * time.Millisecond):
		}
	}
	defer func() { antesDeNumerar = func() {} }()
	var wg sync.WaitGroup
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 1000, "medio": "transferencia",
				"retenciones": []any{map[string]any{"regimenId": iibb, "base": 1000}}}); c != 200 {
				t.Errorf("pago: %d %s", c, b)
			}
		}()
	}
	wg.Wait()
	if c := e.numero(t, `select count(distinct numero)::float8 from retenciones_practicadas`); c != n {
		t.Errorf("certificados distintos: %v de %d", c, n)
	}
}

func TestGastos(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	var usuario string
	_ = e.pool.QueryRow(ctx, `select id from "user" limit 1`).Scan(&usuario)
	_, _ = e.pool.Exec(ctx, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, '2026-10-01T08:00:00Z')`, e.central, usuario)
	gasto := map[string]any{"fecha": "2026-10-02", "categoria": "flete", "descripcion": "  Flete a obra ", "importe": 1500, "medio": "efectivo", "branchId": e.central}
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 200 || b != `{"ok":"Gasto anotado por $`+" "+`1.500."}`+"\n" {
		t.Fatalf("gasto: %d %s", c, b)
	}
	if m := e.numero(t, `select monto::float8 from cash_movements where tipo = 'gasto'`); m != -1500 {
		t.Errorf("salió de la caja: %v", m)
	}
	// En el aserradero no hay turno: se anota igual y avisa.
	gasto["branchId"] = e.aserradero
	if _, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); !strings.Contains(b, "No había caja abierta") {
		t.Errorf("sin turno: %s", b)
	}
	q := "?desde=2026-10-01T00:00:00Z&hasta=2026-10-31T23:59:59.999Z"
	if _, b := pedir(t, adm, "GET", e.u+"compras/gastos"+q, nil); !strings.Contains(b, `"enCaja":true`) || !strings.Contains(b, `"descripcion":"Flete a obra"`) {
		t.Errorf("listado: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/gastos/por-categoria"+q, nil); !strings.Contains(b, `{"clave":"flete","cantidad":2,"total":"3000.00"}`) {
		t.Errorf("por categoría: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/gastos/sucursales", nil); !strings.Contains(b, `"turnoAbierto":"`) {
		t.Errorf("sucursales: %s", b)
	}
}

// Bug: el turno se buscaba con la fecha del formulario (medianoche UTC, las
// 21 del día anterior en Argentina): un gasto en efectivo de hoy no caía en
// el turno abierto a la mañana y no salía de la caja.
func TestGastoDeHoySaleDelTurnoAbierto(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	var usuario string
	_ = e.pool.QueryRow(ctx, `select id from "user" limit 1`).Scan(&usuario)
	_, _ = e.pool.Exec(ctx, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, now() - interval '1 minute')`, e.central, usuario)
	hoy := time.Now().In(caja.Argentina).Format("2006-01-02")
	gasto := map[string]any{"fecha": hoy, "categoria": "flete", "descripcion": "Flete", "importe": 800, "medio": "efectivo", "branchId": e.central}
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 200 || strings.Contains(b, "No había caja abierta") {
		t.Fatalf("gasto de hoy: %d %s", c, b)
	}
	if m := e.numero(t, `select coalesce(sum(monto), 0)::float8 from cash_movements where tipo = 'gasto'`); m != -800 {
		t.Errorf("el gasto de hoy tiene que salir del turno abierto: %v", m)
	}
}

func multipartDe(t *testing.T, archivo string, campos map[string]string) (*bytes.Buffer, string) {
	t.Helper()
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	for k, v := range campos {
		_ = w.WriteField(k, v)
	}
	f, _ := w.CreateFormFile("archivo", "lista.csv")
	_, _ = f.Write([]byte(archivo))
	_ = w.Close()
	return &b, w.FormDataContentType()
}

func TestListaDeProveedor(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	ctx := context.Background()
	var lista string
	_ = e.pool.QueryRow(ctx, `insert into price_lists (slug, name, is_default) values ('general', 'General', true) returning id`).Scan(&lista)
	_, _ = e.pool.Exec(ctx, `insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 1000)`, lista, e.placa)
	perfil := map[string]string{"supplierId": e.proveedor, "columnaCodigo": "Código", "columnaPrecio": "Precio", "precioEsNeto": "on", "margenPorcentaje": "30"}
	cuerpo, tipo := multipartDe(t, "Código;Precio;Detalle\nFEN18;1.000,00;Placa\nXX-9;50;Otra\nFEN18;2;Repetida\n", perfil)
	req, _ := http.NewRequest("POST", e.u+"compras/lista-proveedor/vista-previa", cuerpo)
	req.Header.Set("Content-Type", tipo)
	resp, err := adm.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var v VistaPreviaProveedor
	_ = json.NewDecoder(resp.Body).Decode(&v)
	resp.Body.Close()
	// 1000 neto → 1210 final → 1573 con el 30 %.
	if v.Apareadas != 1 || v.SinAparear != 1 || len(v.Problemas) != 1 || v.Filas[0].Costo != 1210 || v.Filas[0].PrecioSugerido != 1573 ||
		v.Filas[0].PrecioActual == nil || *v.Filas[0].PrecioActual != 1000 {
		t.Fatalf("vista previa: %+v", v)
	}
	aplicar := map[string]string{}
	for k, x := range perfil {
		aplicar[k] = x
	}
	aplicar["filas"] = fmt.Sprintf(`[{"codigo":"FEN18","variantId":%q,"costo":1210,"precioSugerido":1573}]`, e.placa)
	if c, _ := pedir(t, ven, "POST", e.u+"compras/lista-proveedor/aplicar", aplicar); c != 403 {
		t.Errorf("el vendedor no aplica precios: %d", c)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/lista-proveedor/aplicar", aplicar); c != 200 || !strings.Contains(b, "Listo: 1 precios actualizados.") {
		t.Fatalf("aplicar: %d %s", c, b)
	}
	if p := e.numero(t, `select price::float8 from price_list_items where variant_id = $1`, e.placa); p != 1573 {
		t.Errorf("precio: %v", p)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/perfil-lista", nil); !strings.Contains(b, `"margenPorcentaje":"30.00"`) {
		t.Errorf("perfil: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.tornillo+"/perfil-lista", nil); b != "null\n" {
		t.Errorf("sin perfil: %s", b)
	}
}

// Con la base vacía, todo lo que es lista sale [] y no null.
func TestListasVacias(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	q := "?desde=2026-10-01T00:00:00Z&hasta=2026-10-31T23:59:59.999Z"
	for _, ruta := range []string{"compras/ordenes", "recepciones", "compras/facturas", "compras/pagos", "compras/regimenes", "compras/regimenes?todos=true",
		"compras/retenciones-sufridas", "compras/retenciones-sufridas/credito" + q, "compras/gastos" + q, "compras/gastos/por-categoria" + q,
		"compras/gastos/por-circuito" + q, "compras/por-llegar", "compras/mercaderia?texto=zz", "compras/mercaderia?ids=",
		"proveedores/" + e.proveedor + "/condiciones", "proveedores/" + e.proveedor + "/facturas-con-saldo", "proveedores/" + e.proveedor + "/acumulado-del-mes"} {
		if c, b := pedir(t, adm, "GET", e.u+ruta, nil); c != 200 || b != "[]\n" {
			t.Errorf("%s: %d %s", ruta, c, b)
		}
	}
}

// RG 830: el acumulado del mes suma todos los pagos, también los que no
// retuvieron. Dos pagos de 200.000 con mínimo no sujeto de 224.000: el
// primero no retiene y el segundo retiene (400.000 − 224.000) × 2 % = 3.520.
// Antes el primero no quedaba en ningún lado y el segundo tampoco retenía.
func TestAcumuladoSumaLosPagosQueNoRetuvieron(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	gan := e.regimen(t, "78", "ganancias", 2)
	if _, err := e.pool.Exec(ctx, `update regimenes_retencion set minimo_no_imponible = 224000, minimo_retencion = 0 where id = $1`, gan); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `update suppliers set cuit = '30712345679' where id = $1`, e.proveedor); err != nil {
		t.Fatal(err)
	}
	pago := func() map[string]any {
		return map[string]any{"supplierId": e.proveedor, "total": 200000, "medio": "transferencia",
			"retenciones": []any{map[string]any{"regimenId": gan, "base": 200000}},
			"partes":      []any{map[string]any{"medio": "transferencia", "importe": 200000}}}
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos", pago()); c != 200 || strings.Contains(b, "retuvieron") {
		t.Fatalf("primer pago: %d %s", c, b)
	}
	p := pago()
	p["partes"] = []any{map[string]any{"medio": "transferencia", "importe": 196480}}
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos", p); c != 200 || !strings.Contains(b, `"importe":3520`) {
		t.Fatalf("segundo pago: %d %s", c, b)
	}
	// Un régimen apagado no retiene aunque la API lo reciba.
	if _, err := e.pool.Exec(ctx, `update regimenes_retencion set activo = false where id = $1`, gan); err != nil {
		t.Fatal(err)
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/pagos", pago()); c != 422 || !strings.Contains(b, "está apagado") {
		t.Errorf("régimen apagado: %d %s", c, b)
	}
}

// Bug: la recepción cargaba la deuda y la factura de esa misma mercadería la
// volvía a cargar. Una orden de $1.210 recibida y facturada dejaba $2.420.
// Ahora la factura se vincula a la recepción y carga solo la diferencia.
func TestFacturaDeUnaRecepcionNoDuplicaLaDeuda(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	recibir := func(remito string) string {
		c, b := pedir(t, adm, "POST", e.u+"recepciones", map[string]any{"supplierId": e.proveedor, "branchId": e.central, "numeroRemito": remito,
			"lineas": []any{map[string]any{"variantId": e.tornillo, "cantidad": 100, "costoUnitario": 10, "alicuotaIva": 21}}})
		if c != 200 {
			t.Fatalf("crear: %d %s", c, b)
		}
		id := idDe(t, b)
		if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+id+"/confirmar", nil); c != 200 {
			t.Fatalf("confirmar: %d %s", c, b)
		}
		return id
	}
	factura := func(numero int, neto, iva float64, recepcion string) (int, string) {
		f := map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3, "numero": numero, "fechaEmision": "2026-10-20",
			"neto": neto, "iva21": iva, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0}
		if recepcion != "" {
			f["receiptId"] = recepcion
		}
		return pedir(t, adm, "POST", e.u+"compras/facturas", f)
	}
	r1 := recibir("R-1")
	if s := e.saldo(t); s != 1210 {
		t.Fatalf("deuda de la recepción: %v", s)
	}
	if c, b := factura(1, 1000, 210, r1); c != 200 {
		t.Fatalf("factura: %d %s", c, b)
	}
	if s := e.saldo(t); s != 1210 {
		t.Errorf("la factura de la misma mercadería no suma deuda: quedó %v", s)
	}
	if n := e.numero(t, `select count(*)::float8 from purchase_invoices where receipt_id = $1`, r1); n != 1 {
		t.Errorf("la factura queda vinculada a la recepción: %v", n)
	}
	// Una recepción la cubre una sola factura.
	if c, b := factura(2, 1000, 210, r1); c != 422 || !strings.Contains(b, "ya tiene una factura") {
		t.Errorf("dos facturas para una recepción: %d %s", c, b)
	}
	// Si la factura viene por más (un flete que no estaba en el remito), sube
	// solo la diferencia.
	r2 := recibir("R-2")
	if c, b := factura(3, 1100, 231, r2); c != 200 {
		t.Fatalf("factura con diferencia: %d %s", c, b)
	}
	if s := e.saldo(t); s != 1210+1331 {
		t.Errorf("con diferencia: %v", s)
	}
	// Anular una recepción ya facturada saca el stock pero no toca la deuda:
	// la deuda ya es de la factura, y la devuelve la nota de crédito del proveedor.
	pedir(t, adm, "POST", e.u+"recepciones/"+r2+"/anular", map[string]string{"motivo": "Devolución"})
	if s := e.saldo(t); s != 1210+1331 {
		t.Errorf("anular una recepción facturada: %v", s)
	}
	// Sin recepción, la factura carga el total, como siempre.
	if c, b := factura(4, 100, 21, ""); c != 200 {
		t.Fatalf("factura suelta: %d %s", c, b)
	}
	if s := e.saldo(t); s != 1210+1331+121 {
		t.Errorf("factura suelta: %v", s)
	}
}
