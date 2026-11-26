package mostrador

import (
	"context"
	"testing"

	"mjbj/internal/sqlc"
)

// Lo que el mes simulado encontró al cobrar:
//
//   - H018: seis fenólicos a $100 con un costo de $75.000 se cobraban sin
//     decir nada. Ahora piden la firma de un admin, «abajo del costo».
//   - H168: el descuento del 10 % por efectivo se repartía también en el
//     flete cargado a mano.
//   - H025: con el pago partido en medios distintos el descuento no corre
//     desde que se parte, aunque un medio todavía no tenga importe.
func TestCobrosDelMesSimulado(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000)

	// Bajo el costo: la placa está a $45.000,50 en la lista y cuesta $50.000.
	if _, err := e.pool.Exec(ctx, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 10, 50000)`, e.placa); err != nil {
		t.Fatal(err)
	}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", e.venta("debito", e.lineaPlaca(2)))
	a, _ := m["autorizacion"].(map[string]any)
	if st != 200 || m["ok"] != false || a == nil || a["motivo"] != "costo" || a["monto"] != 9999.0 {
		t.Fatalf("bajo el costo sin aviso: %d %s", st, b)
	}
	if _, err := e.pool.Exec(ctx, `delete from variant_costs`); err != nil {
		t.Fatal(err)
	}

	// El 10 % por efectivo no toca el flete a mano.
	if _, err := e.pool.Exec(ctx, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta) values ('efectivo', 0, 10, '10% en efectivo')`); err != nil {
		t.Fatal(err)
	}
	flete := map[string]any{"variantId": nil, "descripcion": "Flete a domicilio", "unidad": "unidad", "cantidad": 1, "precioUnitario": 15000}
	st, m, b = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", e.venta("efectivo", e.lineaPlaca(2), flete))
	if st != 200 || m["ok"] != true {
		t.Fatalf("venta con flete: %d %s", st, b)
	}
	// 2 × 45.000,50 = 90.001 − 10 % = 81.000,90, más el flete entero.
	if m["total"] != 96000.9 {
		t.Errorf("total: %v", m["total"])
	}
	if p := e.num(t, `select precio_unitario::float8 from order_items where order_id = $1 and descripcion = 'Flete a domicilio'`, m["orderId"]); p != 15000 {
		t.Errorf("el flete se guardó a %v", p)
	}

	// Pago partido en dos medios, con el segundo todavía vacío: sin escala.
	v := e.venta("efectivo", e.lineaPlaca(1))
	v["sinEscala"] = true
	st, m, b = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != true || m["total"] != 45000.5 {
		t.Errorf("partido sin escala: %d %s", st, b)
	}
}
