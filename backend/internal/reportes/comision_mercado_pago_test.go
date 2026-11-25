package reportes

import (
	"context"
	"testing"
	"time"

	"mjbj/internal/cobros"
)

// Las comisiones de Mercado Pago no tenían asiento: Banco recibía el bruto y
// el extracto mostraba menos que los libros. Un pago de $1000 con $60 de
// comisión debita Banco $940 y Comisiones $60, contra Deudores $1000; sin
// comisión el asiento es el de siempre.
func TestComisionDeMercadoPagoEnElCierre(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre, razon_social) values ('Ana Gómez', 'Gómez SA') returning id`)
	// Lo facturado que el recibo cancela: el cobro va entero al blanco.
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, customer_id)
		values ('factura_a', 3, 300, 'Gómez SA', 826.45, 173.55, 0, 0, 0, 1000, 'autorizada', '2026-10-01T15:00:00Z', '76123456789021', $1)`, cliente)
	// El pago de la cuenta corriente por Mercado Pago, con su recibo.
	deuda := e.id(t, `insert into payments (customer_id, tipo, proveedor, medio, monto, estado, comision, neto_acreditado, acreditado_at)
		values ($1, 'deuda', 'mercado_pago', 'visa', 1000, 'aprobado', 60, 940, '2026-10-10T15:00:00Z') returning id`, cliente)
	recibo := e.id(t, `insert into receipts (numero, customer_id, recibido_de, total, estado, origen, created_at)
		values ('REC-0101', $1, 'Gómez SA', 1000, 'emitido', 'mercado_pago', '2026-10-10T15:00:00Z') returning id`, cliente)
	e.exec(t, `insert into receipt_parts (receipt_id, medio, importe, orden, payment_id) values ($1, 'mercado_pago', 1000, 0, $2)`, recibo, deuda)

	// Un pedido en línea pagado con Mercado Pago y facturado: sin recibo.
	enLinea := func(numero string, nro int, estado string, comision any) {
		dia := time.Date(2026, 10, 12+nro-301, 12, 0, 0, 0, Argentina)
		pedido := e.pedido(t, numero, e.central, "entregado", "tienda", dia, &cliente)
		e.exec(t, `insert into payments (order_id, customer_id, tipo, proveedor, medio, monto, estado, comision, acreditado_at, created_at, updated_at)
			values ($1, $2, 'pedido', 'mercado_pago', 'visa', 1000, $3, $4, $5, $5, $6)`, pedido, cliente, estado, comision, dia, dia.Add(48*time.Hour))
		e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
			values ('factura_b', 3, $2::int, 'Gómez SA', 826.45, 173.55, 0, 0, 0, 1000, 'autorizada', $3, '7612345678' || $2::text, $1)`, pedido, nro, dia)
	}
	enLinea("W-0001", 301, "aprobado", 60)
	enLinea("W-0002", 302, "reintegrado", 60)
	enLinea("W-0003", 303, "aprobado", nil) // de antes: sin el dato

	p := PeriodoDelCierre("2026-10", ahoraDePrueba)
	asientos, err := e.s.AsientosDelPeriodo(ctx, p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range asientos {
		if !a.Balancea {
			t.Errorf("no cierra: %+v", a)
		}
	}
	conComision := []RenglonDeAsiento{renglon(Cuentas.Banco, 940, 0), renglon(Cuentas.Comisiones, 60, 0), renglon(Cuentas.Deudores, 0, 1000)}
	igual := func(a *Asiento, r []RenglonDeAsiento) bool {
		if a == nil || len(a.Renglones) != len(r) {
			return false
		}
		for i := range r {
			if a.Renglones[i] != r[i] {
				return false
			}
		}
		return true
	}
	if a := buscarAsiento(asientos, "Recibo REC-0101"); !igual(a, conComision) {
		t.Errorf("el recibo de Mercado Pago: %+v", a)
	}
	if a := buscarAsiento(asientos, "Cobro Factura B 0003-00000301"); !igual(a, conComision) {
		t.Errorf("el pedido en línea: %+v", a)
	}
	// El reintegrado entero: el cobro y su espejo, con la comisión.
	if a := buscarAsiento(asientos, "Cobro Factura B 0003-00000302"); !igual(a, conComision) {
		t.Errorf("el cobro del reintegrado: %+v", a)
	}
	if a := buscarAsiento(asientos, "Reintegro Factura B 0003-00000302"); !igual(a, []RenglonDeAsiento{renglon(Cuentas.Deudores, 1000, 0),
		renglon(Cuentas.Banco, 0, 940), renglon(Cuentas.Comisiones, 0, 60)}) {
		t.Errorf("el reintegro: %+v", a)
	}
	// Sin el dato, el de siempre.
	if a := buscarAsiento(asientos, "Cobro Factura B 0003-00000303"); !igual(a, []RenglonDeAsiento{renglon(Cuentas.Banco, 1000, 0), renglon(Cuentas.Deudores, 0, 1000)}) {
		t.Errorf("sin comisión: %+v", a)
	}
	if c := SaldoDeCuenta(asientos, Cuentas.Comisiones); c != 120 {
		t.Errorf("Comisiones: %v", c)
	}
}

// La comisión de una parte que el reparto deja entre los dos circuitos se
// reparte como la parte.
func TestComisionEnUnReciboRepartido(t *testing.T) {
	partes := []ParteDeRecibo{{Medio: "mercado_pago", Importe: 1000, Comision: 60}}
	rep := cobros.Reparto{Deudores: 500, B: 500}
	as := AsientosDeRecibo(ReciboAAsentar{Numero: "R-1", Cliente: "X", Partes: partes, Reparto: &rep})
	for _, a := range as {
		if !a.Balancea {
			t.Errorf("no cierra: %+v", a)
		}
	}
	if len(as) != 2 || as[0].Renglones[0] != renglon(Cuentas.Banco, 470, 0) || as[0].Renglones[1] != renglon(Cuentas.Comisiones, 30, 0) ||
		as[1].Renglones[0] != renglon(Cuentas.Banco, 470, 0) || as[1].Renglones[1] != renglon(Cuentas.Comisiones, 30, 0) {
		t.Errorf("%+v", as)
	}
	// La anulación, al revés.
	an := AsientosDeRecibo(ReciboAAsentar{Numero: "R-1", Cliente: "X", Partes: partes, Reparto: &rep, Anulacion: true})
	if an[0].Renglones[1] != renglon(Cuentas.Comisiones, 0, 30) {
		t.Errorf("anulación: %+v", an)
	}
}
