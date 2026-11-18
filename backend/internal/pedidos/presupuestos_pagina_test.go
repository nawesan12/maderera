package pedidos

import (
	"context"
	"fmt"
	"testing"
	"time"

	"mjbj/internal/sqlc"
)

// Tanda T8: los presupuestos de a páginas. Los que esperan respuesta vienen
// enteros; los cerrados, de a 30 por fecha, sin pisarse entre páginas.
func TestPresupuestosDeAPaginas(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	// 45 cerrados, de a pares con la misma fecha (el id desempata), y 3
	// abiertos. Cada uno con dos renglones, salvo uno sin ninguno.
	for i := range 48 {
		estado := "aceptado"
		if i%2 == 1 {
			estado = "rechazado"
		}
		if i >= 45 {
			estado = []string{"pendiente", "revision", "enviado"}[i-45]
		}
		q := e.id(t, `insert into quotes (numero, contacto_nombre, estado, created_at) values ($1, 'Cliente', $2, '2026-10-01'::timestamptz + make_interval(days => $3))
			returning id`, fmt.Sprintf("P-%03d", i), estado, i/2)
		if i != 7 {
			e.exec(t, `insert into quote_items (quote_id, descripcion, cantidad, precio_unitario, subtotal) values ($1, 'a', 1, 1, 1), ($1, 'b', 1, 1, 1)`, q)
		}
	}

	abiertos, err := e.s.ListarPresupuestos(ctx, Filtros{Estado: "abiertos"}, 0, 0)
	if err != nil || len(abiertos.Filas) != 3 || abiertos.Total != 3 {
		t.Fatalf("abiertos: %d de %d, %v", len(abiertos.Filas), abiertos.Total, err)
	}
	vistos := map[string]bool{}
	var anterior time.Time
	for pagina, quiero := range []int{30, 15} {
		p, err := e.s.ListarPresupuestos(ctx, Filtros{Estado: "cerrados"}, PresupuestosPorPagina, pagina*PresupuestosPorPagina)
		if err != nil || len(p.Filas) != quiero || p.Total != 45 {
			t.Fatalf("cerrados, página %d: %d de %d, %v", pagina+1, len(p.Filas), p.Total, err)
		}
		for _, x := range p.Filas {
			if vistos[x.ID] {
				t.Errorf("%s salió dos veces", x.Numero)
			}
			vistos[x.ID] = true
			// Del más nuevo al más viejo.
			if !anterior.IsZero() && x.CreatedAt.After(anterior) {
				t.Errorf("%s está después de uno más viejo", x.Numero)
			}
			anterior = x.CreatedAt
			quiero := 2
			if x.Numero == "P-007" {
				quiero = 0
			}
			if x.Items != quiero {
				t.Errorf("%s: %d renglones", x.Numero, x.Items)
			}
		}
	}
	// Una página que se pasó del final vuelve vacía, con el total.
	if p, err := e.s.ListarPresupuestos(ctx, Filtros{Estado: "cerrados"}, 30, 99999*30); err != nil || len(p.Filas) != 0 || p.Total != 45 {
		t.Errorf("página 99999: %d de %d, %v", len(p.Filas), p.Total, err)
	}
	// Un estado puntual también va de a páginas, y sin límite trae una.
	if p, _ := e.s.ListarPresupuestos(ctx, Filtros{Estado: "aceptado"}, 0, 0); len(p.Filas) != 23 || p.Total != 23 {
		t.Errorf("aceptados: %d de %d", len(p.Filas), p.Total)
	}
	if p, _ := e.s.ListarPresupuestos(ctx, Filtros{}, 0, 0); len(p.Filas) != 30 || p.Total != 48 {
		t.Errorf("todos sin límite: %d de %d", len(p.Filas), p.Total)
	}
	if p, _ := e.s.ListarPresupuestos(ctx, Filtros{}, 1000, -5); len(p.Filas) != 48 {
		t.Errorf("con límite de más y desplazamiento negativo: %d", len(p.Filas))
	}

	// Por HTTP, el contrato rechaza lo que no es una página.
	adm, _ := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	for _, q := range []string{"limite=abc", "limite=0", "desplazamiento=-1", "limite=201"} {
		r, err := adm.Get(e.srv.URL + "/api/v1/admin/presupuestos?" + q)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != 400 {
			t.Errorf("%s: %d", q, r.StatusCode)
		}
	}
}
