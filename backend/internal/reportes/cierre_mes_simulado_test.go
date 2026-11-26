package reportes

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func pendientesDe(t *testing.T, cuerpo string) map[string]PendienteDelCierre {
	t.Helper()
	var lista []PendienteDelCierre
	if err := json.Unmarshal([]byte(cuerpo), &lista); err != nil {
		t.Fatal(cuerpo)
	}
	out := map[string]PendienteDelCierre{}
	for _, p := range lista {
		out[p.Clave] = p
	}
	return out
}

// El cobro de una cuenta corriente con facturas emitidas que esperan el CAE
// no es una seña: va como «Cobros de facturas sin CAE», sin el consejo del
// IVA, y lleva a Facturación (simulación del mes, H131/H155). Y el pedido
// entregado con su factura esperando el CAE no deja la seña «sin aplicar»
// (H353): las dos situaciones iguales se tratan igual.
func TestCierreCobrosDeFacturasSinCae(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	cuenta := e.id(t, `insert into customers (nombre) values ('Constructora') returning id`)
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado,
		fecha_emision, created_at, customer_id) values ('factura_a', 15, 9, 'Constructora', 1000, 210, 0, 0, 0, 1210, 'emitida', '2026-10-05T15:00:00Z',
		'2026-10-05T15:00:00Z', $1)`, cuenta)
	e.recibir(t, &cuenta, "REC-0001", "2026-10-10T15:00:00Z", [2]any{"transferencia", 1210.0})

	herrera := e.id(t, `insert into customers (nombre) values ('Herrera') returning id`)
	pedido := e.pedido(t, "PED-1057", e.central, "pendiente", "mostrador", time.Date(2026, 10, 1, 12, 0, 0, 0, Argentina), &herrera)
	e.exec(t, `update orders set total = 500 where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado, created_at) values ($1, 'pendiente', '2026-10-01T15:00:00Z')`, pedido)
	e.recibir(t, &herrera, "REC-0019", "2026-10-02T15:00:00Z", [2]any{"efectivo", 500.0})
	e.exec(t, `update orders set estado = 'entregado' where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado, created_at) values ($1, 'entregado', '2026-10-03T15:00:00Z')`, pedido)
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado,
		fecha_emision, created_at, customer_id, order_id) values ('factura_b', 15, 66, 'Herrera', 413.22, 86.78, 0, 0, 0, 500, 'emitida', '2026-10-03T15:00:00Z',
		'2026-10-03T15:00:00Z', $1, $2)`,
		herrera, pedido)

	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	p := pendientesDe(t, cuerpo)
	cobro, ok := p["cobros-sin-cae"]
	if !ok || cobro.Cantidad != 1 || !strings.Contains(cobro.Detalle, "1.210") || !strings.Contains(cobro.Donde, "/admin/facturacion") {
		t.Fatalf("cobros de facturas sin CAE: %s", cuerpo)
	}
	if s, ok := p["senas-del-mes"]; !ok || s.Cantidad != 1 || s.Donde != "/admin/clientes/"+herrera {
		t.Fatalf("la seña de Herrera es la única seña, con su ficha: %s", cuerpo)
	}
	if _, ok := p["anticipos-sin-aplicar"]; ok {
		t.Fatalf("la seña de un pedido con la factura esperando el CAE no está sin aplicar: %s", cuerpo)
	}
}

// Por producto, una fila por medida: juntas, «MDF 3mm» llevaba las de 18 mm
// (H163). El flete cobrado se informa en los totales (la diferencia con el
// inicio, H138) y suma al resultado sin IVA (H360).
func TestReportePorMedidaYEnvios(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	placa, _ := e.catalogo(t)
	otra := e.id(t, `insert into product_variants (product_id, sku, label) select product_id, 'FEN12', '12 mm' from product_variants where id = $1 returning id`, placa)
	pedido := e.pedido(t, "PED-1001", e.central, "entregado", "mostrador", time.Date(2026, 10, 2, 10, 0, 0, 0, Argentina), nil,
		[4]any{placa, 2.0, 1210.0, 500.0}, [4]any{otra, 1.0, 605.0, 250.0})
	e.exec(t, `update orders set costo_envio = 121, total = total + 121 where id = $1`, pedido)

	_, b, _ := pedir(t, adm, e.u+"reportes/ventas?corte=producto&periodo=mes")
	var rep ReporteDeVentas
	_ = json.Unmarshal([]byte(b), &rep)
	if len(rep.Filas) != 2 || *rep.Filas[0].Detalle != "18 mm" || rep.Filas[0].Cantidad != 2 || *rep.Filas[1].Detalle != "12 mm" ||
		rep.Totales.Filas != 2 || rep.Totales.Envios != 121 {
		t.Fatalf("por medida: %s", b)
	}
	_, b, _ = pedir(t, adm, e.u+"cierre/resumen?periodo=2026-10")
	var r ResumenDelMes
	_ = json.Unmarshal([]byte(b), &r)
	// 1500 vendido − 1250 de costo + 100 de envío sin IVA.
	if a := r.Resultado.Actual; a.Envios != 100 || a.Resultado != 350 {
		t.Fatalf("resultado con el envío: %+v", a)
	}
}

// «Productos bajo el mínimo» dice lo mismo en el inicio, en Stock y en
// Reposición (H062): el inicio cuenta medidas, no filas por sucursal (una
// sucursal en cero con la otra con stock no es reponer), lleva a Stock ya
// filtrado, y Reposición sugiere llegar al mínimo aunque no se haya vendido.
func TestBajoElMinimoEnLasTresPantallas(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	// La placa: 10 en Central con mínimo 20 (bajo), 5 en el Aserradero sin
	// mínimo. El tirante: 100 con mínimo 10.
	placa, tirante := e.catalogo(t)
	// El tirante, en cero en el Aserradero con mínimo: la otra sucursal tiene.
	e.exec(t, `insert into inventory (variant_id, branch_id, qty, min_qty) values ($1, $2, 0, 5)`, tirante, e.aserradero)
	// La placa se le compra a Placas del Sur: la orden sale por proveedor (H377).
	prov := e.id(t, `insert into suppliers (nombre) values ('Placas del Sur') returning id`)
	e.exec(t, `insert into supplier_variant_codes (supplier_id, variant_id, codigo) values ($1, $2, 'F18')`, prov, placa)

	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/pendientes")
	if !strings.Contains(cuerpo, `"clave":"reponer","cantidad":1`) || !strings.Contains(cuerpo, `"href":"/admin/stock?estado=reponer"`) {
		t.Fatalf("inicio: %s", cuerpo)
	}
	_, b, _ := pedir(t, adm, e.u+"reportes/reposicion?dias=30&objetivo=30")
	var r ReporteDeReposicion
	_ = json.Unmarshal([]byte(b), &r)
	sugeridos := map[string]float64{}
	for _, f := range r.Filas {
		sugeridos[f.VariantID] = f.Sugerido
	}
	// La placa: disponible 8 (10 − 2 reservadas) contra 20; el tirante no
	// (el cero del Aserradero lo cubre Central, como en Stock).
	if sugeridos[placa] != 12 || sugeridos[tirante] != 0 || r.Filas[0].VariantID != placa ||
		r.Filas[0].ProveedorID == nil || *r.Filas[0].ProveedorID != prov || *r.Filas[0].Proveedor != "Placas del Sur" {
		t.Fatalf("reposición: %v %s", sugeridos, b)
	}
}
