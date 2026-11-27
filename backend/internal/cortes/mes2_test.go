package cortes

import (
	"context"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/sqlc"
)

// Mes simulado 2 (M2S3-020): el corte terminado que vuelve a la máquina deja
// su pedido otra vez «preparando», con el renglón en el historial.
func TestElCorteQueVuelveALaMaquinaDesarmaElListo(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	s := Nuevo(e.pool, silencio)
	rol := sqlc.StaffRoleAdmin
	ses := &auth.Sesion{UserID: "", Rol: sqlc.UserRoleStaff, RolStaff: &rol}
	pedido := e.pedido(t, "PED-1107", map[string]any{"variante": e.melamina, "descripcion": "Melamina", "unidad": "placa", "cantidad": 1, "precio": 84500})
	e.exec(t, `update orders set origen = 'mostrador', estado = 'preparando' where id = $1`, pedido)
	corte := e.txt(t, `insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado, variant_id, placas)
		values ('CRT-20', $1, 'Gómez', 'Melamina', 'en-proceso', $2, 1) returning id::text`, pedido, e.melamina)
	if _, err := s.Avanzar(ctx, ses, corte, "en-proceso", false); err != nil {
		t.Fatal(err)
	}
	if st := e.txt(t, `select estado::text from orders where id = $1`, pedido); st != "listo" {
		t.Fatalf("con el corte terminado: %s", st)
	}
	if _, err := s.Volver(ctx, ses, corte, "terminado"); err != nil {
		t.Fatal(err)
	}
	if st := e.txt(t, `select estado::text from orders where id = $1`, pedido); st != "preparando" {
		t.Fatalf("con el corte de vuelta en la máquina: %s", st)
	}
	if n := e.txt(t, `select count(*)::text from order_status_history where order_id = $1 and nota = 'Corte CRT-20 volvió a la máquina'`, pedido); n != "1" {
		t.Errorf("historial: %s", n)
	}
}

// M2S3-020 (regla «listo_con_el_corte»): el pedido que no es del mostrador
// sigue «preparando» con su corte terminado, pero el historial lo anota; con
// «todos», pasa solo a «listo», y el corte que vuelve a la máquina lo
// desarma igual que en el mostrador.
func TestListoConElCorteSegunLaRegla(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	s := Nuevo(e.pool, silencio)
	rol := sqlc.StaffRoleAdmin
	ses := &auth.Sesion{UserID: "", Rol: sqlc.UserRoleStaff, RolStaff: &rol}
	for i, caso := range []struct{ regla, quedo string }{{"mostrador", "preparando"}, {"todos", "listo"}} {
		e.exec(t, `insert into site_settings (clave, valor) values ('listo_con_el_corte', $1)
			on conflict (clave) do update set valor = excluded.valor`, caso.regla)
		pedido := e.pedido(t, "PED-12"+string(rune('0'+i))+"6", map[string]any{"variante": e.melamina, "descripcion": "Melamina", "unidad": "placa", "cantidad": 1, "precio": 84500})
		e.exec(t, `update orders set origen = 'presupuesto', estado = 'preparando' where id = $1`, pedido)
		numero := "CRT-2" + string(rune('8'+i))
		corte := e.txt(t, `insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado, variant_id, placas)
			values ($3, $1, 'Gómez', 'Melamina', 'en-proceso', $2, 1) returning id::text`, pedido, e.melamina, numero)
		if _, err := s.Avanzar(ctx, ses, corte, "en-proceso", false); err != nil {
			t.Fatal(err)
		}
		if st := e.txt(t, `select estado::text from orders where id = $1`, pedido); st != caso.quedo {
			t.Fatalf("%s: el pedido quedó %s", caso.regla, st)
		}
		if n := e.txt(t, `select count(*)::text from order_status_history where order_id = $1 and nota = $2`, pedido, "Corte "+numero+" terminado"); n != "1" {
			t.Errorf("%s: historial %s", caso.regla, n)
		}
		if caso.quedo == "listo" {
			if _, err := s.Volver(ctx, ses, corte, "terminado"); err != nil {
				t.Fatal(err)
			}
			if st := e.txt(t, `select estado::text from orders where id = $1`, pedido); st != "preparando" {
				t.Errorf("de vuelta en la máquina: %s", st)
			}
		}
	}
}

// M2S2-055, M2S2-066: el pedido que solo cobró el corte queda entregado al
// retirarse el corte, con el remito de las piezas para firmar.
func TestRetirarElCorteEntregaElPedidoQueSoloLoCobro(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	s := Nuevo(e.pool, silencio)
	rol := sqlc.StaffRoleAdmin
	ses := &auth.Sesion{UserID: "", Rol: sqlc.UserRoleStaff, RolStaff: &rol}
	pedido := e.pedido(t, "PED-1058", map[string]any{"variante": nil, "descripcion": "Corte a medida", "unidad": "pasada", "cantidad": 4, "precio": 1200, "delCorte": true})
	e.exec(t, `update orders set estado = 'preparando', estado_pago = 'pagado' where id = $1`, pedido)
	corte := e.txt(t, `insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado, variant_id, placas, branch_id)
		values ('CRT-8', $1, 'Gómez', 'Melamina', 'terminado', $2, 1, $3) returning id::text`, pedido, e.melamina, e.central)
	e.exec(t, `insert into cutting_items (cutting_order_id, largo_mm, ancho_mm, cantidad) values ($1, 500, 300, 6)`, corte)
	if _, err := s.Avanzar(ctx, ses, corte, "terminado", false); err != nil {
		t.Fatal(err)
	}
	if st := e.txt(t, `select estado::text from orders where id = $1`, pedido); st != "entregado" {
		t.Fatalf("el pedido quedó %s", st)
	}
	if r := e.txt(t, `select estado::text || ' ' || (cutting_order_id = $2)::text from deliveries where order_id = $1`, pedido, corte); r != "preparada true" {
		t.Fatalf("remito del corte: %s", r)
	}
}

func (e *entorno) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}
