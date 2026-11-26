package reportes

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"mjbj/internal/reglas"
)

// Cuándo cuenta una venta según la regla (H162): las cuatro salidas, que un
// mes cerrado no cambia al cambiar la regla, y que la cancelación de una
// venta ya contada resta en su mes sin borrarla del suyo.
func TestLaVentaCuentaSegunLaRegla(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, _ := e.catalogo(t)
	octubre := time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina)
	entregado := e.pedido(t, "V-1", e.central, "entregado", "mostrador", octubre, nil, [4]any{placa, 1.0, 1210.0, 600.0})
	facturado := e.pedido(t, "V-2", e.central, "preparando", "tienda", octubre, nil, [4]any{placa, 1.0, 2420.0, 1200.0})
	e.facturaConCae(t, nil, 95, 2420, "2026-11-03T15:00:00Z", &facturado)

	vendido := func(periodo string) float64 {
		t.Helper()
		_, cuerpo, _ := pedir(t, adm, e.u+"cierre/resumen?periodo="+periodo)
		var r ResumenDelMes
		if err := json.Unmarshal([]byte(cuerpo), &r); err != nil {
			t.Fatal(cuerpo)
		}
		return r.Vendido.Total
	}
	regla := func(v string) {
		t.Helper()
		if err := reglas.Fijar(ctx, e.pool, reglas.VentaReconocida, v); err != nil {
			t.Fatal(err)
		}
	}
	mirar := func(cuando string, oct, nov float64) {
		t.Helper()
		if o, n := vendido("2026-10"), vendido("2026-11"); o != oct || n != nov {
			t.Errorf("%s: octubre %v (quería %v), noviembre %v (quería %v)", cuando, o, oct, n, nov)
		}
	}

	mirar("al entregar o facturar", 1000, 2000)
	regla("tomar")
	mirar("al tomar", 3000, 0)
	regla("facturar")
	mirar("al facturar", 0, 2000)
	regla("entregar")
	mirar("al entregar", 1000, 0)
	regla("entregar_o_facturar")
	mirar("de vuelta al de arranque", 1000, 2000)

	// Octubre cerrado: lo que contó ahí se queda, y lo que la regla nueva
	// pondría ahí cuenta en noviembre.
	e.exec(t, `insert into meses_cerrados (mes) values ('2026-10')`)
	regla("tomar")
	mirar("al tomar con octubre cerrado", 1000, 2000)
	var fecha time.Time
	if err := e.pool.QueryRow(ctx, `select vendido_at from orders where id = $1`, facturado).Scan(&fecha); err != nil {
		t.Fatal(err)
	}
	if !fecha.Equal(time.Date(2026, 11, 1, 0, 0, 0, 0, Argentina)) {
		t.Errorf("la venta que caía en octubre cerrado cuenta el %v", fecha.In(Argentina))
	}
	regla("facturar")
	mirar("al facturar con octubre cerrado", 1000, 2000)

	// Cancelar en noviembre la venta de octubre: octubre no cambia y
	// noviembre la resta.
	e.exec(t, `update orders set estado = 'cancelado', cancelado_at = '2026-11-20T15:00:00Z' where id = $1`, entregado)
	mirar("cancelada en noviembre", 1000, 1000)
	// El pedido que se cancela antes de contar no es nada en ningún mes.
	e.pedido(t, "V-3", e.central, "cancelado", "tienda", time.Date(2026, 11, 6, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 1210.0, 600.0})
	regla("entregar_o_facturar")
	mirar("cancelado sin contar", 1000, 1000)
}
