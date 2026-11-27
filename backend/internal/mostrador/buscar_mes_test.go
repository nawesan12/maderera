package mostrador

import (
	"context"
	"testing"
)

// El buscador del mostrador (mes simulado):
//
//   - H017: «mdf 18» ponía primero el MDF de 3 mm, porque «1830 x 2600mm»
//     contiene «18» y el orden era por nombre.
//   - H023: decía el stock físico, y lo reservado para un acopio aparecía
//     libre para volver a venderse.
func TestBuscarDelMesSimulado(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	cat := e.txt(t, `select id::text from categories limit 1`)
	prod := e.txt(t, `insert into products (slug, name, category_id, description, unit) values ('mdf', 'MDF', $1, '', 'placa') returning id::text`, cat)
	tres := e.txt(t, `insert into product_variants (product_id, sku, label, sort_order) values ($1, 'PLA-MDF-003', '1830 x 2600mm 3mm', 1) returning id::text`, prod)
	diez := e.txt(t, `insert into product_variants (product_id, sku, label, sort_order) values ($1, 'PLA-MDF-018', '1830 x 2600mm 18mm', 2) returning id::text`, prod)
	for _, v := range []string{tres, diez} {
		if _, err := e.pool.Exec(ctx, `insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 1000)`, e.general, v); err != nil {
			t.Fatal(err)
		}
	}
	r, err := e.svc.Buscar(ctx, "mdf 18", e.central, nil)
	if err != nil || len(r) == 0 || r[0].VariantID != diez {
		t.Fatalf("mdf 18: %+v %v", r, err)
	}
	// El código sin la familia (M3S1-067).
	r, err = e.svc.Buscar(ctx, "MDF-018", e.central, nil)
	if err != nil || len(r) == 0 || r[0].VariantID != diez {
		t.Fatalf("MDF-018: %+v %v", r, err)
	}

	// 100 placas en la sucursal, 40 reservadas para un acopio: hay 60.
	pedido := e.txt(t, `insert into orders (numero, contacto_nombre, branch_id, origen) values ('PED-9000', 'Obra', $1, 'mostrador') returning id::text`, e.central)
	item := e.txt(t, `insert into order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal) values ($1, $2, 'Fenólico', 'placa', 40, 1, 40) returning id::text`, pedido, e.placa)
	if _, err := e.pool.Exec(ctx, `insert into stock_reservations (order_id, order_item_id, variant_id, branch_id, cantidad) values ($1, $2, $3, $4, 40)`, pedido, item, e.placa, e.central); err != nil {
		t.Fatal(err)
	}
	r, err = e.svc.Buscar(ctx, "FEN18", e.central, nil)
	if err != nil || len(r) != 1 || r[0].Stock != 60 {
		t.Fatalf("disponible: %+v %v", r, err)
	}
	c, err := e.svc.Copia(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range c.Stock {
		if s.VariantID == e.placa && s.BranchID == e.central && s.Qty != 60 {
			t.Errorf("la copia local dice %v", s.Qty)
		}
	}
}

// Un pedido entregado sin cobrar se ve junto al «Debe» del cliente: no está
// en la cuenta, y para el vendedor desaparecía (mes simulado, H367).
func TestPedidosSinCobrarDelCliente(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	pedido := e.txt(t, `insert into orders (numero, contacto_nombre, customer_id, branch_id, origen, estado, estado_pago, subtotal, total, medio_pago)
		values ('PED-1107', 'Elena Paz', $1, $2, 'telefono', 'entregado', 'pendiente', 824440, 824440, 'transferencia') returning id::text`, e.cliente, e.central)
	if _, err := e.pool.Exec(ctx, `insert into order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal) values ($1, $2, 'Fenólico', 'placa', 1, 824440, 824440)`, pedido, e.placa); err != nil {
		t.Fatal(err)
	}
	ps, err := e.svc.PedidosSinCobrar(ctx, e.cliente)
	if err != nil || len(ps) != 1 || ps[0].Numero != "PED-1107" || ps[0].Monto != 824440 {
		t.Fatalf("sin cobrar: %+v %v", ps, err)
	}
}

// M2S3-028: «2x4», «tirante 2x4» y «pino 2x4» encuentran el tirante de
// 2" x 4": la medida se tipea de corrido.
func TestBuscarMedidaDeCorrido(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	cat := e.txt(t, `select id::text from categories limit 1`)
	prod := e.txt(t, `insert into products (slug, name, category_id, description, unit) values ('tirante', 'Tirante Pino Tratado', $1, '', 'unidad') returning id::text`, cat)
	v := e.txt(t, `insert into product_variants (product_id, sku, label, sort_order) values ($1, 'TIR-2X4', '2" x 4" x 3.60m', 1) returning id::text`, prod)
	if _, err := e.pool.Exec(ctx, `insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 1000)`, e.general, v); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"2x4", "tirante 2x4", "pino 2x4"} {
		r, err := e.svc.Buscar(ctx, q, e.central, nil)
		if err != nil || len(r) == 0 || r[0].VariantID != v {
			t.Errorf("%q: %+v %v", q, r, err)
		}
	}
	if r, err := e.svc.Buscar(ctx, "2x6", e.central, nil); err != nil || len(r) != 0 {
		t.Errorf("2x6 trajo %+v %v", r, err)
	}
}
