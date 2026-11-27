package reportes

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"mjbj/internal/pruebas"
)

// El saldo del banco (M2S1-027, M2S2-100): sin cargar, lo movido hoy no
// suma al total; cargado, «Plata hoy» lo lleva con lo que entra y sale
// después de cargarlo. Solo el admin lo carga, y queda en la bitácora.
func TestSaldoDelBancoDesdeElInicio(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	prov := e.id(t, `insert into suppliers (nombre) values ('Herrajes') returning id`)
	// A las 10 (antes de cargar el saldo) se pagaron 5000 por transferencia:
	// ya están en lo que dice el banco.
	e.exec(t, `insert into supplier_payments (supplier_id, total, neto, medio, fecha) values ($1, 5000, 5000, 'transferencia', '2026-10-15T13:00:00Z')`, prov)
	e.exec(t, `insert into expenses (fecha, categoria, descripcion, importe, medio, created_at) values
		('2026-10-15T00:00:00Z', 'servicios', 'Luz de la mañana', 100, 'debito', '2026-10-15T13:30:00Z')`)

	dueno := func() PlataHoy {
		t.Helper()
		_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
		var n NumerosDelDueno
		if err := json.Unmarshal([]byte(cuerpo), &n); err != nil {
			t.Fatal(cuerpo)
		}
		return n.PlataHoy
	}
	p := dueno()
	if p.Banco != -5100 || p.BancoSaldo != nil || p.Total != 0 {
		t.Fatalf("sin saldo cargado, el banco de hoy no suma: banco %v, saldo %v, total %v", p.Banco, p.BancoSaldo, p.Total)
	}

	cargar := func(c *http.Client, monto float64) (int, string) {
		t.Helper()
		cuerpo, _ := json.Marshal(map[string]any{"monto": monto})
		req, _ := http.NewRequest("POST", e.u+"inicio/saldo-banco", bytes.NewReader(cuerpo))
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	if st, _ := cargar(ven, 1); st != 403 {
		t.Fatalf("el vendedor no carga el saldo: %d", st)
	}
	// El reloj de la prueba son las 12: el saldo se carga a esa hora.
	if st, b := cargar(adm, 80000); st != 200 || !strings.Contains(b, `"bancoSaldo":80000`) {
		t.Fatalf("cargar: %d %s", st, b)
	}
	// Después de cargarlo: entra un recibo por transferencia de 1500 y sale
	// un gasto de 200 cargado a las 12:30. Lo de la mañana no se descuenta
	// otra vez.
	cliente := e.id(t, `insert into customers (nombre) values ('A') returning id`)
	recibo := e.id(t, `insert into receipts (numero, customer_id, recibido_de, total, estado, origen, created_at) values ('R-1', $1, 'A', 1500, 'emitido', 'panel', '2026-10-15T15:10:00Z') returning id`, cliente)
	e.exec(t, `insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, 'transferencia', 1500, 0)`, recibo)
	e.exec(t, `insert into expenses (fecha, categoria, descripcion, importe, medio, created_at) values
		('2026-10-15T00:00:00Z', 'servicios', 'Internet', 200, 'transferencia', '2026-10-15T15:30:00Z')`)
	p = dueno()
	if p.BancoSaldo == nil || *p.BancoSaldo != 81300 {
		t.Fatalf("saldo: %v", p.BancoSaldo)
	}
	if p.Total != 81300 {
		t.Errorf("con el saldo cargado, el banco suma: %v", p.Total)
	}
	var n int
	if err := e.pool.QueryRow(t.Context(), `select count(*)::int from audit_log where entidad = 'banco'`).Scan(&n); err != nil || n != 1 {
		t.Errorf("bitácora: %d %v", n, err)
	}
}

// Lo que el mes simulado encontró en «Para hoy» en la segunda vuelta:
// las recepciones de una factura de varios remitos no están sin factura
// (M2S2-043, M2S4-011), el cheque informado que nunca se aceptó no es un
// rechazo para reclamar (M3S2-024), cada número abre su lista filtrada
// (M2S1-192, M3S2-020) y quien vende ve su cobranza y no la carga del
// catálogo (M2S4-026).
func TestParaHoyCuentaComoSusPantallas(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	e.catalogo(t)

	prov := e.id(t, `insert into suppliers (nombre) values ('Tableros') returning id`)
	r1 := e.id(t, `insert into goods_receipts (supplier_id, branch_id, estado, numero_remito) values ($1, $2, 'confirmada', '1') returning id`, prov, e.central)
	r2 := e.id(t, `insert into goods_receipts (supplier_id, branch_id, estado, numero_remito) values ($1, $2, 'confirmada', '2') returning id`, prov, e.central)
	e.exec(t, `insert into goods_receipts (supplier_id, branch_id, estado, numero_remito) values ($1, $2, 'confirmada', '3')`, prov, e.central)
	f := e.id(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision, receipt_id)
		values ($1, 'factura_a', 3, 22044, 1000, 210, 0, 0, 0, 1210, '2026-10-10T00:00:00Z', $2) returning id`, prov, r1)
	e.exec(t, `insert into purchase_invoice_receipts (purchase_invoice_id, goods_receipt_id) values ($1, $2), ($1, $3) on conflict do nothing`, f, r1, r2)

	// Un cheque que el banco devolvió y otro informado que no se aceptó.
	ch := e.id(t, `insert into cheques (sentido, numero, fecha_pago, importe, estado) values ('recibido', '1', '2026-10-10T15:00:00Z', 400, 'depositado') returning id`)
	e.exec(t, `update cheques set estado = 'rechazado' where id = $1`, ch)
	inf := e.id(t, `insert into cheques (sentido, numero, fecha_pago, importe, estado) values ('recibido', '77001234', '2026-10-20T15:00:00Z', 150000, 'informado') returning id`)
	e.exec(t, `update cheques set estado = 'rechazado' where id = $1`, inf)
	e.exec(t, `update cheque_estados set at = '2026-10-15T13:00:00Z'`)

	// Presupuestos y WhatsApp para los enlaces.
	e.exec(t, `insert into quotes (numero, contacto_nombre, estado) values ('P-2', 'Y', 'aceptado')`)
	e.exec(t, `insert into quotes (numero, contacto_nombre, estado, responde_hasta) values ('P-3', 'Web', 'pendiente', '2026-10-16T15:00:00Z')`)
	e.exec(t, `insert into whatsapp_conversaciones (wa_jid, bot_estado) values ('1@s', 'derivada')`)
	e.pedido(t, "L-1", e.central, "listo", "mostrador", ahoraDePrueba, nil)
	e.pedido(t, "L-2", e.central, "pendiente", "mostrador", ahoraDePrueba, nil)

	// Dos gestiones abiertas: una para hoy y una para el 30.
	cli := e.id(t, `insert into customers (nombre) values ('Constructora') returning id`)
	e.exec(t, `insert into customer_follow_ups (customer_id, asunto, etapa, proxima_accion_at) values
		($1, 'Cobrar', 'pendiente', '2026-10-15T12:00:00Z'), ($1, 'Cheque', 'pendiente', '2026-10-30T12:00:00Z')`, cli)

	por, _ := pendientesDelInicio(t, adm, e.u+"inicio/pendientes")
	if por["recepciones-sin-factura"].Cantidad != 1 || por["recepciones-sin-factura"].Href != "/admin/recepciones?estado=sin-factura" {
		t.Errorf("recepciones sin factura: %+v", por["recepciones-sin-factura"])
	}
	if por["cheques-rechazados"].Cantidad != 1 {
		t.Errorf("el informado que no se aceptó no cuenta: %+v", por["cheques-rechazados"])
	}
	enlaces := map[string]string{
		"entregar": "/admin/pedidos?estado=listo", "preparar": "/admin/pedidos?estado=por-preparar",
		"presupuestos-aceptados": "/admin/presupuestos?estado=sin-pedido", "whatsapp-sin-asignar": "/admin/whatsapp?filtro=derivadas",
	}
	for clave, href := range enlaces {
		if por[clave].Href != href {
			t.Errorf("%s lleva a %q, no a %q", clave, por[clave].Href, href)
		}
	}

	pruebas.TiendaApagada(t, e.pool)
	por, _ = pendientesDelInicio(t, ven, e.u+"inicio/pendientes")
	if por["cheques-rechazados"].Cantidad != 1 || por["cheques-rechazados"].Href != "/admin/clientes/seguimiento" {
		t.Errorf("el vendedor ve el rechazo para reclamarlo: %+v", por["cheques-rechazados"])
	}
	if por["seguimiento"].Cantidad != 1 || por["gestiones"].Cantidad != 1 || por["gestiones"].Urgente {
		t.Errorf("gestiones del vendedor: %+v / %+v", por["seguimiento"], por["gestiones"])
	}
	if !por["presupuestos-por-responder"].Urgente || por["presupuestos-por-responder"].Cantidad != 1 {
		t.Errorf("el presupuesto que entró es lo primero del vendedor: %+v", por["presupuestos-por-responder"])
	}
	if _, hay := por["catalogo-foto"]; hay {
		t.Errorf("la carga del catálogo no es del vendedor: %+v", por["catalogo-foto"])
	}
	porAdm, _ := pendientesDelInicio(t, adm, e.u+"inicio/pendientes")
	if _, hay := porAdm["catalogo-foto"]; !hay {
		t.Errorf("el admin sí ve la carga del catálogo")
	}
}

// «Debo» separa lo recibido con remito sin factura de los saldos iniciales
// y ajustes (M3S1-029): con todo facturado, «sin factura» no es remitos.
func TestDeboSeparaLosRemitosDeLosAjustes(t *testing.T) {
	e := armar(t)
	prov := e.id(t, `insert into suppliers (nombre) values ('Tableros Costa') returning id`)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, detalle) values ($1, 'ajuste', 85000, 'Saldo inicial')`, prov)
	r := e.id(t, `insert into goods_receipts (supplier_id, branch_id, estado, numero_remito) values ($1, $2, 'confirmada', '9') returning id`, prov, e.central)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, detalle, goods_receipt_id) values ($1, 'factura', 1210, 'Recepción de mercadería', $2)`, prov, r)
	d, err := e.s.Debo(t.Context(), ahoraDePrueba)
	if err != nil {
		t.Fatal(err)
	}
	if d.SinFactura != 86210 || d.RemitosSinFactura != 1210 {
		t.Fatalf("sin factura %v, remitos %v", d.SinFactura, d.RemitosSinFactura)
	}
	f := e.id(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision, receipt_id)
		values ($1, 'factura_a', 1, 1, 1000, 210, 0, 0, 0, 1210, '2026-10-10T00:00:00Z', $2) returning id`, prov, r)
	e.exec(t, `insert into purchase_invoice_receipts (purchase_invoice_id, goods_receipt_id) values ($1, $2) on conflict do nothing`, f, r)
	if d, err = e.s.Debo(t.Context(), ahoraDePrueba); err != nil {
		t.Fatal(err)
	}
	if d.RemitosSinFactura != 0 || d.SinFactura != 85000 {
		t.Fatalf("facturado: sin factura %v, remitos %v", d.SinFactura, d.RemitosSinFactura)
	}
}
