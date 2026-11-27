package reportes

import "testing"

// M3S3-013: las bajas y altas de stock sin venta asientan su costo contra
// Mercaderías. La reposición sin cargo a un cliente es costo de lo vendido;
// el resto, diferencias de inventario. Lo que no es un ajuste (una venta, un
// traslado) no se asienta acá.
func TestAjustesDeStockEnLosAsientos(t *testing.T) {
	e := armar(t)
	placa, _ := e.catalogo(t)
	pedido := e.id(t, `insert into orders (numero, contacto_nombre, branch_id, estado, total) values ('PED-1312', 'Gabriel Ortiz', $1, 'entregado', 1) returning id`, e.central)
	e.exec(t, `insert into inventory_movements (variant_id, branch_id, type, qty, note, costo_unitario, created_at, documento_tipo, documento_id) values
		($1, $2, 'egreso', -1, 'Rotura desde Stock (10 → 9)', 6619.30, '2026-11-10T15:00:00Z', null, null),
		($1, $2, 'egreso', -2, 'Faltante desde Stock (9 → 7)', 6619.30, '2026-11-11T15:00:00Z', null, null),
		($1, $2, 'ingreso', 2, 'Ingreso desde Stock (7 → 9)', 6619.30, '2026-11-11T16:00:00Z', null, null),
		($1, $2, 'egreso', -1, 'Reposición a cliente desde Stock (9 → 8) · PED-1312 · Gabriel Ortiz', 6619.30, '2026-11-12T15:00:00Z', 'pedido', $3),
		($1, $2, 'venta', -1, 'Venta PED-1300', null, '2026-11-12T16:00:00Z', null, null),
		($1, $2, 'transferencia_salida', -1, 'Traslado TRA-0001 a Aserradero', null, '2026-11-12T17:00:00Z', null, null)`,
		placa, e.central, pedido)
	a := DelCircuito(e.asientosDe(t, "2026-11"), "")
	if n := cuenta(a, Cuentas.Mercaderias); n != -13238.60 {
		t.Errorf("Mercaderías baja lo que salió sin venta: %v", n)
	}
	if n := cuenta(a, Cuentas.DiferenciasDeInventario); n != 6619.30 {
		t.Errorf("diferencias de inventario: %v", n)
	}
	if x := buscarAsiento(a, "Reposición a cliente · Fenólico 18 mm · Casa Central"); x == nil || cuenta([]Asiento{*x}, Cuentas.CostoDeVentas) != 6619.30 {
		t.Errorf("la reposición: %+v", x)
	}
	if x := buscarAsiento(a, "Rotura · Fenólico 18 mm · Casa Central"); x == nil || !x.Balancea {
		t.Errorf("la rotura: %+v", x)
	}
	if x := buscarAsiento(a, "Ingreso · Fenólico 18 mm · Casa Central"); x == nil || cuenta([]Asiento{*x}, Cuentas.Mercaderias) != 13238.60 {
		t.Errorf("el alta: %+v", x)
	}
}
