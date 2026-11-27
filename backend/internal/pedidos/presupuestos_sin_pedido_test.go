package pedidos

import (
	"context"
	"testing"
)

// «Sin pedido» es a donde lleva «presupuestos aceptados sin pedido» del
// inicio (mes simulado, M3S2-020): con «aceptado» salían también los que ya
// tenían pedido, encabezando la lista.
func TestPresupuestosAceptadosSinPedido(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	q := e.id(t, `insert into quotes (numero, contacto_nombre, estado) values ('P-1', 'A', 'aceptado') returning id`)
	e.exec(t, `insert into quotes (numero, contacto_nombre, estado) values ('P-2', 'B', 'aceptado'), ('P-3', 'C', 'pendiente')`)
	b := e.id(t, `insert into branches (slug, name) values ('sucursal-sin-pedido', 'Sucursal') returning id`)
	e.exec(t, `insert into orders (numero, quote_id, branch_id, estado, subtotal, total, contacto_nombre) values ('PED-1', $1, $2, 'pendiente', 1, 1, 'A')`, q, b)
	p, err := e.s.ListarPresupuestos(ctx, Filtros{Estado: "sin-pedido"}, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if p.Total != 1 || len(p.Filas) != 1 || p.Filas[0].Numero != "P-2" {
		t.Fatalf("sin pedido: %+v", p)
	}
}
