package notificaciones

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/avisos"
	"mjbj/internal/cola"
	"mjbj/internal/facturacion"
	"mjbj/internal/pruebas"
	"mjbj/internal/push"
	"mjbj/internal/sqlc"
	"mjbj/internal/whatsapp"
)

type entorno struct {
	pool *pgxpool.Pool
	s    *Servicio
	b    *buzon
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	silencio := slog.New(slog.NewTextHandler(io.Discard, nil))
	b := &buzon{}
	s := Nuevo(pool, "https://mjbj.com.ar/", avisos.Nuevo(pool, b, "MJBJ <avisos@mjbj.com.ar>", silencio),
		whatsapp.Nuevo(pool, whatsapp.Config{}, nil, silencio), facturacion.Nuevo(pool, silencio), silencio).
		ConPanel(push.Nuevo(push.Config{}, sqlc.New(pool), silencio), nil)
	return &entorno{pool: pool, s: s, b: b}
}

func (e *entorno) uno(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var v string
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return v
}

func (e *entorno) ultimo(t *testing.T) (para, asunto, html, texto string) {
	t.Helper()
	e.b.mu.Lock()
	defer e.b.mu.Unlock()
	if len(e.b.recibidos) == 0 {
		t.Fatal("no salió ningún correo")
	}
	m := e.b.recibidos[len(e.b.recibidos)-1]
	return m.Para, m.Asunto, m.HTML, m.Texto
}

func (e *entorno) correos() int {
	e.b.mu.Lock()
	defer e.b.mu.Unlock()
	return len(e.b.recibidos)
}

// registro es el notifications_log de un evento: canal:estado, en orden.
func (e *entorno) registro(t *testing.T, evento string) string {
	return e.uno(t, `select coalesce(string_agg(canal::text || ':' || estado::text, ',' order by created_at, canal), '') from notifications_log where evento = $1`, evento)
}

func (e *entorno) pedido(t *testing.T, numero, correo, tipoEntrega string) string {
	t.Helper()
	id := e.uno(t, `insert into orders (numero, contacto_nombre, contacto_email, total, subtotal, tipo_entrega, zona_envio, medio_pago)
		values ($1, 'Juan Pérez', nullif($2, ''), 84500.50, 84500.50, $3::tipo_entrega, 'Zona Sur', 'transferencia') returning id`, numero, correo, tipoEntrega)
	e.uno(t, `insert into order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal, orden) values
		($1, 'Tirante 2x4', 'm', 3.5, 1000, 3500, 1), ($1, 'Placa MDF 18 mm', 'u', 2, 40500.25, 81000.50, 0) returning 'ok'`, id)
	return id
}

func TestPedidoRecibido(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	id := e.pedido(t, "PED-000123", "juan@prueba.test", "envio")
	token := e.uno(t, `select public_token::text from orders where id = $1`, id)

	if err := e.s.PedidoRecibido(ctx, id); err != nil {
		t.Fatal(err)
	}
	para, asunto, html, texto := e.ultimo(t)
	if para != "juan@prueba.test" || asunto != "Pedido PED-000123 recibido" ||
		!strings.Contains(html, "Envío · Zona Sur") || !strings.Contains(html, "Transferencia bancaria") ||
		!strings.Contains(html, "https://mjbj.com.ar/pedido/PED-000123?t="+token) {
		t.Errorf("acuse: %s %s", para, asunto)
	}
	// Los renglones en el orden del pedido (el TS no ordenaba).
	if i, j := strings.Index(texto, "Placa MDF"), strings.Index(texto, "Tirante"); i < 0 || j < 0 || i > j ||
		!strings.Contains(texto, "- Tirante 2x4 (3.5 m) $ 3.500") {
		t.Errorf("renglones: %q", texto)
	}
	// Al panel (sin claves VAPID: omitida, pero queda), al WhatsApp (nace
	// apagado) y el correo.
	if r := e.registro(t, "pedido_recibido"); !strings.Contains(r, "email:enviada") {
		t.Errorf("registro del acuse: %s", r)
	}
	if r := e.uno(t, `select count(*)::text from notifications_log where canal = 'push' and asunto = 'Venta nueva · PED-000123'`); r != "1" {
		t.Errorf("aviso al panel: %s", r)
	}

	// Sin correo, el panel igual se entera.
	sinCorreo := e.pedido(t, "PED-000124", "", "retiro")
	antes := e.correos()
	if err := e.s.PedidoRecibido(ctx, sinCorreo); err != nil || e.correos() != antes {
		t.Errorf("sin correo: %v, %d correos", err, e.correos()-antes)
	}
	if r := e.uno(t, `select count(*)::text from notifications_log where canal = 'push' and asunto = 'Venta nueva · PED-000124'`); r != "1" {
		t.Errorf("aviso al panel sin correo: %s", r)
	}
	// Uno que no existe no falla.
	if err := e.s.PedidoRecibido(ctx, "00000000-0000-4000-8000-000000000000"); err != nil {
		t.Error(err)
	}
}

