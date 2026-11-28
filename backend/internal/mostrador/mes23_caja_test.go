package mostrador

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/caja"
	"mjbj/internal/facturacion"
	"mjbj/internal/reportes"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
)

// Lo que encontró el segundo y el tercer mes simulado en la caja (rama
// mes23-mostrador-caja).

// sesionAbierta es el turno abierto de la central.
func (e *entorno) sesionAbierta(t *testing.T) string {
	t.Helper()
	return e.txt(t, `select id::text from cash_sessions where branch_id = $1 and estado = 'abierta'`, e.central)
}

// conConcepto son los asientos cuyo concepto empieza así.
func conConcepto(as []reportes.Asiento, prefijo string) []reportes.Asiento {
	var out []reportes.Asiento
	for _, a := range as {
		if strings.HasPrefix(a.Concepto, prefijo) {
			out = append(out, a)
		}
	}
	return out
}

// M2S3-002: «ayer conté mal» rehace el arqueo del turno anterior; no es un
// retiro, la caja fuerte no suma nada y el sobrante falso no queda en el
// archivo del estudio.
func TestMes23CorregirElConteoDelTurnoAnterior(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 5000)
	sesion := e.sesionAbierta(t)
	if st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/cerrar", map[string]any{"sessionId": sesion, "contado": 7000, "notas": "sobran"}); st != 200 {
		t.Fatalf("cerrar: %d %v %s", st, m, b)
	}
	if n := len(conConcepto(e.asientosDeTodo(t), "Sobrante del arqueo")); n != 1 {
		t.Fatalf("antes de corregir: %d asientos de sobrante", n)
	}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/abrir", map[string]any{
		"branchId": e.central, "fondoInicial": 5000, "motivo": "Conté mal: había 5000", "corregir": true})
	if st != 200 {
		t.Fatalf("abrir corrigiendo: %d %v %s", st, m, b)
	}
	if n := e.num(t, `select count(*)::float8 from cash_movements where session_id = $1 and tipo in ('retiro', 'ingreso')`, e.sesionAbierta(t)); n != 0 {
		t.Errorf("la corrección se cargó como movimiento: %v", n)
	}
	if v := e.num(t, `select contado_corregido::float8 from cash_sessions where id = $1`, sesion); v != 5000 {
		t.Errorf("contado corregido: %v", v)
	}
	if v := e.num(t, `select contado::float8 from cash_sessions where id = $1`, sesion); v != 7000 {
		t.Errorf("lo contado de entonces se pisó: %v", v)
	}
	if n := len(conConcepto(e.asientosDeTodo(t), "Sobrante del arqueo")); n != 0 {
		t.Errorf("el sobrante falso sigue en el archivo: %d", n)
	}
	cf, err := caja.NuevoPanel(e.pool, silencio).CajasFuertes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range cf {
		if x.Saldo != 0 {
			t.Errorf("la caja fuerte de %s sumó %v", x.Sucursal, x.Saldo)
		}
	}
}

// M2S3-002, la otra salida: sin «corregir» la diferencia sigue siendo un
// retiro entre turnos, pero no va a parar a la caja fuerte.
func TestMes23EntreTurnosNoEsCajaFuerte(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 5000)
	sesion := e.sesionAbierta(t)
	pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/cerrar", map[string]any{"sessionId": sesion, "contado": 7000, "notas": "sobran"})
	if st, _, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/abrir", map[string]any{
		"branchId": e.central, "fondoInicial": 5000, "motivo": "Se llevó la dueña"}); st != 200 {
		t.Fatalf("abrir: %s", b)
	}
	if n := e.num(t, `select count(*)::float8 from cash_movements where session_id = $1 and tipo = 'retiro'`, e.sesionAbierta(t)); n != 1 {
		t.Errorf("retiro entre turnos: %v", n)
	}
	cf, _ := caja.NuevoPanel(e.pool, silencio).CajasFuertes(context.Background())
	for _, x := range cf {
		if x.Saldo != 0 {
			t.Errorf("la caja fuerte de %s sumó %v", x.Sucursal, x.Saldo)
		}
	}
}

