package reportes

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
	"mjbj/internal/reglas"
)

// reciboDe es recibir con el pedido atado antes de fijar el reparto, como
// cobros.CobrarPedido.
func (e *entorno) reciboDe(t *testing.T, cliente, pedido *string, numero, cuando string, partes ...[2]any) (string, cobros.Reparto) {
	t.Helper()
	total := 0.0
	for _, p := range partes {
		total += p[1].(float64)
	}
	id := e.id(t, `insert into receipts (numero, customer_id, order_id, recibido_de, total, origen, created_at)
		values ($1, $2, $3, 'Cliente', $4, 'panel', $5) returning id`, numero, cliente, pedido, total, cuando)
	for i, p := range partes {
		e.exec(t, `insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, $2, $3, $4)`, id, p[0], p[1], i)
	}
	var rep cobros.Reparto
	if err := pgx.BeginFunc(context.Background(), e.pool, func(tx pgx.Tx) error {
		var err error
		rep, err = cobros.FijarReparto(context.Background(), tx, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return id, rep
}

// Lo que no tiene destino, con las dos salidas de las reglas (H374, H407):
// al B (el de arranque) o a Anticipos de clientes, aplicado a la factura
// cuando sale con CAE. Con Anticipos, el cierre no marca ni cobros en el B
// de ventas facturadas después ni recibos partidos.
func TestLoSinDestinoVaAlBOAAnticipos(t *testing.T) {
	for _, regla := range []string{"circuito_b", "anticipos"} {
		t.Run(regla, func(t *testing.T) {
			e := armar(t)
			ctx := context.Background()
			adm := e.staff(t, "admin@prueba.test", "admin")
			for _, r := range []string{reglas.CobroAntesDeFacturar, reglas.ExcedenteCuentaCorriente} {
				if err := reglas.Fijar(ctx, e.pool, r, regla); err != nil {
					t.Fatal(err)
				}
			}

			// Paz: pedido entregado sin factura, cobrado por transferencia y
			// facturado con CAE al otro día.
			paz := e.id(t, `insert into customers (nombre) values ('Paz') returning id`)
			pedido := e.pedido(t, "PED-1107", e.central, "entregado", "mostrador", time.Date(2026, 10, 3, 12, 0, 0, 0, Argentina), &paz)
			e.exec(t, `update orders set total = 824440 where id = $1`, pedido)
			e.exec(t, `insert into order_status_history (order_id, estado, created_at) values ($1, 'entregado', '2026-10-03T15:00:00Z')`, pedido)
			_, rep := e.reciboDe(t, &paz, &pedido, "REC-0037", "2026-10-04T15:00:00Z", [2]any{"transferencia", 824440.0})
			e.facturaConCae(t, &paz, 71, 824440, "2026-10-05T15:00:00Z", &pedido)

			// Constructora: una factura A esperando el CAE por 755.000, y un
			// cobro a cuenta de 768.000.
			cons := e.id(t, `insert into customers (nombre) values ('Constructora') returning id`)
			e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado,
				fecha_emision, created_at, customer_id) values ('factura_a', 15, 9, 'Constructora', 623966.94, 131033.06, 0, 0, 0, 755000, 'emitida',
				'2026-10-05T15:00:00Z', '2026-10-05T15:00:00Z', $1)`, cons)
			_, repCons := e.reciboDe(t, &cons, nil, "REC-0040", "2026-10-06T15:00:00Z", [2]any{"transferencia", 500000.0}, [2]any{"efectivo", 268000.0})

			octubre := e.asientosDe(t, "2026-10")
			b := DelCircuito(octubre, CircuitoNegro)
			_, cuerpo, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
			p := pendientesDe(t, cuerpo)
			var marcado bool
			_ = e.pool.QueryRow(ctx, `select anticipo_por_regla from receipts where numero = 'REC-0037'`).Scan(&marcado)

			if regla == "circuito_b" {
				if rep.B != 824440 || repCons.B != 13000 || marcado {
					t.Fatalf("al B: %+v %+v %v", rep, repCons, marcado)
				}
				if _, ok := p["b-facturadas-despues"]; !ok {
					t.Errorf("sin la marca de la venta facturada después: %s", cuerpo)
				}
				if _, ok := p["recibos-partidos"]; !ok {
					t.Errorf("sin la marca del recibo partido: %s", cuerpo)
				}
				if cuenta(b, Cuentas.VentasSinFactura) != -(824440 + 13000) {
					t.Errorf("ventas sin factura del B: %v", cuenta(b, Cuentas.VentasSinFactura))
				}
				return
			}
			if rep.B != 0 || rep.Anticipo != 824440 || repCons.B != 0 || repCons.Anticipo != 768000 || !marcado {
				t.Fatalf("a Anticipos: %+v %+v %v", rep, repCons, marcado)
			}
			for _, clave := range []string{"b-facturadas-despues", "recibos-partidos", "banco-b", "anticipos-sin-aplicar"} {
				if _, ok := p[clave]; ok {
					t.Errorf("con Anticipos no va %q: %s", clave, cuerpo)
				}
			}
			if len(b) != 0 {
				t.Errorf("nada al B: %+v", b)
			}
			// El cobro de Paz se aplicó a su factura: Anticipos queda en lo de
			// la Constructora (la factura sin CAE no debitó Deudores todavía).
			if a := buscarAsiento(octubre, "Aplica anticipo"); a == nil || cuenta([]Asiento{*a}, Cuentas.AnticiposDeClientes) != 824440 {
				t.Errorf("aplicación: %+v", a)
			}
			if n := cuenta(octubre, Cuentas.AnticiposDeClientes); n != -768000 {
				t.Errorf("Anticipos: %v", n)
			}
			// Los 13.000 de más son un saldo a favor que espera la próxima
			// factura, no una seña.
			if s, ok := p["saldos-a-favor"]; !ok || !strings.Contains(s.Detalle, "13.000") || s.Donde != "/admin/clientes/"+cons {
				t.Errorf("saldo a favor: %s", cuerpo)
			}
			// Llega el CAE de la A y otra factura de la Constructora: el saldo
			// a favor se le aplica a la otra.
			e.exec(t, `update invoices set cae = '7613', estado = 'autorizada' where numero = 9 and punto_venta = 15`)
			e.facturaConCae(t, &cons, 72, 13000, "2026-10-20T15:00:00Z", nil)
			octubre = e.asientosDe(t, "2026-10")
			if n := cuenta(octubre, Cuentas.AnticiposDeClientes); n != 0 {
				t.Errorf("Anticipos con todo aplicado: %v", n)
			}
			if n := cuenta(octubre, Cuentas.Deudores); n != 0 {
				t.Errorf("Deudores con todo cobrado: %v", n)
			}
		})
	}
}
