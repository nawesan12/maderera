package caja

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
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/cajaapi"
	"mjbj/internal/auth"
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
	u                   string
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-la-caja-de-32-caracteres", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	cajaapi.HandlerWithOptions(
		cajaapi.NewStrictHandlerWithOptions(NuevaPanelAPI(NuevoPanel(pool, silencio)),
			[]cajaapi.StrictMiddlewareFunc{plataforma.ConPedido[cajaapi.StrictHandlerFunc]},
			cajaapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		cajaapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := cajaapi.GetSwagger()
	validar, err := plataforma.ValidarContra(spec)
	if err != nil {
		t.Fatal(err)
	}
	spec2, _ := cajaapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	t.Cleanup(srv.Close)
	e := &entorno{srv: srv, pool: pool, ses: ses, u: srv.URL + "/api/v1/admin/caja/"}
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

func (e *entorno) numero(t *testing.T, sql string, args ...any) float64 {
	t.Helper()
	var n float64
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (e *entorno) staff(t *testing.T, correo string, rol sqlc.StaffRole) (*http.Client, string) {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeStaff(ctx, correo, "una clave larga", "Persona "+string(rol), rol); err != nil {
		t.Fatal(err)
	}
	id := e.id(t, `select id from "user" where email = $1`, correo)
	w := httptest.NewRecorder()
	if _, err := e.ses.Entrar(ctx, w, correo, "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u.URL, w.Result().Cookies())
	return &http.Client{Jar: jar}, id
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

func TestCajasFisicas(t *testing.T) {
	e := armar(t)
	adm, _ := e.staff(t, "admin@prueba.test", "admin")
	ven, _ := e.staff(t, "vendedor@prueba.test", "vendedor")

	if c, b := pedir(t, adm, "POST", e.u+"cajas-fisicas", map[string]any{"codigo": "c", "branchId": e.central}); c != 422 || !strings.Contains(b, "El código es muy corto.") {
		t.Errorf("código corto: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"cajas-fisicas", map[string]any{"codigo": "caja 1", "branchId": e.central}); c != 422 || !strings.Contains(b, "Usá solo letras") {
		t.Errorf("con espacio: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"cajas-fisicas", map[string]any{"codigo": "caja1", "branchId": ""}); c != 422 || !strings.Contains(b, "Elegí la sucursal.") {
		t.Errorf("sin sucursal: %d %s", c, b)
	}
	if c, _ := pedir(t, ven, "POST", e.u+"cajas-fisicas", map[string]any{"codigo": "caja1", "branchId": e.central}); c != 403 {
		t.Errorf("el vendedor no da de alta cajas: %d", c)
	}
	c, b := pedir(t, adm, "POST", e.u+"cajas-fisicas", map[string]any{"codigo": "  caja-1 ", "nombre": "  ", "branchId": e.central})
	if c != 200 || !strings.Contains(b, `"codigo":"CAJA-1"`) || strings.Contains(b, "secreto") {
		t.Fatalf("alta: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from pos_devices where codigo = 'CAJA-1' and nombre is null and length(secreto) = 32`); n != 1 {
		t.Errorf("guardada: %v", n)
	}
	if c, b := pedir(t, adm, "POST", e.u+"cajas-fisicas", map[string]any{"codigo": "Caja-1", "branchId": e.aserradero}); c != 422 || !strings.Contains(b, MsjCodigoRepetido) {
		t.Errorf("repetido: %d %s", c, b)
	}
	_, b = pedir(t, adm, "GET", e.u+"cajas-fisicas", nil)
	var cajas []CajaFisica
	_ = json.Unmarshal([]byte(b), &cajas)
	if len(cajas) != 1 || cajas[0].Sucursal == nil || *cajas[0].Sucursal != "Casa Central" || !cajas[0].Activo {
		t.Fatalf("listado: %s", b)
	}
	// Con ventas sin subir no se da de baja; sin ellas, sí (y no se borra).
	e.pool.Exec(context.Background(), `update pos_devices set pendientes = 1`)
	if c, b := pedir(t, adm, "POST", e.u+"cajas-fisicas/"+cajas[0].ID+"/baja", nil); c != 422 || !strings.Contains(b, "CAJA-1 tiene 1 venta cobrada que todavía no subieron") {
		t.Errorf("con pendientes: %d %s", c, b)
	}
	e.pool.Exec(context.Background(), `update pos_devices set pendientes = 0`)
	if c, b := pedir(t, adm, "POST", e.u+"cajas-fisicas/"+cajas[0].ID+"/baja", nil); c != 200 || !strings.Contains(b, "CAJA-1 quedó fuera de servicio.") {
		t.Errorf("baja: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"cajas-fisicas/no-existe/baja", nil); c != 422 || !strings.Contains(b, "Esa caja no existe.") {
		t.Errorf("inexistente: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from audit_log where entidad = 'caja'`); n != 2 {
		t.Errorf("bitácora: %v", n)
	}
}

// Veinte altas a la vez con el mismo código: una caja y diecinueve avisos,
// ningún 500. Sin el aviso del índice único, el resto era un error crudo.
func TestCajasConElMismoCodigoALaVez(t *testing.T) {
	e := armar(t)
	adm, _ := e.staff(t, "admin@prueba.test", "admin")
	var wg sync.WaitGroup
	codigos := make(chan int, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, _ := pedir(t, adm, "POST", e.u+"cajas-fisicas", map[string]any{"codigo": "CAJA9", "branchId": e.central})
			codigos <- c
		}()
	}
	wg.Wait()
	close(codigos)
	por := map[int]int{}
	for c := range codigos {
		por[c]++
	}
	if por[200] != 1 || por[422] != 19 {
		t.Errorf("códigos: %v", por)
	}
}

func (e *entorno) turno(t *testing.T, sucursal, quien string, abierta time.Time, cerrada *time.Time, contado *float64) string {
	t.Helper()
	estado := "abierta"
	if cerrada != nil {
		estado = "cerrada"
	}
	return e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at, cerrada_at, estado, contado) values ($1, $2, $3, $4, $5, $6) returning id`,
		sucursal, quien, abierta, cerrada, estado, contado)
}

func (e *entorno) venta(t *testing.T, numero, sucursal, medio string, total float64, creada time.Time, cobrada *time.Time, clave bool) string {
	t.Helper()
	var c *string
	if clave {
		s := "clave-" + numero
		c = &s
	}
	return e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, medio_pago, total, created_at, cobrada_at, clave_mostrador, estado)
		values ($1, 'Cliente', $2, 'mostrador', $3, $4, $5, $6, $7, 'entregado') returning id`, numero, sucursal, medio, total, creada, cobrada, c)
}

func TestTurnosVentasSueltasYFondo(t *testing.T) {
	e := armar(t)
	adm, idAdm := e.staff(t, "admin@prueba.test", "admin")
	ven, _ := e.staff(t, "vendedor@prueba.test", "vendedor")
	ctx := context.Background()

	// Un turno cerrado con apertura, una venta en efectivo y un retiro; una
	// venta con tarjeta partida, y un movimiento que llegó después del cierre.
	abre := time.Date(2026, 10, 20, 9, 0, 0, 0, Argentina)
	cierra := abre.Add(9 * time.Hour)
	contado := 14_000.0
	turno := e.turno(t, e.central, idAdm, abre, &cierra, &contado)
	v1 := e.venta(t, "V-1", e.central, "efectivo", 5000, abre.Add(time.Hour), nil, true)
	v2 := e.venta(t, "V-2", e.central, "debito", 3000, abre.Add(2*time.Hour), nil, true)
	e.pool.Exec(ctx, `insert into order_payments (order_id, medio, importe) values ($1, 'debito', 2000), ($1, 'efectivo', 1000)`, v2)
	e.pool.Exec(ctx, `insert into cash_movements (session_id, tipo, monto, order_id, created_at) values
		($1, 'apertura', 10000, null, $2), ($1, 'venta', 5000, $3, $4), ($1, 'retiro', -1000, null, $4), ($1, 'venta', 1000, $5, $6)`,
		turno, abre, v1, abre.Add(time.Hour), v2, cierra.Add(time.Hour))

	c, b := pedir(t, adm, "GET", e.u+"turnos-cerrados", nil)
	var cerrados []TurnoCerrado
	_ = json.Unmarshal([]byte(b), &cerrados)
	if c != 200 || len(cerrados) != 1 {
		t.Fatalf("turnos: %d %s", c, b)
	}
	tc := cerrados[0]
	if tc.Esperado != 15000 || *tc.Contado != 14000 || tc.Tardios != 1 || tc.AbiertaPor != "Persona admin" || tc.Sucursal != "Casa Central" {
		t.Errorf("turno: %+v", tc)
	}
	if fmt.Sprint(tc.Cierre) != "[{efectivo 2 6000} {debito 1 2000}]" {
		t.Errorf("cierre Z: %+v", tc.Cierre)
	}
	if c, _ := pedir(t, ven, "GET", e.u+"turnos-cerrados", nil); c != 403 {
		t.Errorf("el vendedor no ve la caja: %d", c)
	}
	// Las sucursales las lee cualquiera del panel.
	if c, b := pedir(t, ven, "GET", e.u+"sucursales", nil); c != 200 || !strings.Contains(b, `"turnoId":null`) {
		t.Errorf("sucursales: %d %s", c, b)
	}

	// Una venta suelta: efectivo, cobrada sin conexión, sin movimiento.
	cobrada := abre.Add(3 * time.Hour)
	suelta := e.venta(t, "V-3", e.central, "efectivo", 2500.5, cobrada.Add(time.Hour), &cobrada, true)
	_, b = pedir(t, adm, "GET", e.u+"ventas-sueltas", nil)
	if !strings.Contains(b, `"numero":"V-3"`) || strings.Contains(b, "V-1") {
		t.Fatalf("sueltas: %s", b)
	}
	_, b = pedir(t, adm, "GET", e.u+"turnos-para-asignar?sucursal="+e.central, nil)
	if !strings.Contains(b, `"etiqueta":"20/10 09:00 a. m."`) {
		t.Errorf("etiqueta en hora argentina: %s", b)
	}
	otro := e.turno(t, e.aserradero, idAdm, abre, nil, nil)
	if c, b := pedir(t, adm, "POST", e.u+"ventas-sueltas/"+suelta+"/asignar", map[string]string{"sessionId": otro}); c != 422 || !strings.Contains(b, "Ese turno es de otra sucursal.") {
		t.Errorf("otra sucursal: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"ventas-sueltas/"+suelta+"/asignar", map[string]string{"sessionId": turno}); c != 200 || !strings.Contains(b, "V-3 quedó en el turno.") {
		t.Fatalf("asignar: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", e.u+"ventas-sueltas/"+suelta+"/asignar", map[string]string{"sessionId": turno}); c != 422 || !strings.Contains(b, "Esa venta ya está asignada a un turno.") {
		t.Errorf("dos veces: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from cash_movements where order_id = $1 and monto = 2500.50 and created_at = $2`, suelta, cobrada); n != 1 {
		t.Errorf("el movimiento va con la hora del cobro: %v", n)
	}

	// El cambio fijo: solo el admin, de cero para arriba.
	if c, b := pedir(t, adm, "PUT", e.u+"sucursales/"+e.central+"/fondo-base", map[string]any{"monto": -5}); c != 422 || !strings.Contains(b, MsjFondoBaseInvalido) {
		t.Errorf("negativo: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "PUT", e.u+"sucursales/"+e.central+"/fondo-base", map[string]any{"monto": " 15000.5 "}); c != 200 || !strings.Contains(b, "no va a poder retirar") {
		t.Errorf("fondo: %d %s", c, b)
	}
	if n := e.numero(t, `select fondo_base::float8 from branches where id = $1`, e.central); n != 15000.5 {
		t.Errorf("fondo guardado: %v", n)
	}
	if c, b := pedir(t, adm, "PUT", e.u+"sucursales/"+e.central+"/fondo-base", map[string]any{"monto": 0}); c != 200 || !strings.Contains(b, "sin cambio fijo") {
		t.Errorf("fondo cero: %d %s", c, b)
	}
	if c, _ := pedir(t, ven, "PUT", e.u+"sucursales/"+e.central+"/fondo-base", map[string]any{"monto": 0}); c != 403 {
		t.Errorf("el vendedor no toca el fondo: %d", c)
	}
}

// Lo emitido del mes corta en hora argentina: una venta del 31 a las 22
// (la 1 del 1.º en UTC) es del mes que termina.
func TestEmitidoPorMesArgentino(t *testing.T) {
	e := armar(t)
	adm, _ := e.staff(t, "admin@prueba.test", "admin")
	e.venta(t, "OCT-31", e.central, "efectivo", 100, time.Date(2026, 10, 31, 22, 0, 0, 0, Argentina), nil, true)
	e.venta(t, "NOV-1", e.central, "efectivo", 100, time.Date(2026, 11, 1, 0, 30, 0, 0, Argentina), nil, true)
	_, b := pedir(t, adm, "GET", e.u+"emitido?periodo=2026-10", nil)
	if !strings.Contains(b, "OCT-31") || strings.Contains(b, "NOV-1") {
		t.Errorf("octubre: %s", b)
	}
	_, b = pedir(t, adm, "GET", e.u+"emitido?periodo=2026-11", nil)
	if strings.Contains(b, "OCT-31") || !strings.Contains(b, "NOV-1") {
		t.Errorf("noviembre: %s", b)
	}
}

// Diez clics a la vez en «asignar» la misma venta suelta: un solo
// movimiento. Sin el candado de la fila del pedido, entraba más de una vez
// (el TS leía «sin movimiento» y anotaba, sin bloquear nada).
// Bug: una venta suelta mixta (tarjeta + efectivo) no aparecía si el medio
// principal no era efectivo, y si era efectivo, al asignarla entraba al
// cajón el total y no la parte en efectivo: el arqueo daba sobrante.
func TestVentaSueltaMixtaEntraSoloConElEfectivo(t *testing.T) {
	e := armar(t)
	adm, idAdm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	abre := time.Now().Add(-time.Hour)
	turno := e.turno(t, e.central, idAdm, abre, nil, nil)
	cobrada := abre.Add(time.Minute)
	// Principal débito, con $1.000 en efectivo.
	debito := e.venta(t, "M-1", e.central, "debito", 3000, cobrada, &cobrada, true)
	e.pool.Exec(ctx, `insert into order_payments (order_id, medio, importe) values ($1, 'debito', 2000), ($1, 'efectivo', 1000)`, debito)
	// Principal efectivo, con $500 con tarjeta.
	efectivo := e.venta(t, "M-2", e.central, "efectivo", 2000, cobrada, &cobrada, true)
	e.pool.Exec(ctx, `insert into order_payments (order_id, medio, importe) values ($1, 'efectivo', 1500), ($1, 'credito', 500)`, efectivo)
	// Toda con tarjeta: no tiene nada que ver con la caja.
	tarjeta := e.venta(t, "M-3", e.central, "credito", 700, cobrada, &cobrada, true)
	e.pool.Exec(ctx, `insert into order_payments (order_id, medio, importe) values ($1, 'credito', 700)`, tarjeta)

	_, b := pedir(t, adm, "GET", e.u+"ventas-sueltas", nil)
	if !strings.Contains(b, `"numero":"M-1"`) || !strings.Contains(b, `"numero":"M-2"`) || strings.Contains(b, `"numero":"M-3"`) {
		t.Errorf("las sueltas con parte en efectivo: %s", b)
	}
	if !strings.Contains(b, `"efectivo":1000`) || !strings.Contains(b, `"efectivo":1500`) {
		t.Errorf("la parte en efectivo de cada una: %s", b)
	}
	for _, v := range []string{debito, efectivo} {
		if c, b := pedir(t, adm, "POST", e.u+"ventas-sueltas/"+v+"/asignar", map[string]string{"sessionId": turno}); c != 200 {
			t.Fatalf("asignar: %d %s", c, b)
		}
	}
	if m := e.numero(t, `select coalesce(sum(monto), 0)::float8 from cash_movements where session_id = $1 and tipo = 'venta'`, turno); m != 2500 {
		t.Errorf("al cajón entra solo el efectivo (1000 + 1500): %v", m)
	}
	if c, b := pedir(t, adm, "POST", e.u+"ventas-sueltas/"+tarjeta+"/asignar", map[string]string{"sessionId": turno}); c != 422 {
		t.Errorf("una venta sin efectivo no va a la caja: %d %s", c, b)
	}
}

func TestAsignarLaMismaVentaALaVez(t *testing.T) {
	e := armar(t)
	adm, idAdm := e.staff(t, "admin@prueba.test", "admin")
	abre := time.Now().Add(-time.Hour)
	turno := e.turno(t, e.central, idAdm, abre, nil, nil)
	for vuelta := 0; vuelta < 5; vuelta++ {
		cobrada := abre.Add(time.Duration(vuelta) * time.Minute)
		suelta := e.venta(t, fmt.Sprintf("S-%d", vuelta), e.central, "efectivo", 1000, cobrada, &cobrada, true)
		var wg sync.WaitGroup
		inicio := make(chan struct{})
		for i := 0; i < 10; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-inicio
				pedir(t, adm, "POST", e.u+"ventas-sueltas/"+suelta+"/asignar", map[string]string{"sessionId": turno})
			}()
		}
		close(inicio)
		wg.Wait()
		if n := e.numero(t, `select count(*)::float8 from cash_movements where order_id = $1`, suelta); n != 1 {
			t.Fatalf("vuelta %d: %v movimientos de la misma venta", vuelta, n)
		}
	}
}
