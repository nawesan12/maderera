package reportes

import (
	"context"
	"testing"
)

// M3S2-012: un cheque cargado sin cliente nunca entró a Valores a
// depositar: su acreditación no se asienta (descuadraba la cuenta) y el
// cierre lo marca como pendiente.
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
		hay = hay || x.Clave == "cheques-sin-origen"
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
	// El saldo inicial migrado no es un ajuste del mes.
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, detalle, referencia, created_at) values ($1, 'ajuste', 1000, 'Saldo inicial', 'SALDO-INICIAL-PROV', '2026-10-10T15:00:00Z')`, prov)
	octubre := e.asientosDe(t, "2026-10")
	if v := SaldoDeCuenta(octubre, Cuentas.Proveedores); v != 32442.12 {
		t.Errorf("Proveedores: %v", v)
	}
	if v := SaldoDeCuenta(octubre, Cuentas.AjustesConProveedores); v != -32442.12 {
		t.Errorf("Ajustes con proveedores: %v", v)
	}
}
