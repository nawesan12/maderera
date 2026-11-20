package reportes

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Una tercera sucursal activa aparece sola en el inicio: en lo que hay que
// reponer y en las ventas de cada mes, en el orden de branches (hallazgo
// 35). La inactiva no aparece.
func TestElInicioConUnaSucursalNueva(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, tirante := e.catalogo(t)
	puerto := e.id(t, `insert into branches (slug, name, sort_order) values ('puerto', 'Puerto', 3) returning id`)
	cerrada := e.id(t, `insert into branches (slug, name, sort_order, active) values ('cerrada', 'Cerrada', 4, false) returning id`)
	e.exec(t, `insert into inventory (variant_id, branch_id, qty, min_qty) values ($1, $2, 1, 5), ($3, $2, 2, 5), ($1, $4, 0, 5)`, placa, puerto, tirante, cerrada)
	e.pedido(t, "P-1", puerto, "entregado", "mostrador", time.Date(2026, 10, 3, 10, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 750.0, nil})
	e.pedido(t, "P-2", cerrada, "entregado", "mostrador", time.Date(2026, 10, 4, 10, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 90.0, nil})

	_, b, _ := pedir(t, adm, e.u+"inicio/metricas?periodo=mes")
	var m Metricas
	_ = json.Unmarshal([]byte(b), &m)
	quiero := []CantidadDeSucursal{{"casa-central", "Casa Central", 1}, {"aserradero", "Aserradero", 0}, {"puerto", "Puerto", 2}}
	if len(m.ReponerPorSucursal) != len(quiero) || m.Reponer != 3 || m.ReponerCentral != 1 || m.ReponerAserradero != 0 {
		t.Fatalf("reponer: %s", b)
	}
	for i := range quiero {
		if m.ReponerPorSucursal[i] != quiero[i] {
			t.Errorf("reponer %d: %+v, quería %+v", i, m.ReponerPorSucursal[i], quiero[i])
		}
	}

	_, b, _ = pedir(t, adm, e.u+"inicio/ventas-por-sucursal")
	var meses []VentasDelMes
	_ = json.Unmarshal([]byte(b), &meses)
	if len(meses) != 6 || strings.Contains(b, "cerrada") {
		t.Fatalf("ventas: %s", b)
	}
	oct := meses[5]
	if oct.Mes != "Oct" || len(oct.Sucursales) != 3 || oct.Sucursales[2] != (VentaDeSucursal{"puerto", "Puerto", 750}) || oct.Central != 0 {
		t.Errorf("octubre: %+v", oct)
	}
}
