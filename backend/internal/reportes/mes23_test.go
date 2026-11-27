package reportes

import (
	"context"
	"testing"
)

// M3S2-012 y M3S2-004: un cheque cargado sin cliente entra a Valores a
// depositar contra Movimientos a imputar (asientosAImputar), así su
// acreditación cancela algo que existe y la cuenta cuadra; el cierre lo
// marca como pendiente de imputar.
func TestChequeSinOrigenNoSeAsienta(t *testing.T) {
	e := armar(t)
	ch := e.id(t, `insert into cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado, created_at)
		values ('recibido', 'fisico', '00099901', 'Ciudad', '2026-10-05', 50000, 'cartera', '2026-10-05T12:00:00Z') returning id`)
	e.exec(t, `update cheques set estado = 'depositado' where id = $1`, ch)
	e.exec(t, `update cheques set estado = 'acreditado' where id = $1`, ch)
	e.exec(t, `update cheque_estados set at = '2026-10-10T12:00:00Z' where cheque_id = $1`, ch)
	if v := SaldoDeCuenta(e.asientosDe(t, "2026-10"), Cuentas.ValoresADepositar); v != 0 {
		t.Errorf("Valores a depositar movido por un cheque sin origen: %v", v)
	}
	p := PeriodoDelCierre("2026-10", ahoraDePrueba)
	pendientes, err := e.s.PendientesDelCierre(context.Background(), p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	hay := false
	for _, x := range pendientes {
		hay = hay || x.Clave == "a-imputar"
	}
	if !hay {
		t.Errorf("el cierre no lo marca: %+v", pendientes)
	}
}

// M3S2-028: un ajuste a mano en la cuenta de un proveedor (la bonificación)
// tiene asiento: Proveedores del archivo coincide con la ficha.
func TestAjusteDeProveedorSeAsienta(t *testing.T) {
	e := armar(t)
	prov := e.id(t, `insert into suppliers (nombre) values ('Sim Pinturería') returning id`)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, detalle, created_at) values ($1, 'ajuste', -32442.12, 'bonificación 3 %', '2026-10-10T15:00:00Z')`, prov)
	// El saldo inicial migrado no es un ajuste: va contra Saldos iniciales
	// (M3S1-019), una sola vez.
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, detalle, referencia, created_at) values ($1, 'ajuste', 1000, 'Saldo inicial', 'SALDO-INICIAL-PROV', '2026-10-10T15:00:00Z')`, prov)
	octubre := e.asientosDe(t, "2026-10")
	if v := SaldoDeCuenta(octubre, Cuentas.Proveedores); v != 31442.12 {
		t.Errorf("Proveedores: %v", v)
	}
	if v := SaldoDeCuenta(octubre, Cuentas.AjustesConProveedores); v != -32442.12 {
		t.Errorf("Ajustes con proveedores: %v", v)
	}
	if v := SaldoDeCuenta(octubre, Cuentas.SaldosIniciales); v != 1000 {
		t.Errorf("Saldos iniciales: %v", v)
	}
}

// M2S2-043 (mes 23): el cierre de un mes cuenta también las recepciones sin
// factura de meses anteriores, como el inicio y la lista; la que cubre una
// factura de varios remitos no cuenta.
func TestElCierreCuentaLasRecepcionesSinFacturaDeAntes(t *testing.T) {
	e := armar(t)
	prov := e.id(t, `insert into suppliers (nombre) values ('Tableros') returning id`)
	e.exec(t, `insert into goods_receipts (supplier_id, branch_id, estado, numero_remito, fecha) values ($1, $2, 'confirmada', 'vieja', '2026-08-18')`, prov, e.central)
	e.exec(t, `insert into goods_receipts (supplier_id, branch_id, estado, numero_remito, fecha) values ($1, $2, 'confirmada', 'del-mes', '2026-10-05')`, prov, e.central)
	e.exec(t, `insert into goods_receipts (supplier_id, branch_id, estado, numero_remito, fecha) values ($1, $2, 'confirmada', 'despues', '2026-11-05')`, prov, e.central)
	r1 := e.id(t, `insert into goods_receipts (supplier_id, branch_id, estado, numero_remito, fecha) values ($1, $2, 'confirmada', 'a', '2026-10-06') returning id`, prov, e.central)
	r2 := e.id(t, `insert into goods_receipts (supplier_id, branch_id, estado, numero_remito, fecha) values ($1, $2, 'confirmada', 'b', '2026-09-06') returning id`, prov, e.central)
	f := e.id(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision, receipt_id)
		values ($1, 'factura_a', 3, 22044, 1000, 210, 0, 0, 0, 1210, '2026-10-10T00:00:00Z', $2) returning id`, prov, r1)
	e.exec(t, `insert into purchase_invoice_receipts (purchase_invoice_id, goods_receipt_id) values ($1, $2), ($1, $3) on conflict do nothing`, f, r1, r2)

	p := PeriodoDelCierre("2026-10", ahoraDePrueba)
	pendientes, err := e.s.PendientesDelCierre(context.Background(), p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range pendientes {
		if x.Clave == "facturas" {
			if x.Cantidad != 2 || len(x.Casos) != 2 {
				t.Errorf("recepciones sin factura: %+v", x)
			}
			return
		}
	}
	t.Errorf("el cierre no las marca: %+v", pendientes)
}
