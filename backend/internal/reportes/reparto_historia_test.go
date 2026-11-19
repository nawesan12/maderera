package reportes

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
)

// reciboDeAntes es un recibo de antes de la 00131: sin reparto fijado.
func (e *entorno) reciboDeAntes(t *testing.T, cliente *string, numero, cuando string, medio string, importe float64) string {
	t.Helper()
	id := e.id(t, `insert into receipts (numero, customer_id, recibido_de, total, origen, created_at) values ($1, $2, 'Cliente', $3, 'panel', $4) returning id`,
		numero, cliente, importe, cuando)
	e.exec(t, `insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, $2, $3, 0)`, id, medio, importe)
	return id
}

func (e *entorno) repartoGuardado(t *testing.T, recibo string) *string {
	t.Helper()
	var r *string
	if err := e.pool.QueryRow(context.Background(), `select reparto_deudores::text || ' ' || reparto_anticipo::text || ' ' || reparto_b::text from receipts where id = $1`, recibo).Scan(&r); err != nil {
		t.Fatal(err)
	}
	return r
}

// **La seña de octubre se reparte con lo que había en octubre.** Un recibo
// de antes de la 00131 es la seña de un pedido que en octubre estaba
// abierto; en diciembre el pedido se entrega y se factura con CAE. Con el
// estado de hoy la seña caía entera al B y la factura dejaba Deudores
// abierto para siempre. Además, mirar el cierre ya no escribe: el reparto se
// fija con «mjbj repartos», y da lo mismo antes o después de diciembre.
func TestLaSenaViejaSeReparteConSuFecha(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Seña vieja') returning id`)
	pedido := e.pedido(t, "P-40", e.central, "pendiente", "mostrador", time.Date(2026, 10, 1, 12, 0, 0, 0, Argentina), &cli)
	e.exec(t, `update orders set total = 1000 where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado, created_at) values ($1, 'pendiente', '2026-10-01T15:00:00Z')`, pedido)
	sena := e.reciboDeAntes(t, &cli, "REC-0040", "2026-10-10T15:00:00Z", "efectivo", 300)

	// Diciembre: se entrega y se factura. Recién después se mira octubre
	// por primera vez.
	e.exec(t, `update orders set estado = 'entregado' where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado, created_at) values ($1, 'entregado', '2026-12-05T15:00:00Z')`, pedido)
	e.facturaConCae(t, &cli, 40, 1000, "2026-12-05T15:00:00Z", &pedido)
	e.recibir(t, &cli, "REC-0041", "2026-12-06T15:00:00Z", [2]any{"efectivo", 700.0})

	octubre := e.asientosDe(t, "2026-10")
	if b := buscarAsiento(DelCircuito(octubre, CircuitoNegro), "Recibo REC-0040"); b != nil {
		t.Fatalf("la seña cayó al B: %+v", b)
	}
	if a := cuenta(DelCircuito(octubre, "blanco"), Cuentas.AnticiposDeClientes); a != -300 {
		t.Fatalf("Anticipos de octubre: %v", a)
	}
	if r := e.repartoGuardado(t, sena); r != nil {
		t.Fatalf("mirar el cierre escribió el reparto: %s", *r)
	}
	diciembre := e.asientosDe(t, "2026-12")
	if d := redondear(cuenta(octubre, Cuentas.Deudores) + cuenta(diciembre, Cuentas.Deudores)); d != 0 {
		t.Fatalf("Deudores tras la factura y el saldo: %v", d)
	}

	// El comando fija lo mismo que se veía, y repetirlo no cambia nada.
	for i := 0; i < 2; i++ {
		if err := pgx.BeginFunc(context.Background(), e.pool, func(tx pgx.Tx) error {
			_, err := cobros.FijarRepartosDeAntes(context.Background(), tx)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	if r := e.repartoGuardado(t, sena); r == nil || *r != "0.00 300.00 0.00" {
		t.Fatalf("fijado: %v", r)
	}
}

// **La seña queda atada a su pedido.** El pedido se entregó sin factura: su
// seña no cancela la próxima venta blanca del cliente (antes el pago real de
// esa venta iba al B), y el cierre la marca como anticipo sin aplicar.
// Y un pago de cuenta con un acopio chico abierto no es todo seña: el
// anticipo llega hasta lo que falta facturar.
func TestLaSenaNoCancelaOtraVenta(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	cli := e.id(t, `insert into customers (nombre) values ('Atado') returning id`)
	pedido := e.pedido(t, "P-50", e.central, "pendiente", "mostrador", time.Date(2026, 10, 1, 12, 0, 0, 0, Argentina), &cli)
	e.exec(t, `update orders set total = 300 where id = $1`, pedido)
	e.recibir(t, &cli, "R-SEÑA", "2026-10-02T15:00:00Z", [2]any{"efectivo", 300.0})
	e.exec(t, `update orders set estado = 'entregado' where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado, created_at) values ($1, 'entregado', '2026-10-05T15:00:00Z')`, pedido)

	e.facturaConCae(t, &cli, 50, 1000, "2026-10-10T15:00:00Z", nil)
	pago := e.recibir(t, &cli, "R-PAGO", "2026-10-12T15:00:00Z", [2]any{"transferencia", 1000.0})
	if r := e.repartoGuardado(t, pago); r == nil || *r != "1000.00 0.00 0.00" {
		t.Fatalf("el pago de la venta blanca: %v", r)
	}
	octubre := e.asientosDe(t, "2026-10")
	if buscarAsiento(octubre, "Aplica anticipo") != nil {
		t.Fatal("la seña se aplicó a otra venta")
	}
	_, pend, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	if !strings.Contains(pend, `"clave":"anticipos-sin-aplicar"`) || !strings.Contains(pend, `"clave":"senas-del-mes"`) {
		t.Fatalf("pendientes: %s", pend)
	}

	// El acopio de 200 abierto y un pago de 1000 sin nada facturado: 200 de
	// anticipo, 800 al B.
	acopio := e.pedido(t, "P-51", e.central, "listo", "mostrador", time.Date(2026, 10, 20, 12, 0, 0, 0, Argentina), &cli)
	e.exec(t, `update orders set total = 200 where id = $1`, acopio)
	cuenta := e.recibir(t, &cli, "R-CUENTA", "2026-10-21T15:00:00Z", [2]any{"efectivo", 1000.0})
	if r := e.repartoGuardado(t, cuenta); r == nil || *r != "0.00 200.00 800.00" {
		t.Fatalf("el pago de cuenta: %v", r)
	}
}

// **El motor y el CSV ven el mismo Deudores.** Un pedido facturado y pagado
// por Mercado Pago sin recibo, con un reintegro parcial de 200: el CSV
// asienta el tramo y el motor no lo veía, así que el recibo con que el
// cliente paga esos 200 iba al B y Deudores quedaba abierto en el CSV.
func TestElReintegroParcialSinRecibo(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Reintegro') returning id`)
	pedido := e.pedido(t, "P-60", e.central, "entregado", "tienda", time.Date(2026, 10, 1, 12, 0, 0, 0, Argentina), &cli)
	e.facturaConCae(t, &cli, 60, 1000, "2026-10-01T15:00:00Z", &pedido)
	pago := e.id(t, `insert into payments (order_id, customer_id, tipo, proveedor, medio, monto, estado, acreditado_at, created_at)
		values ($1, $2, 'pedido', 'mercado_pago', 'visa', 1000, 'aprobado', '2026-10-02T15:00:00Z', '2026-10-02T15:00:00Z') returning id`, pedido, cli)
	e.exec(t, `insert into payment_refunds (payment_id, importe, acumulado, created_at) values ($1, 200, 200, '2026-10-05T15:00:00Z')`, pago)
	recibo := e.recibir(t, &cli, "R-200", "2026-10-08T15:00:00Z", [2]any{"efectivo", 200.0})
	if r := e.repartoGuardado(t, recibo); r == nil || *r != "200.00 0.00 0.00" {
		t.Fatalf("el recibo de lo devuelto: %v", r)
	}
	octubre := e.asientosDe(t, "2026-10")
	ev, err := cobros.CargarEventos(context.Background(), e.pool, time.Date(2026, 11, 1, 0, 0, 0, 0, Argentina), "c:"+cli)
	if err != nil {
		t.Fatal(err)
	}
	motor := cobros.RepartirCobros(ev).Deudores["c:"+cli]
	if csv := cuenta(DelCircuito(octubre, "blanco"), Cuentas.Deudores); csv != motor || csv != 0 {
		t.Fatalf("Deudores: CSV %v, motor %v", csv, motor)
	}
}
