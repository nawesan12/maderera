package cuentas

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

	"mjbj/internal/api/cuentasapi"
	"mjbj/internal/auth"
	"mjbj/internal/clientes"
	"mjbj/internal/cobros"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

const secretoInterno = "secreto-interno-de-prueba"

type entorno struct {
	srv  *httptest.Server
	pool *pgxpool.Pool
	ses  *auth.Servicio
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-cuentas-de-32-caracteres", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	cuentasapi.HandlerWithOptions(
		cuentasapi.NewStrictHandlerWithOptions(NuevaAPI(pool, clientes.Nuevo(pool, silencio), cobros.Nuevo(pool, silencio), plataforma.ConfigInterna{Secreto: secretoInterno}),
			[]cuentasapi.StrictMiddlewareFunc{plataforma.ConPedido[cuentasapi.StrictHandlerFunc]},
			cuentasapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		cuentasapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := cuentasapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := cuentasapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	return &entorno{srv: srv, pool: pool, ses: ses}
}

func (e *entorno) cliente(t *testing.T, cookies []*http.Cookie) *http.Client {
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u.URL, cookies)
	return &http.Client{Jar: jar}
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
	return e.cliente(t, w.Result().Cookies())
}

func (e *entorno) web(t *testing.T, correo string) (*http.Client, string) {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeCliente(ctx, correo, "una clave larga", "Cliente Web"); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	ses, err := e.ses.Entrar(ctx, w, correo, "una clave larga", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	var id string
	if err := e.pool.QueryRow(ctx, `select id from customers where user_id = $1`, ses.UserID).Scan(&id); err != nil {
		t.Fatalf("la cuenta web no tiene ficha: %v", err)
	}
	return e.cliente(t, w.Result().Cookies()), id
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

func TestCarteraCobroYRecibo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	u := e.srv.URL + "/api/v1/admin/"

	// Alta con el límite en formato argentino.
	if c, b := pedir(t, ven, "POST", u+"clientes", map[string]string{"nombre": "Carpintería Sur", "cuit": "30-58944525-9",
		"limiteCredito": "1.500.000", "condicionIva": "responsable_inscripto"}); c != 200 || !strings.Contains(b, "Cliente creado.") {
		t.Fatalf("alta: %d %s", c, b)
	}
	// El mismo CUIT, sin guiones: es de la otra ficha.
	if c, b := pedir(t, ven, "POST", u+"clientes", map[string]string{"nombre": "Otro", "cuit": "30589445259"}); c != 422 ||
		!strings.Contains(b, "Ese CUIT ya es de Carpintería Sur.") {
		t.Errorf("CUIT repetido: %d %s", c, b)
	}
	var id string
	_ = e.pool.QueryRow(context.Background(), `select id from customers where nombre = 'Carpintería Sur'`).Scan(&id)

	// El movimiento a mano es del admin.
	if c, _ := pedir(t, ven, "POST", u+"clientes/"+id+"/movimientos", map[string]string{"tipo": "compra", "monto": "300.000"}); c != 403 {
		t.Errorf("movimiento del vendedor: %d", c)
	}
	if c, b := pedir(t, adm, "POST", u+"clientes/"+id+"/movimientos", map[string]string{"tipo": "compra", "monto": "300.000"}); c != 200 {
		t.Fatalf("movimiento: %d %s", c, b)
	}

	_, b := pedir(t, ven, "GET", u+"clientes?busqueda=carpinteria", nil)
	var lista []clientes.ClienteListado
	_ = json.Unmarshal([]byte(b), &lista)
	if len(lista) != 1 || lista[0].Saldo != 300000 || lista[0].LimiteCredito != 1500000 || lista[0].Deuda == nil {
		t.Fatalf("listado: %s", b)
	}

	// Cobrar con un cheque y una transferencia.
	partes := `[{"medio":"cheque","importe":"200.000","cheque":{"numero":"00123456","banco":"Nación","fechaPago":"2026-11-15"}},{"medio":"transferencia","importe":"100000"}]`
	c, b := pedir(t, ven, "POST", u+"clientes/"+id+"/cobros", map[string]string{"partes": partes})
	if c != 200 || !strings.Contains(b, "REC-0001") {
		t.Fatalf("cobro: %d %s", c, b)
	}
	var cobro struct{ ReceiptID string }
	_ = json.Unmarshal([]byte(b), &cobro)
	var avisos int
	_ = e.pool.QueryRow(context.Background(), `select count(*) from trabajos where tipo = 'recibo.aviso'`).Scan(&avisos)
	if avisos != 1 {
		t.Errorf("avisos encolados: %d", avisos)
	}

	// El recibo: el personal sí, sin sesión no, con el secreto interno sí.
	if c, b := pedir(t, ven, "GET", e.srv.URL+"/api/v1/recibos/"+cobro.ReceiptID, nil); c != 200 || !strings.Contains(b, `"saldoDespues":0`) {
		t.Errorf("recibo: %d %s", c, b)
	}
	if c, _ := pedir(t, http.DefaultClient, "GET", e.srv.URL+"/api/v1/recibos/"+cobro.ReceiptID, nil); c != 401 {
		t.Errorf("recibo sin sesión: %d", c)
	}
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/v1/admin/clientes/"+id+"/resumen", nil)
	req.Header.Set("Authorization", "Bearer "+secretoInterno)
	if r, err := http.DefaultClient.Do(req); err != nil || r.StatusCode != 200 {
		t.Errorf("resumen con el secreto: %v %v", r.StatusCode, err)
	}

	// Los PDF: el personal los baja; un cliente ajeno ve 404.
	if c, b := pedir(t, ven, "GET", e.srv.URL+"/api/v1/recibos/"+cobro.ReceiptID+"/pdf", nil); c != 200 || !strings.HasPrefix(b, "%PDF") {
		t.Errorf("recibo en PDF: %d %.40s", c, b)
	}
	if c, b := pedir(t, ven, "GET", e.srv.URL+"/api/v1/cuentas/"+id+"/pdf", nil); c != 200 || !strings.HasPrefix(b, "%PDF") {
		t.Errorf("resumen en PDF: %d %.40s", c, b)
	}
	otro, _ := e.web(t, "ajeno@prueba.test")
	if c, _ := pedir(t, otro, "GET", e.srv.URL+"/api/v1/recibos/"+cobro.ReceiptID+"/pdf", nil); c != 404 {
		t.Errorf("recibo ajeno en PDF: %d", c)
	}
	if c, _ := pedir(t, otro, "GET", e.srv.URL+"/api/v1/cuentas/"+id+"/pdf", nil); c != 404 {
		t.Errorf("resumen ajeno en PDF: %d", c)
	}

	// El historial muestra el pago con sus medios.
	_, b = pedir(t, ven, "GET", u+"clientes/"+id+"/historial?filtro=pagos", nil)
	if !strings.Contains(b, `Cheque Nación N° 00123456 $ 200.000 · Transferencia $ 100.000`) && !strings.Contains(b, "Cheque Nación N° 00123456 $ 200.000 · Transferencia $ 100.000") {
		t.Errorf("historial: %s", b)
	}

	// Cheques: el de la cartera, y anular (solo el admin) lo anula.
	// La cartera la usa el pago a proveedores (/admin/compras/pagos), y el
	// listado de cheques es de /admin/cheques: los dos, solo del admin.
	if _, b := pedir(t, adm, "GET", u+"cheques/cartera", nil); !strings.Contains(b, "00123456") {
		t.Errorf("cartera: %s", b)
	}
	if c, _ := pedir(t, ven, "GET", u+"cheques/cartera", nil); c != 403 {
		t.Errorf("cartera, el vendedor: %d", c)
	}
	if c, _ := pedir(t, ven, "POST", u+"recibos/"+cobro.ReceiptID+"/anular", map[string]string{"motivo": "error"}); c != 403 {
		t.Errorf("anular del vendedor: %d", c)
	}
	if c, b := pedir(t, adm, "POST", u+"recibos/"+cobro.ReceiptID+"/anular", map[string]string{"motivo": "lo cargué mal"}); c != 200 {
		t.Errorf("anular: %d %s", c, b)
	}
	if _, b := pedir(t, adm, "GET", u+"cheques?estado=anulado", nil); !strings.Contains(b, "00123456") {
		t.Errorf("cheque anulado: %s", b)
	}

	// Una retención sufrida baja la deuda con su recibo; el mismo certificado
	// dos veces, no.
	ret := map[string]string{"customerId": id, "numero": "0001-123", "impuesto": "iibb", "base": "100000", "alicuota": "3", "importe": "3000", "fecha": "2026-10-20"}
	if c, b := pedir(t, ven, "POST", u+"retenciones-sufridas", ret); c != 403 {
		t.Errorf("retención del vendedor: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", u+"retenciones-sufridas", ret); c != 200 || !strings.Contains(b, "La cuenta del cliente baja $\u00a03.000.") && !strings.Contains(b, "baja $ 3.000.") {
		t.Errorf("retención: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", u+"retenciones-sufridas", ret); c != 422 || !strings.Contains(b, "Ese certificado ya está cargado") {
		t.Errorf("retención repetida: %d %s", c, b)
	}
	var medio string
	_ = e.pool.QueryRow(context.Background(), `select p.medio::text from receipt_parts p join receipts r on r.id = p.receipt_id where r.concepto like 'Retención de iibb%'`).Scan(&medio)
	if medio != "retencion" {
		t.Errorf("el recibo de la retención: %q", medio)
	}
	// Anular el recibo anula la retención: deja de ser crédito fiscal y el
	// certificado corregido se puede volver a cargar.
	var reciboRet string
	_ = e.pool.QueryRow(context.Background(), `select receipt_id from retenciones_sufridas where numero = '0001-123'`).Scan(&reciboRet)
	if c, b := pedir(t, adm, "POST", u+"recibos/"+reciboRet+"/anular", map[string]string{"motivo": "el certificado tenía mal la base"}); c != 200 {
		t.Fatalf("anular el recibo de la retención: %d %s", c, b)
	}
	var vivas int
	_ = e.pool.QueryRow(context.Background(), `select count(*) from retenciones_sufridas where numero = '0001-123' and anulada_at is null`).Scan(&vivas)
	if vivas != 0 {
		t.Errorf("la retención sigue viva después de anular su recibo")
	}
	if c, b := pedir(t, adm, "POST", u+"retenciones-sufridas", ret); c != 200 {
		t.Errorf("volver a cargar el certificado corregido: %d %s", c, b)
	}

	// Bloqueo, plazo y crédito.
	if c, b := pedir(t, adm, "PUT", u+"clientes/"+id+"/bloqueo", map[string]any{"bloquear": true, "motivo": "no"}); c != 422 || !strings.Contains(b, "Escribí por qué") {
		t.Errorf("bloqueo sin motivo: %d %s", c, b)
	}
	_, _ = pedir(t, adm, "PUT", u+"clientes/"+id+"/bloqueo", map[string]any{"bloquear": true, "motivo": "cheques rebotados"})
	if _, b := pedir(t, ven, "GET", u+"clientes/"+id+"/credito?monto=10", nil); !strings.Contains(b, "Cuenta corriente bloqueada: cheques rebotados") {
		t.Errorf("crédito bloqueado: %s", b)
	}
	if c, b := pedir(t, adm, "PUT", u+"clientes/"+id+"/plazo", map[string]any{"dias": 400}); c != 422 || !strings.Contains(b, "de 0 a 365") {
		t.Errorf("plazo: %d %s", c, b)
	}

	// La ficha.
	if c, b := pedir(t, ven, "GET", u+"clientes/"+id, nil); c != 200 || !strings.Contains(b, `"limiteCredito":"1500000.00"`) || !strings.Contains(b, `"cuentaBloqueada":true`) {
		t.Errorf("ficha: %d %s", c, b)
	}
}

func TestPortalYVinculo(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	web, fichaWeb := e.web(t, "juan@prueba.test")
	u := e.srv.URL + "/api/v1/"
	ctx := context.Background()

	// Sin límite y sin saldo a favor: no tiene cuenta corriente.
	if _, b := pedir(t, web, "GET", u+"cuenta/credito?monto=100", nil); !strings.Contains(b, "Tu cuenta no tiene cuenta corriente habilitada.") {
		t.Errorf("crédito: %s", b)
	}
	// La ficha del mostrador con el mismo correo ofrece vincularla.
	var mostrador string
	_ = e.pool.QueryRow(ctx, `insert into customers (nombre, email, limite_credito) values ('Juan Pérez', 'juan@prueba.test', 1000) returning id`).Scan(&mostrador)
	_, _ = e.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'compra', 400, $2)`, mostrador, time.Now().Add(-time.Hour))
	if _, b := pedir(t, ven, "GET", u+"admin/clientes/"+mostrador, nil); !strings.Contains(b, fichaWeb) {
		t.Fatalf("cuenta web sin vincular: %s", b)
	}
	if c, b := pedir(t, ven, "POST", u+"admin/clientes/"+mostrador+"/cuenta-web", map[string]string{"cuentaWebId": fichaWeb}); c != 200 {
		t.Fatalf("vincular: %d %s", c, b)
	}
	// Ahora el portal ve la cuenta del mostrador.
	if _, b := pedir(t, web, "GET", u+"cuenta/corriente", nil); !strings.Contains(b, `"saldo":400`) || !strings.Contains(b, `"disponible":600`) {
		t.Errorf("cuenta corriente: %s", b)
	}
	if _, b := pedir(t, web, "GET", u+"cuenta/credito?monto=700", nil); !strings.Contains(b, "Tenés 600 disponibles.") {
		t.Errorf("crédito: %s", b)
	}
	if _, b := pedir(t, web, "GET", u+"cuenta/movimientos", nil); !strings.Contains(b, "Compra a cuenta") {
		t.Errorf("movimientos: %s", b)
	}
	// Su propio resumen en PDF sí.
	if c, b := pedir(t, web, "GET", u+"cuentas/"+mostrador+"/pdf", nil); c != 200 || !strings.HasPrefix(b, "%PDF") {
		t.Errorf("su resumen en PDF: %d %.40s", c, b)
	}
	// El portal no entra al panel.
	if c, _ := pedir(t, web, "GET", u+"admin/clientes", nil); c != 403 {
		t.Errorf("el cliente en el panel: %d", c)
	}
}

func TestVendedoresYSeguimiento(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	u := e.srv.URL + "/api/v1/admin/"
	if c, b := pedir(t, ven, "POST", u+"vendedores", map[string]string{"nombre": "Ana", "tipo": "calle"}); c != 200 {
		t.Fatalf("vendedor: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", u+"vendedores", map[string]string{"nombre": "Ana"}); c != 422 || !strings.Contains(b, "Ya hay un vendedor con ese nombre.") {
		t.Errorf("vendedor repetido: %d %s", c, b)
	}
	_, b := pedir(t, ven, "GET", u+"vendedores?activos=true", nil)
	var vs []clientes.Vendedor
	_ = json.Unmarshal([]byte(b), &vs)
	if len(vs) != 1 || vs[0].Tipo != "calle" {
		t.Fatalf("vendedores: %s", b)
	}
	if _, b := pedir(t, ven, "POST", u+"vendedores/"+vs[0].ID+"/alternar", nil); !strings.Contains(b, "Desactivado.") {
		t.Errorf("alternar: %s", b)
	}

	var cliente string
	_ = e.pool.QueryRow(context.Background(), `insert into customers (nombre) values ('Pérez') returning id`).Scan(&cliente)
	if c, b := pedir(t, ven, "POST", u+"seguimiento", map[string]string{"customerId": cliente, "asunto": "Llamar por la deuda", "proximaAccion": "2020-01-01"}); c != 200 {
		t.Fatalf("gestión: %d %s", c, b)
	}
	if _, b := pedir(t, ven, "GET", u+"seguimiento/vencidas", nil); b != "{\"cuantas\":1}\n" {
		t.Errorf("vencidas: %s", b)
	}
	_, b = pedir(t, ven, "GET", u+"seguimiento", nil)
	var gs []clientes.Gestion
	_ = json.Unmarshal([]byte(b), &gs)
	if len(gs) != 1 || !gs[0].Vencida {
		t.Fatalf("gestiones: %s", b)
	}
	if c, b := pedir(t, ven, "PUT", u+"seguimiento/"+gs[0].ID, map[string]string{"etapa": "promesa", "nota": "paga el viernes"}); c != 200 || !strings.Contains(b, cliente) {
		t.Errorf("mover: %d %s", c, b)
	}
	var notas string
	_ = e.pool.QueryRow(context.Background(), `select notas from customer_follow_ups`).Scan(&notas)
	if !strings.HasSuffix(notas, " · paga el viernes") {
		t.Errorf("notas: %q", notas)
	}
}

// La ficha trae lo que la migración cargó del sistema anterior (antes no se
// veía en ningún lado): los totales de todo y lo último primero. Sin nada
// migrado, las listas vienen vacías y los totales en cero.
func TestLaFichaTraeElHistorialAnterior(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	ctx := context.Background()
	var id, otro string
	_ = e.pool.QueryRow(ctx, `insert into customers (nombre) values ('Juan') returning id`).Scan(&id)
	_ = e.pool.QueryRow(ctx, `insert into customers (nombre) values ('Ana') returning id`).Scan(&otro)
	for _, sql := range []string{
		`insert into historical_sales (comprobante_legacy, customer_id, cliente_nombre, fecha, total, detalle) values
		  ('V-1', $1, 'Juan', '2024-03-01', 1000, 'Tirantes'), ('V-2', $1, 'Juan', '2025-06-01', 250.50, '')`,
		`insert into historical_invoices (punto_venta, tipo, numero, customer_id, cliente_nombre, fecha, total, cae) values
		  (1, 'FA', 77, $1, 'Juan', '2025-06-01', 250.50, '71234567890123')`,
	} {
		if _, err := e.pool.Exec(ctx, sql, id); err != nil {
			t.Fatal(err)
		}
	}
	_, b := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/clientes/"+id, nil)
	var f struct{ Anterior clientes.Anterior }
	if err := json.Unmarshal([]byte(b), &f); err != nil {
		t.Fatal(err)
	}
	a := f.Anterior
	if a.CantidadVentas != 2 || a.TotalVentas != "1250.50" || len(a.Ventas) != 2 || a.Ventas[0].Comprobante != "V-2" ||
		a.CantidadComprobantes != 1 || len(a.Comprobantes) != 1 || a.Comprobantes[0].Numero != 77 {
		t.Fatalf("historial anterior: %s", b)
	}
	_, b = pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/clientes/"+otro, nil)
	if !strings.Contains(b, `"anterior":{"cantidadVentas":0,"totalVentas":"0","cantidadComprobantes":0,"totalComprobantes":"0","ventas":[],"comprobantes":[]}`) {
		t.Errorf("sin historial: %s", b)
	}
}
