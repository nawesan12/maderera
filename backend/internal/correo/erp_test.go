package correo

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"mjbj/internal/auth"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// El correo contra una base de verdad: quién ve fichas, qué trae la ficha
// y que sin permiso (o sin base) no sale ningún dato.

type entornoERP struct {
	srv     *httptest.Server
	app     *App
	cliente string
}

func armarERP(t *testing.T, conBase bool) *entornoERP {
	t.Helper()
	silencio := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := Config{IMAP: "127.0.0.1:1", SMTP: "127.0.0.1", NombreTLS: "x", Clave: base64.StdEncoding.EncodeToString(make([]byte, 32)), Segura: false}
	app, err := Nueva(cfg, fstest.MapFS{"index.html": {Data: []byte("<!doctype html>")}}, silencio)
	if err != nil {
		t.Fatal(err)
	}
	e := &entornoERP{app: app}
	if conBase {
		pool := pruebas.Base(t)
		ctx := context.Background()
		ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-del-correo-32-caracteres", URL: "http://localhost"}, pool)
		for correo, rol := range map[string]string{"ventas@prueba.test": "vendedor", "admin@prueba.test": "admin", "deposito@prueba.test": "deposito"} {
			if _, err := ses.AltaDeStaff(ctx, correo, "una clave larga", "Diego "+rol, sqlc.StaffRole(rol)); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := ses.AltaDeCliente(ctx, "juan@cliente.test", "una clave larga", "Juan Cliente"); err != nil {
			t.Fatal(err)
		}
		exec := func(sql string, args ...any) {
			t.Helper()
			if _, err := pool.Exec(ctx, sql, args...); err != nil {
				t.Fatalf("%s: %v", sql, err)
			}
		}
		if err := pool.QueryRow(ctx, `insert into customers (nombre, razon_social, email, tipo, limite_credito)
			values ('Carpintería Pérez', 'Pérez Hnos. SRL', 'CarpinteriaPerez@Gmail.test', 'profesional', 1500000) returning id`).Scan(&e.cliente); err != nil {
			t.Fatal(err)
		}
		// Una ficha dada de baja con el mismo correo no cuenta.
		exec(`insert into customers (nombre, email, active) values ('Vieja', 'carpinteriaperez@gmail.test', false)`)
		exec(`insert into account_movements (customer_id, tipo, monto) values ($1, 'compra', 742180), ($1, 'pago', -255880.50)`, e.cliente)
		exec(`insert into orders (numero, contacto_nombre, customer_id, estado, total) values
			('PED-4836', 'Martín', $1, 'preparando', 100), ('PED-4790', 'Martín', $1, 'listo', 200), ('PED-4001', 'Martín', $1, 'entregado', 300)`, e.cliente)
		exec(`insert into quotes (numero, contacto_nombre, customer_id, estado, total, created_at) values
			('P-2026-0411', 'Martín', $1, 'aceptado', 10, now()), ('P-2026-0412', 'Martín', $1, 'enviado', 742180, now() - interval '3 days')`, e.cliente)
		exec(`insert into cheques (sentido, numero, fecha_pago, importe, estado, customer_id) values
			('recibido', '0001', now() + interval '10 days', 50000, 'cartera', $1), ('recibido', '0002', now(), 1, 'depositado', $1)`, e.cliente)
		app.ConERP(NuevoERP(pool, "https://mjbj.com.ar", silencio))
	}
	e.srv = httptest.NewServer(app.Rutas())
	t.Cleanup(e.srv.Close)
	return e
}

// como pide algo con la sesión de esa casilla.
func (e *entornoERP) como(t *testing.T, casilla, ruta string) (int, []byte) {
	t.Helper()
	w := httptest.NewRecorder()
	if err := e.app.sesiones.Iniciar(w, Credenciales{Correo: casilla, Clave: "x"}); err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("GET", e.srv.URL+ruta, nil)
	for _, c := range w.Result().Cookies() {
		req.AddCookie(c)
	}
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	return r.StatusCode, b
}

func TestFichaDelRemitente(t *testing.T) {
	e := armarERP(t, true)

	estado, cuerpo := e.como(t, "ventas@prueba.test", "/api/cliente?correo=carpinteriaperez@gmail.test")
	if estado != 200 {
		t.Fatalf("vendedor: %d %s", estado, cuerpo)
	}
	var f Ficha
	if err := json.Unmarshal(cuerpo, &f); err != nil {
		t.Fatal(err)
	}
	if f.ID != e.cliente || f.Nombre != "Carpintería Pérez" || !f.Profesional || f.LimiteCredito != 1500000 {
		t.Errorf("ficha: %+v", f)
	}
	// 742180 − 255880,50: la misma suma que saldoDeCliente.
	if f.Saldo != 486299.5 {
		t.Errorf("saldo %v, quería 486299.5", f.Saldo)
	}
	if len(f.Pedidos) != 2 || f.Pedidos[0].Numero == "PED-4001" {
		t.Errorf("pedidos abiertos: %+v", f.Pedidos)
	}
	if f.UltimoPresupuesto == nil || f.UltimoPresupuesto.Numero != "P-2026-0412" {
		t.Errorf("el último presupuesto es el enviado sin respuesta: %+v", f.UltimoPresupuesto)
	}
	if len(f.Cheques) != 1 || f.Cheques[0].Numero != "0001" {
		t.Errorf("cheques por vencer: %+v", f.Cheques)
	}
	if f.Enlaces["presupuesto"] != "https://mjbj.com.ar/admin/presupuestos/nuevo?cliente="+e.cliente {
		t.Errorf("enlace: %q", f.Enlaces["presupuesto"])
	}

	if estado, _ := e.como(t, "admin@prueba.test", "/api/cliente?correo=CARPINTERIAPEREZ@gmail.test"); estado != 200 {
		t.Errorf("admin: %d", estado)
	}
	if estado, _ := e.como(t, "ventas@prueba.test", "/api/cliente?correo=nadie@gmail.test"); estado != 404 {
		t.Errorf("no cliente: %d", estado)
	}

	// Ni el depósito, ni un cliente con casilla, ni una casilla que no es de
	// nadie: ningún dato.
	for _, casilla := range []string{"deposito@prueba.test", "juan@cliente.test", "info@prueba.test"} {
		estado, cuerpo := e.como(t, casilla, "/api/cliente?correo=carpinteriaperez@gmail.test")
		if estado != 404 || strings.Contains(string(cuerpo), "486") || strings.Contains(string(cuerpo), "Pérez") {
			t.Errorf("%s vio la ficha: %d %s", casilla, estado, cuerpo)
		}
		if estado, cuerpo := e.como(t, casilla, "/api/remitentes?correo=carpinteriaperez@gmail.test"); estado != 404 {
			t.Errorf("%s vio los remitentes: %d %s", casilla, estado, cuerpo)
		}
	}

	_, cuerpo = e.como(t, "ventas@prueba.test", "/api/remitentes?correo=CarpinteriaPerez@gmail.test&correo=otro@x.test")
	if string(cuerpo) != `["carpinteriaperez@gmail.test"]`+"\n" && string(cuerpo) != `["carpinteriaperez@gmail.test"]` {
		t.Errorf("remitentes: %s", cuerpo)
	}
	_, cuerpo = e.como(t, "ventas@prueba.test", "/api/contactos?q=carpin")
	if !strings.Contains(string(cuerpo), `"correo":"carpinteriaperez@gmail.test"`) {
		t.Errorf("contactos: %s", cuerpo)
	}

	_, cuerpo = e.como(t, "ventas@prueba.test", "/api/sesion")
	if !strings.Contains(string(cuerpo), `"fichas":true`) || !strings.Contains(string(cuerpo), `"panel":"https://mjbj.com.ar/admin"`) {
		t.Errorf("sesión del vendedor: %s", cuerpo)
	}
	_, cuerpo = e.como(t, "deposito@prueba.test", "/api/sesion")
	if !strings.Contains(string(cuerpo), `"fichas":false`) {
		t.Errorf("sesión del depósito: %s", cuerpo)
	}
}

// Sin base el correo anda: la sesión dice que no hay fichas y las rutas
// del ERP contestan 404 sin datos.
func TestSinBase(t *testing.T) {
	e := armarERP(t, false)
	estado, cuerpo := e.como(t, "ventas@prueba.test", "/api/sesion")
	if estado != 200 || !strings.Contains(string(cuerpo), `"fichas":false`) {
		t.Errorf("sesión: %d %s", estado, cuerpo)
	}
	for _, ruta := range []string{"/api/cliente?correo=a@b.test", "/api/remitentes?correo=a@b.test", "/api/contactos?q=abc"} {
		if estado, _ := e.como(t, "ventas@prueba.test", ruta); estado != 404 {
			t.Errorf("%s: %d", ruta, estado)
		}
	}
}

// Con la base caída tampoco se cae nada: el pool se abre sin probarlo.
func TestBaseCaida(t *testing.T) {
	silencio := slog.New(slog.NewTextHandler(io.Discard, nil))
	erp, err := AbrirERP(ConfigERP{Base: "postgres://nadie:nada@127.0.0.1:1/nada?sslmode=disable"}, silencio)
	if err != nil {
		t.Fatal(err)
	}
	defer erp.Cerrar()
	if erp.VeFichas(context.Background(), "ventas@prueba.test") {
		t.Error("sin base no se ve ninguna ficha")
	}
}
