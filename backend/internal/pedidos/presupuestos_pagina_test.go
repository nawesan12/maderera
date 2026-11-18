package pedidos

import (
	"context"
	"fmt"
	"testing"
	"time"

	"mjbj/internal/sqlc"
)

// Tanda T8: los presupuestos de a páginas, también los que esperan
// respuesta; los cerrados, de a 30 por fecha, sin pisarse entre páginas.
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
	// «Esperando respuesta» ya no viene entero: 40 abiertos más son una
	// página de 30, y el monto es el de los 43.
	for i := range 40 {
		e.exec(t, `insert into quotes (numero, contacto_nombre, estado, total) values ($1, 'Cliente', 'enviado', 100.10)`, fmt.Sprintf("A-%03d", i))
	}
	abiertos, err = e.s.ListarPresupuestos(ctx, Filtros{Estado: "abiertos"}, 0, 0)
	if err != nil || len(abiertos.Filas) != PresupuestosPorPagina || abiertos.Total != 43 || abiertos.Monto != 4004 {
		t.Fatalf("43 abiertos: %d de %d por %v, %v", len(abiertos.Filas), abiertos.Total, abiertos.Monto, err)
	}
	e.exec(t, `delete from quotes where numero like 'A-%'`)
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

// Un enviado que el cliente no contestó pasa a vencido un mes después de su
// validez; antes no, y los que esperan algo de la maderera nunca.
func TestVencerPresupuestos(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ahora := time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC)
	e.s.ahora = func() time.Time { return ahora }
	casos := []struct {
		numero, estado string
		vencioHace     int // días; negativo es que todavía vale
		quiero         string
	}{
		{"V-1", "enviado", 31, "vencido"},
		{"V-2", "enviado", 29, "enviado"},
		{"V-3", "enviado", -5, "enviado"},
		{"V-4", "pendiente", 90, "pendiente"},
		{"V-5", "revision", 90, "revision"},
		{"V-6", "aceptado", 90, "aceptado"},
	}
	for _, c := range casos {
		e.exec(t, `insert into quotes (numero, contacto_nombre, estado, valido_hasta) values ($1, 'Cliente', $2, $3)`,
			c.numero, c.estado, ahora.AddDate(0, 0, -c.vencioHace))
	}
	e.exec(t, `insert into quotes (numero, contacto_nombre, estado) values ('V-7', 'Cliente', 'enviado')`)
	n, err := e.s.VencerPresupuestos(ctx)
	if err != nil || n != 1 {
		t.Fatalf("vencidos: %d, %v", n, err)
	}
	casos = append(casos, struct {
		numero, estado string
		vencioHace     int
		quiero         string
	}{"V-7", "enviado", 0, "enviado"})
	for _, c := range casos {
		var estado string
		if err := e.pool.QueryRow(ctx, `select estado::text from quotes where numero = $1`, c.numero).Scan(&estado); err != nil {
			t.Fatal(err)
		}
		if estado != c.quiero {
			t.Errorf("%s: %s, quería %s", c.numero, estado, c.quiero)
		}
	}
	// Ya vencido, no sale en «Esperando respuesta».
	p, err := e.s.ListarPresupuestos(ctx, Filtros{Estado: "abiertos"}, 0, 0)
	if err != nil || p.Total != 5 {
		t.Errorf("abiertos después de vencer: %d, %v", p.Total, err)
	}
}
