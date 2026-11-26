package reportes

import (
	"strings"
	"testing"
)

// Mes simulado (H004, H102, H358): el inicio contaba filas de inventario por
// sucursal con el físico y las llamaba «productos»; Stock contaba medidas.
// Ahora es la misma regla (catalogo.MedidaParaReponer), en medidas, y el
// atajo abre la pestaña filtrada.
func TestPendienteDeReponerEsElDeStock(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, tirante := e.catalogo(t)
	// La placa: 8 disponibles en Casa Central con mínimo 20 → reponer.
	// El tirante: 100 en Casa Central y nada en el Aserradero, con mínimo 5
	// ahí → reponer (antes la sucursal en cero no contaba en Stock).
	e.exec(t, `insert into inventory (variant_id, branch_id, qty, min_qty) values ($1, $2, 0, 5)`, tirante, e.aserradero)
	// Una placa con mínimo en las dos sucursales es una sola medida.
	e.exec(t, `update inventory set min_qty = 10 where variant_id = $1 and branch_id = $2`, placa, e.aserradero)
	_, b, _ := pedir(t, adm, e.u+"inicio/pendientes")
	if !strings.Contains(b, `"clave":"reponer","cantidad":2,"texto":"medidas para reponer"`) || !strings.Contains(b, `"href":"/admin/stock?estado=reponer"`) {
		t.Errorf("pendiente: %s", b)
	}
	// Vendido de más sin mínimo también es para reponer.
	e.exec(t, `update inventory set min_qty = 0, reservado = 0`)
	e.exec(t, `update inventory set reservado = 130 where variant_id = $1 and branch_id = $2`, tirante, e.central)
	_, b, _ = pedir(t, adm, e.u+"inicio/pendientes")
	if !strings.Contains(b, `"clave":"reponer","cantidad":1,"texto":"medida para reponer"`) {
		t.Errorf("vendido de más: %s", b)
	}
}
