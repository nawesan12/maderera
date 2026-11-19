package reportes

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"mjbj/internal/pruebas"
)

// Lo que el dueño ve del personal (T3): sin PIN cargado se avisa, y cada
// persona con lo que dejó de cobrar (autorizado o no), sus ventas sin
// conexión bajo la lista o a cuenta pasado el límite, lo que anuló (y cuánto
// sin PIN), sus retiros tardíos y, de cada admin, lo que firmó.
func TestControlesDelPersonal(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	exec(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values
		('juan', 'Juan', 'juan@prueba.test', true, now(), now()), ('marta', 'Marta', 'marta@prueba.test', true, now(), now())`)
	exec(`insert into profiles (user_id, role, staff_role) values ('marta', 'staff', 'admin'), ('juan', 'staff', 'vendedor')`)
	s := Nuevo(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ahora := time.Now()

	c, err := s.ControlesDelPersonal(ctx, ahora)
	if err != nil || !c.SinPIN || len(c.Personas) != 0 {
		t.Fatalf("vacío: %+v %v", c, err)
	}

	exec(`update "user" set pin_autorizacion = 'x:y' where id = 'marta'`)
	var sucursal, turno string
	_ = pool.QueryRow(ctx, `insert into branches (slug, name) values ('c', 'Central') returning id`).Scan(&sucursal)
	exec(`insert into orders (numero, contacto_nombre, origen, total, dejado_de_cobrar, autorizado_por, created_by_user_id) values
		('PED-1', 'A', 'mostrador', 1000, 300, 'marta', 'juan'),
		('PED-2', 'B', 'mostrador', 1000, 40, null, 'juan')`)
	exec(`insert into orders (numero, contacto_nombre, origen, total, dejado_de_cobrar, bajo_lista_sin_autorizar, created_by_user_id) values
		('PED-3', 'C', 'mostrador', 700, 250, true, 'juan')`)
	exec(`insert into orders (numero, contacto_nombre, origen, total, credito_sin_autorizar, created_by_user_id) values
		('PED-5', 'E', 'mostrador', 90000, 90000, 'juan')`)
	var anulada string
	_ = pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, origen, estado, total, mercaderia_no_volvio, created_by_user_id)
		values ('PED-4', 'D', 'mostrador', 'cancelado', 5000, true, 'juan') returning id`).Scan(&anulada)
	exec(`insert into order_status_history (order_id, estado, nota, created_by_user_id) values ($1, 'cancelado', 'x', 'juan')`, anulada)
	_ = pool.QueryRow(ctx, `insert into cash_sessions (branch_id, abierta_por) values ($1, 'juan') returning id`, sucursal).Scan(&turno)
	exec(`insert into cash_movements (session_id, tipo, monto, creado_por, declarado_at) values ($1, 'retiro', -800, 'juan', now() - interval '1 day')`, turno)

	c, err = s.ControlesDelPersonal(ctx, ahora)
	if err != nil || c.SinPIN || len(c.Personas) != 2 {
		t.Fatalf("con datos: %+v %v", c, err)
	}
	// Juan primero: lo que no firmó nadie va arriba.
	p := c.Personas[0]
	if p.Nombre != "Juan" || p.DejadoDeCobrar != 590 || p.Autorizado != 300 || p.SinConexion != (Monto{250, 1}) ||
		p.CreditoSinAutorizar != (Monto{90000, 1}) || p.Anuladas != (Monto{5000, 1}) || p.AnuladasSinFirma != (Monto{5000, 1}) ||
		p.SinDevolver != 1 || p.Retiros != (Monto{800, 1}) {
		t.Fatalf("Juan: %+v", p)
	}
	// Y Marta, con lo que firmó: un PIN aprendido firma a su nombre.
	if m := c.Personas[1]; m.Nombre != "Marta" || m.Firmo != (Monto{300, 1}) {
		t.Fatalf("Marta: %+v", m)
	}
}