func TestCambioDeEstado(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	id := e.pedido(t, "PED-000200", "juan@prueba.test", "retiro")
	if err := e.s.CambioDeEstado(ctx, id, "listo"); err != nil {
		t.Fatal(err)
	}
	if _, asunto, _, _ := e.ultimo(t); asunto != "Tu pedido está listo · PED-000200" {
		t.Errorf("asunto: %q", asunto)
	}
	// El asunto y el encabezado editados en /admin/avisos mandan.
	e.uno(t, `insert into email_avisos (evento, asunto, encabezado) values ('preparando', 'Ya arrancamos', 'Manos a la obra') returning 'ok'`)
	if err := e.s.CambioDeEstado(ctx, id, "preparando"); err != nil {
		t.Fatal(err)
	}
	if _, asunto, html, _ := e.ultimo(t); asunto != "Ya arrancamos" || !strings.Contains(html, "<h1 style=\"margin:0 0 16px;font-size:21px;line-height:1.3;color:#1E1A16;\">Manos a la obra</h1>") {
		t.Errorf("personalizado: %q", asunto)
	}
	// Apagado: no sale y queda omitida.
	e.uno(t, `insert into email_avisos (evento, asunto, activo) values ('entregado', 'x', false) returning 'ok'`)
	antes := e.correos()
	if err := e.s.CambioDeEstado(ctx, id, "entregado"); err != nil || e.correos() != antes {
		t.Errorf("apagado: %v", err)
	}
	if r := e.registro(t, "entregado"); r != "email:omitida" {
		t.Errorf("registro apagado: %s", r)
	}
}

func TestResultadoDePago(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	id := e.pedido(t, "PED-000300", "juan@prueba.test", "retiro")
	// Un intento rechazado con otro medio y otro importe, y después el
	// aprobado: el correo dice el aprobado.
	e.uno(t, `insert into payments (order_id, proveedor, tipo, estado, monto, medio, created_at) values
		($1, 'mercado_pago', 'pedido', 'rechazado', 1, 'visa', now() - interval '1 hour'),
		($1, 'mercado_pago', 'pedido', 'aprobado', 84500.50, 'account_money', now()) returning 'ok'`, id)
	if err := e.s.ResultadoDePago(ctx, CargaResultadoDePago{OrderID: &id, Tipo: "pedido", Detalle: "aprobado"}); err != nil {
		t.Fatal(err)
	}
	_, asunto, html, _ := e.ultimo(t)
	if asunto != "Pago recibido · $ 84.501" || !strings.Contains(html, "account_money") || strings.Contains(html, "visa") {
		t.Errorf("pago del pedido: %q", asunto)
	}
	if r := e.uno(t, `select count(*)::text from notifications_log where canal = 'push' and asunto = 'Pago acreditado · PED-000300'`); r != "1" {
		t.Errorf("aviso al panel: %s", r)
	}
	// Lo que no es «aprobado» no avisa; una inscripción sin eventos, tampoco.
	antes := e.correos()
	_ = e.s.ResultadoDePago(ctx, CargaResultadoDePago{OrderID: &id, Tipo: "pedido", Detalle: "rechazado"})
	cliente := e.uno(t, `insert into customers (nombre, email) values ('Ana Gómez', 'ana@prueba.test') returning id`)
	_ = e.s.ResultadoDePago(ctx, CargaResultadoDePago{CustomerID: &cliente, Tipo: "inscripcion", Detalle: "aprobado"})
	if e.correos() != antes {
		t.Errorf("avisó de más: %d", e.correos()-antes)
	}
	// Un pago de deuda sin recibo: a la cuenta corriente.
	e.uno(t, `insert into payments (customer_id, proveedor, tipo, estado, monto, medio) values ($1, 'mercado_pago', 'deuda', 'aprobado', 15000, 'visa') returning 'ok'`, cliente)
	if err := e.s.ResultadoDePago(ctx, CargaResultadoDePago{CustomerID: &cliente, Tipo: "deuda", Detalle: "aprobado"}); err != nil {
		t.Fatal(err)
	}
	if para, asunto, html, _ := e.ultimo(t); para != "ana@prueba.test" || asunto != "Pago recibido · $ 15.000" ||
		!strings.Contains(html, "/mi-cuenta/cuenta-corriente") || !strings.Contains(html, "Hola Ana,") {
		t.Errorf("pago de deuda: %s %q", para, asunto)
	}
}

