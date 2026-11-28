package reportes

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Recorrido 2, M4-116: en producción no hay certificado de ARCA, así que
// ninguna factura tiene CAE. La seña de Obra (589.700) nombraba su factura
// sin CAE de 48.400 y su pedido abierto de 826.800: el aviso «Cobros de
// facturas sin CAE» se la llevaba entera. A la factura le toca hasta lo que
// vale; el resto es la seña del pedido abierto.
func TestLaSenaDelPedidoAbiertoNoEsCobroSinCae(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	obra := e.id(t, `insert into customers (nombre) values ('Obra Barrio Parque') returning id`)
	viejo := e.pedido(t, "PED-1019", e.central, "entregado", "mostrador", time.Date(2026, 11, 2, 12, 0, 0, 0, Argentina), &obra)
	e.exec(t, `update orders set total = 48400, medio_pago = 'cuenta_corriente' where id = $1`, viejo)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at) values ($1, 'compra', 48400, 'PED-1019', '2026-11-02T15:00:00Z')`, obra)
	e.facturaSinCae(t, &obra, &viejo, 30, 48400, "2026-11-02T15:00:00Z")
	abierto := e.pedido(t, "PED-1024", e.central, "pendiente", "tienda", time.Date(2026, 11, 3, 12, 0, 0, 0, Argentina), &obra)
	e.exec(t, `update orders set total = 826800, medio_pago = 'cuenta_corriente' where id = $1`, abierto)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at) values ($1, 'compra', 826800, 'PED-1024', '2026-11-03T15:00:00Z')`, obra)
	r, _ := e.reciboDe(t, &obra, nil, "REC-0008", "2026-11-04T15:00:00Z", [2]any{"transferencia", 589700.0})
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, receipt_id, created_at) values ($1, 'pago', -589700, 'REC-0008', $2, '2026-11-04T15:00:00Z')`, obra, r)

	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-11")
	p := pendientesDe(t, cuerpo)
	if c, ok := p["cobros-sin-cae"]; !ok || len(c.Casos) != 1 || *c.Casos[0].Importe != 48400 {
		t.Errorf("a la factura sin CAE le tocan 48.400: %+v", c)
	}
	if s, ok := p["senas-del-mes"]; !ok || len(s.Casos) != 1 || *s.Casos[0].Importe != 541300 {
		t.Errorf("el resto es la seña del pedido abierto: %+v\n%s", s, cuerpo)
	}
}

// Recorrido 2 (nuevo 1): el saldo a favor que los asientos ponen en 2.1.06
// Anticipos del archivo del estudio va en esa columna del CSV de deudores, no
// en la del circuito B. Carla pagó a cuenta con un cheque de 21.000 sin deber
// nada; Carpintería Naval dejó una retención sola de 8.000.
func TestDeudoresElSaldoAFavorEnAnticiposNoEsDelB(t *testing.T) {
	e := armar(t)
	carla := e.id(t, `insert into customers (nombre) values ('Carla Diseñadora') returning id`)
	r, rep := e.reciboDe(t, &carla, nil, "REC-0019", "2026-11-20T15:00:00Z", [2]any{"cheque", 21000.0})
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, receipt_id, created_at) values ($1, 'pago', -21000, 'REC-0019', $2, '2026-11-20T15:00:00Z')`, carla, r)
	naval := e.id(t, `insert into customers (nombre) values ('Carpintería Naval') returning id`)
	r2, rep2 := e.reciboDe(t, &naval, nil, "REC-0020", "2026-11-21T15:00:00Z", [2]any{"retencion", 8000.0})
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, receipt_id, created_at) values ($1, 'pago', -8000, 'REC-0020', $2, '2026-11-21T15:00:00Z')`, naval, r2)
	if rep.Anticipo != 21000 || rep2.Anticipo != 8000 {
		t.Fatalf("van a Anticipos: %+v %+v", rep, rep2)
	}
	nov := DelCircuito(e.asientosDe(t, "2026-11"), "")
	if a := cuenta(nov, Cuentas.AnticiposDeClientes); a != -29000 {
		t.Fatalf("Anticipos del estudio %v (−29.000)", a)
	}
	d, err := e.s.CsvDeudores(context.Background(), time.Date(2026, 11, 27, 12, 0, 0, 0, Argentina))
	if err != nil {
		t.Fatal(err)
	}
	// Total −21.000; con CAE, sin CAE y pedidos en 0; Anticipos −21.000; B 0.
	if !strings.Contains(d, ";-21000,00;;0,00;0,00;0,00;-21000,00;0,00\r") || !strings.Contains(d, ";-8000,00;;0,00;0,00;0,00;-8000,00;0,00\r") {
		t.Errorf("deudores:\n%s", d)
	}
}
