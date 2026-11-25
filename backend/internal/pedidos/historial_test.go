package pedidos

import (
	"context"
	"fmt"
	"testing"
)

// El tablero trae lo que está en curso y lo cerrado de la última semana; el
// historial, lo cerrado por páginas. Antes el tablero traía todo, desde el
// primer pedido.
func TestTableroEHistorialDePedidos(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	for i := 0; i < 53; i++ {
		e.exec(t, `insert into orders (numero, contacto_nombre, estado, created_at, updated_at)
			values ($1, 'Viejo', 'entregado', now() - interval '40 days', now() - interval '40 days')`, fmt.Sprintf("PED-V%02d", i))
	}
	e.exec(t, `insert into orders (numero, contacto_nombre, estado) values ('PED-N1', 'Nuevo', 'pendiente'), ('PED-N2', 'Recién', 'entregado')`)

	tablero, err := e.s.ListarPedidosEn(ctx, Filtros{}, VistaDePedidos{Vista: "tablero"})
	if err != nil {
		t.Fatal(err)
	}
	if len(tablero) != 2 {
		t.Fatalf("tablero: %d pedidos", len(tablero))
	}

	p1, _ := e.s.ListarPedidosEn(ctx, Filtros{}, VistaDePedidos{Vista: "historial", Pagina: 1})
	p2, _ := e.s.ListarPedidosEn(ctx, Filtros{}, VistaDePedidos{Vista: "historial", Pagina: 2})
	// 54 cerrados: la primera página trae 51 (hay más), la segunda los 4 que quedan.
	if len(p1) != PorPaginaDeHistorial+1 || len(p2) != 4 {
		t.Fatalf("páginas: %d y %d", len(p1), len(p2))
	}
	recientes, _ := e.s.ListarPedidosEn(ctx, Filtros{}, VistaDePedidos{Vista: "historial", Desde: "2000-01-01", Hasta: "2000-01-31"})
	if len(recientes) != 0 {
		t.Fatalf("con período fuera: %d", len(recientes))
	}
}