func TestPresupuestoRecibido(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	// 03:05 UTC son las 00:05 de Buenos Aires: el TS (en un contenedor en
	// UTC) decía 03:05, y desde las 21 el día de mañana.
	id := e.uno(t, `insert into quotes (numero, contacto_nombre, contacto_email, origen, responde_hasta)
		values ('P-2026-0042', 'Ana Gómez', 'ana@prueba.test', 'express', '2026-10-29T03:05:00Z') returning id`)
	if err := e.s.PresupuestoRecibido(ctx, id); err != nil {
		t.Fatal(err)
	}
	_, asunto, html, _ := e.ultimo(t)
	if asunto != "Pedido de presupuesto P-2026-0042" || !strings.Contains(html, "29/10, 00:05") || !strings.Contains(html, "cola express") {
		t.Errorf("acuse: %q", asunto)
	}
	if r := e.registro(t, "presupuesto_recibido"); r != "email:enviada" {
		t.Errorf("registro: %s", r)
	}
}

func TestRemitos(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	pedido := e.pedido(t, "PED-000400", "juan@prueba.test", "retiro")
	item := e.uno(t, `select id from order_items where order_id = $1 and orden = 1`, pedido)
	remito := e.uno(t, `insert into deliveries (numero, order_id, estado, tipo, firma_token) values ('REM-0001', $1, 'preparada', 'retiro', 'tok-firma') returning id`, pedido)
	e.uno(t, `insert into delivery_items (delivery_id, order_item_id, cantidad, orden) values ($1, $2, 1.5, 0) returning 'ok'`, remito, item)

	if err := e.s.RemitoParaFirmar(ctx, remito); err != nil {
		t.Fatal(err)
	}
	if _, asunto, html, _ := e.ultimo(t); asunto != "Remito REM-0001 para firmar" || !strings.Contains(html, "https://mjbj.com.ar/firmar/tok-firma") {
		t.Errorf("para firmar: %q", asunto)
	}

	e.uno(t, `update deliveries set estado = 'entregada', firmado_at = '2026-10-29T03:05:00Z' where id = $1 returning 'ok'`, remito)
	if err := e.s.RemitoFirmado(ctx, remito); err != nil {
		t.Fatal(err)
	}
	_, asunto, html, texto := e.ultimo(t)
	if asunto != "Entrega REM-0001 · pedido PED-000400" || !strings.Contains(html, "29/10, 00:05") ||
		!strings.Contains(texto, "- Tirante 2x4 (1.5 m)\n") || !strings.Contains(texto, "Todavía te queda mercadería en acopio.") {
		t.Errorf("firmado: %q %q", asunto, texto)
	}
	if r := e.registro(t, "remito_firmado"); r != "email:enviada" {
		t.Errorf("registro: %s", r)
	}
}

// La ida y vuelta entera por la cola: lo que encolan checkout, pedidos y
// entregas, con la carga que dejan, lo atiende el worker.
func TestPorLaCola(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	silencio := slog.New(slog.NewTextHandler(io.Discard, nil))
	q := sqlc.New(e.pool)
	c := cola.Nueva(q, silencio)
	e.s.Registrar(c)
	id := e.pedido(t, "PED-000500", "juan@prueba.test", "retiro")
	for _, tr := range []struct {
		tipo  string
		carga any
	}{
		{"pedido.recibido", map[string]string{"orderId": id}},
		{"pedido.estado", map[string]string{"orderId": id, "estado": "preparando"}},
		{"pago.resultado", map[string]any{"orderId": id, "customerId": nil, "tipo": "pedido", "detalle": "aprobado", "receiptId": nil}},
	} {
		crudo, _ := json.Marshal(tr.carga)
		if _, err := cola.Encolar(ctx, q, tr.tipo, json.RawMessage(crudo), time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	r, err := c.Procesar(ctx, 10)
	if err != nil || r.Hechos != 3 {
		t.Fatalf("procesar: %+v %v", r, err)
	}
	for _, ev := range []string{"pedido_recibido", "preparando", "pago_acreditado"} {
		if got := e.registro(t, ev); !strings.Contains(got, "email:enviada") {
			t.Errorf("%s: %s", ev, got)
		}
	}
}
