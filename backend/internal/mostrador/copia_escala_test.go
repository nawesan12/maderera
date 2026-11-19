package mostrador

import (
	"context"
	"testing"
	"time"
)

// Tanda T8: cuando no cambió nada, la copia de cada caja vuelve vacía (son
// búsquedas por los índices de updated_at, sin recorrer las tablas), y lo que
// cambió en el producto llega igual a sus variantes.
func TestCopiaSinCambiosVuelveVacia(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ahora := time.Now().Add(time.Second)
	c, err := e.svc.Copia(ctx, &ahora)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Variantes) != 0 || len(c.Precios) != 0 || len(c.Stock) != 0 || len(c.Bajas) != 0 {
		t.Errorf("sin cambios: %d variantes, %d precios, %d stock, %d bajas", len(c.Variantes), len(c.Precios), len(c.Stock), len(c.Bajas))
	}
	p, err := e.svc.Padron(ctx, &ahora)
	if err != nil || len(p.Clientes) != 0 {
		t.Errorf("padrón sin cambios: %d, %v", len(p.Clientes), err)
	}

	// Un cambio en el producto (el nombre) trae sus variantes: la variante en
	// sí no cambió.
	if _, err := e.pool.Exec(ctx, `update products set name = 'Fenólico nuevo', updated_at = now() + interval '1 minute'
		where id = (select product_id from product_variants where id = $1)`, e.placa); err != nil {
		t.Fatal(err)
	}
	c, err = e.svc.Copia(ctx, &ahora)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Variantes) != 1 || c.Variantes[0].VariantID != e.placa || c.Variantes[0].Producto != "Fenólico nuevo" {
		t.Errorf("producto cambiado: %+v", c.Variantes)
	}
	// Sin desde, todo.
	todo, err := e.svc.Copia(ctx, nil)
	if err != nil || len(todo.Variantes) != 2 || len(todo.Stock) != 2 {
		t.Errorf("sin desde: %d variantes, %d stock, %v", len(todo.Variantes), len(todo.Stock), err)
	}
}
