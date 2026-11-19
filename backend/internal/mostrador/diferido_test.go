package mostrador

import (
	"context"
	"testing"
	"time"

	"mjbj/internal/caja"
	"mjbj/internal/sqlc"
)

// Un retiro sin conexión con la hora de un turno ya cerrado (T3, hallazgo
// 9): queda como tardío, con la hora en que llegó, y la diferencia del
// cierre no cambia. Antes entraba con la hora declarada y borraba el
// faltante de una caja ya contada.
func TestRetiroTardioNoCambiaElArqueo(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	ctx := context.Background()
	// Un turno de ayer: abrió con 1000, vendió 5000 en efectivo, se contaron
	// 5500 (faltan 500).
	turno := e.txt(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at, estado, cerrada_at, contado)
		values ($1, (select id from "user" limit 1), now() - interval '26 hours', 'cerrada', now() - interval '20 hours', 5500) returning id::text`, e.central)
	if _, err := e.pool.Exec(ctx, `insert into cash_movements (session_id, tipo, monto, created_at) values
		($1, 'apertura', 1000, now() - interval '26 hours'), ($1, 'venta', 5000, now() - interval '23 hours')`, turno); err != nil {
		t.Fatal(err)
	}
	cerrados := func() caja.TurnoCerrado {
		t.Helper()
		ts, _, err := caja.NuevoPanel(e.pool, silencio).TurnosCerrados(ctx, time.Now().AddDate(0, 0, -3), time.Now(), 10, 0)
		if err != nil || len(ts) != 1 {
			t.Fatalf("turnos: %v %v", ts, err)
		}
		return ts[0]
	}
	if c := cerrados(); c.Esperado != 6000 || c.Tardios != 0 {
		t.Fatalf("antes: %+v", c)
	}

	// El retiro dice haber sido a mitad del turno.
	hecho := time.Now().Add(-22 * time.Hour).UTC().Format(time.RFC3339)
	mov := `{"clave":"8f2b5c1e-1d2a-4c3b-9a8e-0000000000bb","branchId":"` + e.central + `","tipo":"retiro","monto":500,"motivo":"Pago al fletero","hechoAt":"` + hecho + `"}`
	_, _, b := crudo(t, ven, "POST", e.u+"/api/mostrador/caja/movimientos", mov)
	igualJSON(t, "retiro tardío", b, `{"ok":true,"nuevo":true,"sessionId":"`+turno+`"}`)

	c := cerrados()
	if c.Esperado != 6000 || c.Tardios != 1 || c.TardiosMonto != -500 {
		t.Fatalf("el arqueo cambió: %+v", c)
	}
	if d := e.txt(t, `select (declarado_at is not null and created_at > now() - interval '1 minute')::text from cash_movements where clave = '8f2b5c1e-1d2a-4c3b-9a8e-0000000000bb'`); d != "true" {
		t.Errorf("hora real y declarada: %s", d)
	}
	if n := e.num(t, `select count(*)::float8 from audit_log where descripcion like 'Retiro sin conexión de $500.00 % llegó con la caja ya cerrada%'`); n != 1 {
		t.Errorf("bitácora: %v", n)
	}

	// Un ingreso sin conexión de ese turno sí suma al esperado: la plata
	// estaba en el cajón cuando se contó. Dejarlo afuera dejaba un sobrante
	// falso para siempre; sumarlo solo puede agrandar un faltante.
	ingreso := `{"clave":"8f2b5c1e-1d2a-4c3b-9a8e-0000000000dd","branchId":"` + e.central + `","tipo":"ingreso","monto":700,"motivo":"Cambio","hechoAt":"` + hecho + `"}`
	_, _, b = crudo(t, ven, "POST", e.u+"/api/mostrador/caja/movimientos", ingreso)
	igualJSON(t, "ingreso tardío", b, `{"ok":true,"nuevo":true,"sessionId":"`+turno+`"}`)
	if c := cerrados(); c.Esperado != 6700 || c.Tardios != 2 || c.TardiosMonto != 200 {
		t.Fatalf("el ingreso tardío: %+v", c)
	}

	// Una venta sin conexión de ese turno que pasó lo libre sin PIN se ve en
	// el cierre, con lo que dejó de cobrar.
	if _, err := e.pool.Exec(ctx, `insert into orders (numero, contacto_nombre, origen, branch_id, total, dejado_de_cobrar, bajo_lista_sin_autorizar, cobrada_at)
		values ('PED-9', 'CF', 'mostrador', $1, 30000, 15000.5, true, now() - interval '22 hours')`, e.central); err != nil {
		t.Fatal(err)
	}
	if c := cerrados(); c.BajoLista != 1 || c.BajoListaMonto != 15000.5 {
		t.Fatalf("bajo la lista en el cierre: %+v", c)
	}
	// Y la que cargó a cuenta pasada del límite, también.
	if _, err := e.pool.Exec(ctx, `insert into orders (numero, contacto_nombre, origen, branch_id, total, credito_sin_autorizar, cobrada_at)
		values ('PED-10', 'CF', 'mostrador', $1, 80000, 80000, now() - interval '22 hours')`, e.central); err != nil {
		t.Fatal(err)
	}
	if c := cerrados(); c.CreditoSinAutorizar != 1 || c.CreditoSinAutorizarMonto != 80000 {
		t.Fatalf("a cuenta pasado el límite en el cierre: %+v", c)
	}
}

// Con el turno abierto, un retiro que deja el cajón sin el cambio de la base
// no se rechaza (la plata ya salió) pero queda marcado y anotado.
func TestRetiroDiferidoBajoLaBase(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	turno := e.txt(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, (select id from "user" limit 1), now() - interval '1 hour') returning id::text`, e.central)
	if _, err := e.pool.Exec(context.Background(), `insert into cash_movements (session_id, tipo, monto) values ($1, 'apertura', 1200)`, turno); err != nil {
		t.Fatal(err)
	}
	mov := `{"clave":"8f2b5c1e-1d2a-4c3b-9a8e-0000000000cc","branchId":"` + e.central + `","tipo":"retiro","monto":500,"motivo":"Vales","hechoAt":"` + time.Now().UTC().Add(-time.Minute).Format(time.RFC3339) + `"}`
	_, _, b := crudo(t, ven, "POST", e.u+"/api/mostrador/caja/movimientos", mov)
	igualJSON(t, "retiro", b, `{"ok":true,"nuevo":true,"sessionId":"`+turno+`"}`)
	if e.txt(t, `select bajo_la_base::text from cash_movements where monto = -500`) != "true" {
		t.Error("el retiro que deja el cajón bajo la base de $1000 tiene que quedar marcado")
	}
	if n := e.num(t, `select count(*)::float8 from audit_log where descripcion like '%dejó el cajón por debajo de la base de cambio%'`); n != 1 {
		t.Errorf("bitácora: %v", n)
	}
}
