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

	// Tres renglones a mano en una venta de Juan; las pasadas y el canto de
	// un corte no cuentan, ni lo que tiene producto. Uno a mano en «pasada»
	// sí: la unidad de «Cargar a mano» es texto libre, y antes se escondía
	// así (revisión del carril F).
	var aMano string
	_ = pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, origen, total, created_by_user_id)
		values ('PED-6', 'F', 'mostrador', 3750, 'juan') returning id`).Scan(&aMano)
	exec(`insert into order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal, del_corte) values
		($1, 'Flete centro', 'unidad', 1, 2000, 2000, false), ($1, 'Varios', 'unidad', 2, 500, 1000, false),
		($1, 'Corte a medida · 3 piezas', 'pasada', 3, 100, 300, true), ($1, 'Tapacanto pegado', 'm', 4, 100, 400, true),
		($1, 'Tapacanto blanco', 'pasada', 1, 50, 50, false)`, aMano)

	// Los recibos que anuló (comité del 25/11): uno con efectivo, que pudo
	// tapar un faltante del cajón, y uno con transferencia. El que anuló el
	// reintegro de Mercado Pago no tiene usuario y no cuenta, ni el de hace
	// diez días.
	var conEfectivo, conTransferencia string
	_ = pool.QueryRow(ctx, `insert into receipts (numero, recibido_de, total, origen, estado, anulado_por_user_id, anulado_at)
		values ('R-1', 'A', 1500, 'panel', 'anulado', 'juan', now()) returning id`).Scan(&conEfectivo)
	_ = pool.QueryRow(ctx, `insert into receipts (numero, recibido_de, total, origen, estado, anulado_por_user_id, anulado_at)
		values ('R-2', 'B', 2500, 'panel', 'anulado', 'juan', now()) returning id`).Scan(&conTransferencia)
	exec(`insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, 'efectivo', 1000, 0), ($1, 'transferencia', 500, 1), ($2, 'transferencia', 2500, 0)`, conEfectivo, conTransferencia)
	exec(`insert into receipts (numero, recibido_de, total, origen, estado, anulado_at) values ('R-3', 'C', 9000, 'mercado_pago', 'anulado', now())`)
	exec(`insert into receipts (numero, recibido_de, total, origen, estado, anulado_por_user_id, anulado_at) values ('R-4', 'D', 9000, 'panel', 'anulado', 'juan', now() - interval '10 days')`)

	c, err = s.ControlesDelPersonal(ctx, ahora)
	if err != nil || c.SinPIN || len(c.Personas) != 2 {
		t.Fatalf("con datos: %+v %v", c, err)
	}
	// Juan primero: lo que no firmó nadie va arriba.
	p := c.Personas[0]
	if p.Nombre != "Juan" || p.DejadoDeCobrar != 590 || p.Autorizado != 300 || p.SinConexion != (Monto{250, 1}) ||
		p.CreditoSinAutorizar != (Monto{90000, 1}) || p.Anuladas != (Monto{5000, 1}) || p.AnuladasSinFirma != (Monto{5000, 1}) ||
		p.SinDevolver != 1 || p.Retiros != (Monto{800, 1}) || p.AMano != (Monto{3050, 3}) ||
		p.RecibosAnulados != (Monto{4000, 2}) || p.RecibosAnuladosEfectivo != 1 {
		t.Fatalf("Juan: %+v", p)
	}
	// Y Marta, con lo que firmó: un PIN aprendido firma a su nombre.
	if m := c.Personas[1]; m.Nombre != "Marta" || m.Firmo != (Monto{300, 1}) {
		t.Fatalf("Marta: %+v", m)
	}
}
