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
