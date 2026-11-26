package reportes

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func pendientesDe(t *testing.T, cuerpo string) map[string]PendienteDelCierre {
	t.Helper()
	var lista []PendienteDelCierre
	if err := json.Unmarshal([]byte(cuerpo), &lista); err != nil {
		t.Fatal(cuerpo)
	}
	out := map[string]PendienteDelCierre{}
	for _, p := range lista {
		out[p.Clave] = p
	}
	return out
}

// El cobro de una cuenta corriente con facturas emitidas que esperan el CAE
// no es una seña: va como «Cobros de facturas sin CAE», sin el consejo del
// IVA, y lleva a Facturación (simulación del mes, H131/H155). Y el pedido
// entregado con su factura esperando el CAE no deja la seña «sin aplicar»
// (H353): las dos situaciones iguales se tratan igual.
func TestCierreCobrosDeFacturasSinCae(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	cuenta := e.id(t, `insert into customers (nombre) values ('Constructora') returning id`)
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado,
		fecha_emision, created_at, customer_id) values ('factura_a', 15, 9, 'Constructora', 1000, 210, 0, 0, 0, 1210, 'emitida', '2026-10-05T15:00:00Z',
		'2026-10-05T15:00:00Z', $1)`, cuenta)
	e.recibir(t, &cuenta, "REC-0001", "2026-10-10T15:00:00Z", [2]any{"transferencia", 1210.0})

	herrera := e.id(t, `insert into customers (nombre) values ('Herrera') returning id`)
	pedido := e.pedido(t, "PED-1057", e.central, "pendiente", "mostrador", time.Date(2026, 10, 1, 12, 0, 0, 0, Argentina), &herrera)
	e.exec(t, `update orders set total = 500 where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado, created_at) values ($1, 'pendiente', '2026-10-01T15:00:00Z')`, pedido)
	e.recibir(t, &herrera, "REC-0019", "2026-10-02T15:00:00Z", [2]any{"efectivo", 500.0})
	e.exec(t, `update orders set estado = 'entregado' where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado, created_at) values ($1, 'entregado', '2026-10-03T15:00:00Z')`, pedido)
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado,
		fecha_emision, created_at, customer_id, order_id) values ('factura_b', 15, 66, 'Herrera', 413.22, 86.78, 0, 0, 0, 500, 'emitida', '2026-10-03T15:00:00Z',
		'2026-10-03T15:00:00Z', $1, $2)`,
		herrera, pedido)

	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	p := pendientesDe(t, cuerpo)
	cobro, ok := p["cobros-sin-cae"]
	if !ok || cobro.Cantidad != 1 || !strings.Contains(cobro.Detalle, "1.210") || !strings.Contains(cobro.Donde, "/admin/facturacion") {
		t.Fatalf("cobros de facturas sin CAE: %s", cuerpo)
	}
	if s, ok := p["senas-del-mes"]; !ok || s.Cantidad != 1 || s.Donde != "/admin/clientes/"+herrera {
		t.Fatalf("la seña de Herrera es la única seña, con su ficha: %s", cuerpo)
	}
	if _, ok := p["anticipos-sin-aplicar"]; ok {
		t.Fatalf("la seña de un pedido con la factura esperando el CAE no está sin aplicar: %s", cuerpo)
	}
}