// M3S1-005 y M3S3-014: el retiro que es un pago va como gasto, el ingreso y
// el retiro sin cuenta dejan su asiento, y la caja fuerte tiene saldo.
func TestMes23MovimientosDeCajaConCuenta(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 50000)
	sesion := e.sesionAbierta(t)
	mov := func(cuerpo map[string]any) {
		t.Helper()
		cuerpo["sessionId"] = sesion
		if st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/movimiento", cuerpo); st != 200 {
			t.Fatalf("%v: %d %v %s", cuerpo, st, m, b)
		}
	}
	mov(map[string]any{"tipo": "retiro", "monto": 20000, "motivo": "Flete Martínez", "destino": "otro", "categoria": "flete"})
	mov(map[string]any{"tipo": "retiro", "monto": 3000, "motivo": "Se llevó la dueña", "destino": "otro"})
	mov(map[string]any{"tipo": "ingreso", "monto": 10000, "motivo": "Cambio en monedas del kiosco", "destino": "otro"})
	mov(map[string]any{"tipo": "retiro", "monto": 15000, "motivo": "", "destino": "caja_fuerte"})
	mov(map[string]any{"tipo": "ingreso", "monto": 4000, "motivo": "", "destino": "caja_fuerte"})

	if v := e.num(t, `select importe::float8 from expenses where categoria = 'flete' and medio = 'efectivo'`); v != 20000 {
		t.Errorf("el flete no quedó como gasto: %v", v)
	}
	ab, err := caja.Abierto(context.Background(), e.pool, e.central)
	if err != nil {
		t.Fatal(err)
	}
	if ab.Gastos != -20000 || ab.Retiros != -18000 || ab.OtrosIngresos != 14000 || ab.Esperado != 26000 {
		t.Errorf("turno: gastos %v retiros %v ingresos %v esperado %v", ab.Gastos, ab.Retiros, ab.OtrosIngresos, ab.Esperado)
	}
	as := e.asientosDeTodo(t)
	if n := len(conConcepto(as, "Ingreso a la caja")); n != 1 {
		t.Errorf("asientos del ingreso suelto: %d", n)
	}
	if n := len(conConcepto(as, "Retiro de la caja")); n != 1 {
		t.Errorf("asientos del retiro sin cuenta: %d", n)
	}

	p := caja.NuevoPanel(e.pool, silencio)
	saldo := func() float64 {
		cf, err := p.CajasFuertes(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		for _, x := range cf {
			if x.BranchID == e.central {
				return x.Saldo
			}
		}
		return -1
	}
	if s := saldo(); s != 11000 {
		t.Errorf("caja fuerte: %v", s)
	}
	adm := e.sesionDe(t, "admin@prueba.test")
	if _, err := p.DepositarDeLaCajaFuerte(context.Background(), adm, e.central, 12000, "", "dep-1"); err == nil {
		t.Errorf("depositó más de lo que había")
	}
	for range 2 {
		if _, err := p.DepositarDeLaCajaFuerte(context.Background(), adm, e.central, 10000, "", "dep-2"); err != nil {
			t.Fatal(err)
		}
	}
	if s := saldo(); s != 1000 {
		t.Errorf("caja fuerte después del depósito (con doble clic): %v", s)
	}
	if n := len(conConcepto(e.asientosDeTodo(t), "Depósito de la caja fuerte")); n != 1 {
		t.Errorf("asientos del depósito: %d", n)
	}
}

// M2S1-182: el gasto anulado no cuenta dos veces (gasto y otro ingreso).
func TestMes23GastoAnuladoNoSumaDosVeces(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 100000)
	sesion := e.sesionAbierta(t)
	gasto := e.txt(t, `insert into expenses (categoria, descripcion, importe, medio, branch_id, anulado_at) values ('combustible', 'Gasoil', 45000, 'efectivo', $1, now()) returning id::text`, e.central)
	e.txt(t, `insert into cash_movements (session_id, tipo, monto, motivo, expense_id) values ($1, 'gasto', -45000, 'Gasoil', $2) returning id::text`, sesion, gasto)
	e.txt(t, `insert into cash_movements (session_id, tipo, monto, motivo, expense_id) values ($1, 'ingreso', 45000, 'Anulación del gasto: Gasoil', $2) returning id::text`, sesion, gasto)
	ab, err := caja.Abierto(context.Background(), e.pool, e.central)
	if err != nil {
		t.Fatal(err)
	}
	if ab.Gastos != 0 || ab.OtrosIngresos != 0 || ab.Esperado != 100000 {
		t.Errorf("gastos %v, otros ingresos %v, esperado %v", ab.Gastos, ab.OtrosIngresos, ab.Esperado)
	}
	movs, _ := caja.MovimientosDelTurno(context.Background(), e.pool, sesion)
	tachados := 0
	for _, m := range movs {
		if m.Anulado {
			tachados++
		}
	}
	if tachados != 1 {
		t.Errorf("el gasto anulado se ve tachado: %d", tachados)
	}
}

