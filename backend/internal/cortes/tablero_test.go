package cortes

import (
	"context"
	"testing"
)

// El tablero trae lo retirado y lo cancelado de hoy, no el de toda la
// historia (comité final): lo viejo se encuentra filtrando por estado.
func TestElTableroNoJuntaLosCanceladosViejos(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `insert into cutting_orders (numero, contacto_nombre, material_descripcion, estado, updated_at) values
		('C-1', 'A', 'MDF', 'cancelado', now()),
		('C-2', 'B', 'MDF', 'cancelado', now() - interval '3 days'),
		('C-3', 'C', 'MDF', 'retirado', now() - interval '3 days'),
		('C-4', 'D', 'MDF', 'en-cola', now() - interval '3 days')`); err != nil {
		t.Fatal(err)
	}
	s := Nuevo(e.pool, silencio)
	numeros := func(estado string) map[string]bool {
		cs, err := s.Listar(ctx, "", estado)
		if err != nil {
			t.Fatal(err)
		}
		m := map[string]bool{}
		for _, c := range cs {
			m[c.Numero] = true
		}
		return m
	}
	tablero := numeros("")
	if !tablero["C-1"] || !tablero["C-4"] || tablero["C-2"] || tablero["C-3"] {
		t.Errorf("tablero: %v", tablero)
	}
	if cancelados := numeros("cancelado"); !cancelados["C-1"] || !cancelados["C-2"] {
		t.Errorf("filtrando por cancelado: %v", cancelados)
	}
}

// Un corte sin sucursal sale en un solo taller, el de la primera sucursal
// activa (la que pone el alta), no en los dos (tercera prueba del mes).
func TestElCorteSinSucursalVaAUnSoloTaller(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	var primera, otra string
	if err := e.pool.QueryRow(ctx, `insert into branches (slug, name, active, sort_order) values ('t-uno', 'Uno', true, -20) returning id::text`).Scan(&primera); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(ctx, `insert into branches (slug, name, active, sort_order) values ('t-dos', 'Dos', true, -10) returning id::text`).Scan(&otra); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into cutting_orders (numero, contacto_nombre, material_descripcion, estado, branch_id) values
		('S-1', 'A', 'MDF', 'en-cola', null),
		('S-2', 'B', 'MDF', 'en-cola', $1::uuid),
		('S-3', 'C', 'MDF', 'en-cola', $2::uuid)`, primera, otra); err != nil {
		t.Fatal(err)
	}
	s := Nuevo(e.pool, silencio)
	numeros := func(sucursal string) map[string]bool {
		cs, err := s.Listar(ctx, "", "", sucursal)
		if err != nil {
			t.Fatal(err)
		}
		m := map[string]bool{}
		for _, c := range cs {
			m[c.Numero] = true
		}
		return m
	}
	if uno := numeros(primera); !uno["S-1"] || !uno["S-2"] || uno["S-3"] {
		t.Errorf("primera sucursal: %v", uno)
	}
	if dos := numeros(otra); dos["S-1"] || dos["S-2"] || !dos["S-3"] {
		t.Errorf("otra sucursal: %v", dos)
	}
}
