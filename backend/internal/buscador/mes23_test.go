package buscador

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/cobros"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// Lo que el mes simulado no encontraba con el buscador del encabezado
// (M2S1-087, M2S1-096, M2S2-132, M2S2-135, M2S4-070, M3S1-066): recibos,
// remitos, cheques y comprobantes por número, productos por código y por
// medida antes que los cortes, y los estados en palabras.
func TestBuscarLoQueFaltaba(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	id := func(sql string, args ...any) string {
		t.Helper()
		var v string
		if err := pool.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	cli := id(`insert into customers (nombre) values ('Rocío Lamas') returning id`)
	b := id(`insert into branches (slug, name) values ('casa-central', 'Casa Central') returning id`)
	ped := id(`insert into orders (numero, contacto_nombre, customer_id, branch_id, estado) values ('PED-1163', 'Rocío Lamas', $1, $2, 'pendiente') returning id`, cli, b)
	exec(`insert into receipts (numero, customer_id, recibido_de, total, estado, origen, order_id) values ('REC-0050', $1, 'Rocío Lamas', 1234.5, 'emitido', 'panel', $2)`, cli, ped)
	exec(`insert into deliveries (numero, order_id, branch_id) values ('REM-0015', $1, $2)`, ped, b)
	exec(`insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id) values ('recibido', '00092001', 'Galicia', now(), 5000, 'cartera', $1)`, cli)
	exec(`insert into invoices (tipo, punto_venta, numero, estado, receptor_nombre, neto, total, order_id) values ('factura_b', 15, 2, 'emitida', 'Rocío Lamas', 100, 121, $1)`, ped)
	cat := id(`insert into categories (name, slug) values ('Placas', 'placas') returning id`)
	fer := id(`insert into categories (name, slug) values ('Ferretería', 'ferreteria') returning id`)
	mel := id(`insert into products (name, slug, category_id) values ('Melamina Blanca', 'melamina-blanca', $1) returning id`, cat)
	exec(`insert into product_variants (product_id, label, sku) values ($1, '1830 x 2600mm — 18mm', 'PLA-MEL-BLA-18'), ($1, '1830 x 2600mm — 15mm', 'PLA-MEL-BLA-15')`, mel)
	bis := id(`insert into products (name, slug, category_id) values ('Bisagra Cierre Suave', 'bisagra', $1) returning id`, fer)
	exec(`insert into product_variants (product_id, label, sku) values ($1, '35 mm', 'FER-BIS-35')`, bis)
	exec(`insert into cutting_orders (numero, contacto_nombre, material_descripcion, estado) values ('CRT-27', 'Lamas', 'Melamina Blanca 18mm', 'en-cola')`)

	buscar := func(r sqlc.StaffRole, q string) []Resultado {
		t.Helper()
		v, err := Buscar(ctx, pool, &r, q)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	primero := func(v []Resultado, tipo string) *Resultado {
		for i := range v {
			if v[i].Tipo == tipo {
				return &v[i]
			}
		}
		return nil
	}
	ven := sqlc.StaffRoleVendedor
	if r := primero(buscar(ven, "REC-0050"), "Recibo"); r == nil || r.Href != "/admin/clientes/"+cli+"?periodo=todo#recibo-REC-0050" ||
		!strings.Contains(r.Detalle, "$ 1.234,50") {
		t.Errorf("recibo: %+v", r)
	}
	if r := primero(buscar(ven, "REM-0015"), "Remito"); r == nil || r.Href != "/admin/pedidos/"+ped+"#remito" {
		t.Errorf("remito: %+v", r)
	}
	if r := primero(buscar(ven, "00092001"), "Cheque"); r == nil || !strings.HasPrefix(r.Href, "/admin/clientes/"+cli) {
		t.Errorf("cheque: %+v", r)
	}
	if r := primero(buscar(ven, "0015-00000002"), "Comprobante"); r == nil || r.Href != "/admin/pedidos/"+ped {
		t.Errorf("el vendedor encuentra la factura y va al pedido: %+v", r)
	}
	if r := primero(buscar(sqlc.StaffRoleAdmin, "0015-00000002"), "Comprobante"); r == nil || !strings.HasPrefix(r.Href, "/admin/facturacion/") {
		t.Errorf("el admin va a la factura: %+v", r)
	}
	if r := primero(buscar(ven, "PLA-MEL-BLA-18"), "Producto"); r == nil || r.Titulo != "Melamina Blanca" {
		t.Errorf("por código: %+v", r)
	}
	v := buscar(ven, "melamina 18")
	producto, corte := -1, -1
	for i, x := range v {
		if x.Tipo == "Producto" && producto < 0 {
			producto = i
		}
		if x.Tipo == "Corte" && corte < 0 {
			corte = i
		}
	}
	if producto < 0 || corte < 0 || producto > corte {
		t.Errorf("el producto va antes que los cortes: %+v", v)
	}
	if !strings.Contains(v[corte].Detalle, "En cola") {
		t.Errorf("el corte en palabras: %+v", v[corte])
	}
	if r := primero(buscar(ven, "Bisagra"), "Producto"); r == nil || !strings.HasSuffix(r.Detalle, "1 medida") {
		t.Errorf("singular: %+v", r)
	}
	// El depósito no abre la ficha: la bisagra lo lleva a su stock (mes 23,
	// admin-atencion-Ndueña-admin-6: daba «Nada coincide»).
	if r := primero(buscar(sqlc.StaffRoleDeposito, "Bisagra"), "Producto"); r == nil || r.Href != "/admin/stock?buscar=Bisagra+Cierre+Suave" {
		t.Errorf("depósito, bisagra: %+v", r)
	}
	if n := len(buscar(ven, "Bisagra")); n != 1 {
		t.Errorf("el vendedor ve la bisagra una sola vez: %d", n)
	}
	if r := primero(buscar(ven, "Lamas"), "Pedido"); r == nil || !strings.HasPrefix(r.Detalle, "Sin preparar") {
		t.Errorf("el pedido en palabras: %+v", r)
	}
	// «melamina 1830» no es «18»: el número corto es un número entero.
	if r := primero(buscar(ven, "bisagra 18"), "Producto"); r != nil {
		t.Errorf("18 no es 35: %+v", r)
	}
}

// El recibo que cobra una factura (invoice_payments) no pasa por el libro ni
// lleva order_id: el buscador llevaba a #recibo-REC-0014 y la ficha no tenía
// ese renglón (mes 23, M2S1-096). Ahora la compra de contado lo muestra, y el
// que cobró una factura sin pedido lleva a esa factura.
func TestReciboQueCobraUnaFactura(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	id := func(sql string, args ...any) string {
		t.Helper()
		var v string
		if err := pool.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	cli := id(`insert into customers (nombre) values ('Rocío Lamas') returning id`)
	b := id(`insert into branches (slug, name) values ('casa-central', 'Casa Central') returning id`)
	ped := id(`insert into orders (numero, contacto_nombre, customer_id, branch_id, estado, total) values ('PED-1170', 'Rocío Lamas', $1, $2, 'entregado', 121) returning id`, cli, b)
	conPedido := id(`insert into invoices (tipo, punto_venta, numero, estado, receptor_nombre, neto, total, order_id, customer_id) values ('factura_b', 15, 7, 'emitida', 'Rocío Lamas', 100, 121, $1, $2) returning id`, ped, cli)
	suelta := id(`insert into invoices (tipo, punto_venta, numero, estado, receptor_nombre, neto, total, customer_id) values ('factura_b', 15, 8, 'emitida', 'Rocío Lamas', 100, 121, $1) returning id`, cli)
	r14 := id(`insert into receipts (numero, customer_id, recibido_de, total, estado, origen) values ('REC-0014', $1, 'Rocío Lamas', 121, 'emitido', 'factura') returning id`, cli)
	r15 := id(`insert into receipts (numero, customer_id, recibido_de, total, estado, origen) values ('REC-0015', $1, 'Rocío Lamas', 121, 'emitido', 'factura') returning id`, cli)
	if _, err := pool.Exec(ctx, `insert into invoice_payments (invoice_id, medio, monto, receipt_id) values ($1, 'efectivo', 121, $2), ($3, 'efectivo', 121, $4)`,
		conPedido, r14, suelta, r15); err != nil {
		t.Fatal(err)
	}

	ven := sqlc.StaffRoleVendedor
	buscar := func(q string) *Resultado {
		t.Helper()
		v, err := Buscar(ctx, pool, &ven, q)
		if err != nil {
			t.Fatal(err)
		}
		for i := range v {
			if v[i].Tipo == "Recibo" {
				return &v[i]
			}
		}
		return nil
	}
	if r := buscar("REC-0014"); r == nil || r.Href != "/admin/clientes/"+cli+"?periodo=todo#recibo-REC-0014" {
		t.Errorf("el recibo del pedido va a su renglón: %+v", r)
	}
	if r := buscar("REC-0015"); r == nil || r.Href != "/admin/facturacion/"+suelta {
		t.Errorf("el de una factura suelta va a la factura: %+v", r)
	}

	movs, _, err := cobros.Historial(ctx, sqlc.New(pool), cli, nil, "todo", 0)
	if err != nil {
		t.Fatal(err)
	}
	var hay bool
	for _, m := range movs {
		if m.Clase == "compra_contado" && m.Recibo != nil && m.Recibo.Numero == "REC-0014" {
			hay = true
		}
	}
	if !hay {
		t.Errorf("la ficha tiene el renglón de REC-0014: %+v", movs)
	}
}