// M2S1-081, M3S1-060 y M3S2-061: la devolución por afuera dice el medio y
// el pedido, y la que hizo otra persona desde el panel a la cuenta no entra
// en el Z del puesto.
func TestMes23DevolucionesDelZ(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "admin@prueba.test", VentaPedida{MedioPago: ventas.Transferencia, Lineas: placas(e, 4, 1000)})
	if _, err := c.devolver(1, facturacion.DevolverPorAfuera, func(p *facturacion.PedidoDeDevolucion) { p.DelMostrador = true }); err != nil {
		t.Fatal(err)
	}
	cc := "Ana Gómez"
	cli := e.cliente
	d := e.vendidaYFacturada(t, "admin2@prueba.test", VentaPedida{MedioPago: ventas.CuentaCorriente, CustomerID: &cli, ContactoNombre: cc, Lineas: placas(e, 2, 500)})
	if _, err := d.devolver(1, facturacion.DevolverPorCuenta); err != nil { // desde el panel
		t.Fatal(err)
	}
	z, err := caja.CierreDelTurno(context.Background(), e.pool, c.turno)
	if err != nil {
		t.Fatal(err)
	}
	var devs []caja.RenglonDelCierre
	for _, r := range z {
		if r.Devolucion && r.Pedidos != nil {
			devs = append(devs, r)
		}
	}
	if len(devs) != 1 || devs[0].MedioPago != "transferencia" || *devs[0].Pedidos != c.numero || devs[0].Total != -1000 || devs[0].Quien != nil {
		t.Errorf("devoluciones del Z: %+v", devs)
	}
}

// M2S2-130 y M2S2-007: el cobro de un pedido en efectivo que tomó otra
// persona desde el panel figura en el Z con su recibo y quién lo cobró.
func TestMes23CobroDeOtraPersonaEnElZ(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000)
	sesion := e.sesionAbierta(t)
	e.staff(t, "atencion@prueba.test", sqlc.StaffRoleVendedor)
	atencion := e.txt(t, `select id from "user" where email = 'atencion@prueba.test'`)
	pedido := e.txt(t, `insert into orders (numero, contacto_nombre, estado, origen, tipo_entrega, subtotal, total) values ('PED-9001', 'Taller Bosque', 'entregado', 'telefono', 'retiro', 87900, 87900) returning id::text`)
	r := e.txt(t, `insert into receipts (numero, recibido_de, branch_id, total, origen, created_by_user_id, order_id) values ('REC-0019', 'Taller Bosque', $1, 87900, 'panel', $2, $3) returning id::text`, e.central, atencion, pedido)
	e.txt(t, `insert into receipt_parts (receipt_id, medio, importe) values ($1, 'efectivo', 87900) returning id::text`, r)
	e.txt(t, `insert into cash_movements (session_id, tipo, monto, motivo, creado_por) values ($1, 'ingreso', 87900, 'Recibo REC-0019 — Taller Bosque', $2) returning id::text`, sesion, atencion)

	z, err := caja.CierreDelTurno(context.Background(), e.pool, sesion)
	if err != nil {
		t.Fatal(err)
	}
	var cobro *caja.RenglonDelCierre
	for i := range z {
		if z[i].Cobranza {
			cobro = &z[i]
		}
	}
	if cobro == nil || !cobro.DePedido || cobro.MedioPago != "efectivo" || cobro.Total != 87900 || cobro.Pedidos == nil || *cobro.Pedidos != "REC-0019" ||
		cobro.Quien == nil || !strings.Contains(*cobro.Quien, "Persona") {
		t.Fatalf("el cobro en el Z: %+v", cobro)
	}
	movs, _ := caja.MovimientosDelTurno(context.Background(), e.pool, sesion)
	otros := 0
	for _, m := range movs {
		if m.OtroPuesto {
			otros++
		}
	}
	if otros != 1 {
		t.Errorf("el movimiento de otra persona: %d", otros)
	}
}

// M3S1-013: el efectivo de un recibo cobrado sin caja se asigna a un turno.
func TestMes23ReciboFueraDeCajaAlTurno(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000)
	sesion := e.sesionAbierta(t)
	r := e.txt(t, `insert into receipts (numero, recibido_de, branch_id, total, origen) values ('REC-0069', 'Obra', $1, 150000, 'panel') returning id::text`, e.central)
	e.txt(t, `insert into receipt_parts (receipt_id, medio, importe) values ($1, 'efectivo', 150000) returning id::text`, r)
	p := caja.NuevoPanel(e.pool, silencio)
	adm := e.sesionDe(t, "admin@prueba.test")
	if _, err := p.AsignarReciboAlTurno(context.Background(), adm, r, sesion); err != nil {
		t.Fatal(err)
	}
	if _, err := p.AsignarReciboAlTurno(context.Background(), adm, r, sesion); err == nil {
		t.Errorf("se asignó dos veces")
	}
	ab, _ := caja.Abierto(context.Background(), e.pool, e.central)
	if ab.Esperado != 151000 {
		t.Errorf("esperado %v", ab.Esperado)
	}
}

// M2S3-097: dentro del peso, el cierre dice los centavos, como la caja del
// panel.
func TestMes23CierraConCentavos(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000.6)
	_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/cerrar", map[string]any{"sessionId": e.sesionAbierta(t), "contado": 1000, "notas": ""})
	if ok, _ := m["ok"].(string); !strings.HasPrefix(ok, "Caja cerrada: cierra · ") || !strings.Contains(ok, "0,60") {
		t.Errorf("cierre: %s", b)
	}
}
