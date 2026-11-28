package pedidos

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/entregas"
	"mjbj/internal/reglas"
	"mjbj/internal/sqlc"
)

// envioListo deja un pedido de la sucursal como envío listo para despachar,
// en efectivo y sin cobrar, a una zona «a cotizar» con el flete en cero.
func (e *entorno) envioListo(t *testing.T, ses *auth.Sesion) string {
	t.Helper()
	id := e.pedido(t, ses, 1)
	e.exec(t, `insert into shipping_zones (nombre, cobertura, a_cotizar, costo, activa)
		select 'Sim Lejos', '', true, 0, true where not exists (select 1 from shipping_zones where nombre = 'Sim Lejos')`)
	e.exec(t, `update orders set tipo_entrega = 'envio', direccion_entrega = 'Güemes 2450', zona_envio = 'Sim Lejos',
		costo_envio = 0, medio_pago = 'efectivo', estado = 'listo' where id = $1`, id)
	return id
}

// M4-077, M4-078 y M4-114: el depósito despacha PED-1018 (efectivo, sin
// cobrar, flete a cotizar). Con las reglas de siempre: pide el PIN, sale, y
// el historial dice cuánto faltaba, quién autorizó y que el flete salió sin
// cotizar; «El personal» cuenta la firma. Con flete_sin_cotizar en «frena»
// no sale; con despacho_contra_entrega en «sin_pin» sale sin PIN.
func TestDespachoDelEnvioSinCobrar(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	_, dep := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	_, ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	_, adm := e.staff(t, "duena@prueba.test", sqlc.StaffRoleAdmin)
	e.exec(t, `update "user" set name = 'Sim Dueña' where id = $1`, adm.UserID)
	if err := e.ses.CargarPIN(ctx, adm, "una clave larga", "482915"); err != nil {
		t.Fatal(err)
	}

	id := e.envioListo(t, ven)
	if _, err := e.s.Avanzar(ctx, dep, id, "listo", entregas.Receptor{}); !esProblema(err, 422) {
		t.Fatalf("sin PIN: %v", err)
	}
	r, err := e.s.Avanzar(ctx, dep, id, "listo", entregas.Receptor{SinCobrar: entregas.SalidaSinCobrar{PIN: "482915"}})
	if err != nil || r.Estado != "en-camino" {
		t.Fatalf("con PIN: %+v %v", r, err)
	}
	nota := e.texto(t, `select coalesce(nota, '') from order_status_history where order_id = $1 and estado = 'en-camino'`, id)
	for _, parte := range []string{NotaSalioSinCobrar + " · $", "autorizó Sim Dueña", entregas.NotaFleteSinCotizar} {
		if !strings.Contains(nota, parte) {
			t.Errorf("la nota %q no dice %q", nota, parte)
		}
	}
	if quien := e.texto(t, `select coalesce(salida_autorizada_por, '') from orders where id = $1`, id); quien != adm.UserID {
		t.Errorf("salida_autorizada_por: %q", quien)
	}

	// «frena»: no sale hasta cotizarlo o «Sin cargo».
	if err := reglas.Fijar(ctx, e.pool, reglas.FleteSinCotizar, "frena"); err != nil {
		t.Fatal(err)
	}
	otro := e.envioListo(t, ven)
	_, err = e.s.Avanzar(ctx, dep, otro, "listo", entregas.Receptor{SinCobrar: entregas.SalidaSinCobrar{PIN: "482915"}})
	if err == nil || !strings.Contains(err.Error(), "flete está sin cotizar") {
		t.Fatalf("frena: %v", err)
	}
	e.exec(t, `update orders set flete_sin_cargo = true where id = $1`, otro)
	if r, err := e.s.Avanzar(ctx, dep, otro, "listo", entregas.Receptor{SinCobrar: entregas.SalidaSinCobrar{PIN: "482915"}}); err != nil || r.Estado != "en-camino" {
		t.Fatalf("sin cargo sale: %+v %v", r, err)
	}

	// «sin_pin»: el envío en efectivo sale sin PIN y queda a cobrar.
	if err := reglas.Fijar(ctx, e.pool, reglas.DespachoContraEntrega, "sin_pin"); err != nil {
		t.Fatal(err)
	}
	tercero := e.envioListo(t, ven)
	e.exec(t, `update orders set costo_envio = 5000, total = total + 5000 where id = $1`, tercero)
	if r, err := e.s.Avanzar(ctx, dep, tercero, "listo", entregas.Receptor{}); err != nil || r.Estado != "en-camino" {
		t.Fatalf("contra entrega sin PIN: %+v %v", r, err)
	}
	if quien := e.texto(t, `select coalesce(salida_autorizada_por, '') from orders where id = $1`, tercero); quien != "" {
		t.Errorf("sin PIN no firma nadie: %q", quien)
	}
}

// M4-096: el margen de la ficha descuenta la parte del descuento del pedido
// (PED-1010: −10 % por transferencia; el neto es el de su factura).
func TestMargenConElDescuentoDelPedido(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	_, ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	id := e.pedido(t, ven, 1)
	e.exec(t, `update order_items set subtotal = 82280, precio_unitario = 82280, costo_unitario = 43806 where order_id = $1`, id)
	// Dos renglones de $ 82.280 (los del alta de prueba): $ 164.560 − 10 %.
	e.exec(t, `update orders set subtotal = 164560, descuento = 16456, total = 148104 where id = $1`, id)
	f, err := e.s.Pedido(ctx, id, true)
	if err != nil {
		t.Fatal(err)
	}
	if f.Margen == nil || f.Margen.Neto < 122399.99 || f.Margen.Neto > 122400.01 || f.Margen.Costo != 2*43806 {
		t.Fatalf("margen: %+v", f.Margen)
	}
}

// M4-026: el presupuesto sin contacto propio pasa a pedido con el correo y
// el teléfono de la ficha del cliente (los avisos de estado leen esos).
func TestPedidoTomaElContactoDeLaFicha(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	_, ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	cliente := e.id(t, `insert into customers (nombre, email, telefono) values ('Sim Carpintería Ferreyra', 'sim.carpintero@ejemplo.test', '2236000000') returning id`)
	q := e.presupuesto(t, ven, 1)
	e.exec(t, `update quotes set customer_id = $2, contacto_email = null, contacto_telefono = '' where id = $1`, q, cliente)
	r, err := e.s.ConvertirEnPedido(ctx, ven, q)
	if err != nil {
		t.Fatal(err)
	}
	if c := e.texto(t, `select coalesce(contacto_email, '') || ' ' || coalesce(contacto_telefono, '') from orders where id = $1`, r.ID); c != "sim.carpintero@ejemplo.test 2236000000" {
		t.Errorf("contacto: %q", c)
	}
}

// M4-030: con la regla en «se_rechaza», cancelar el pedido cierra su
// presupuesto con el motivo; con la de siempre vuelve a «aceptado».
func TestPresupuestoDelPedidoCancelado(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	_, ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	motivo := "la obra se posterga"
	cancelar := func() string {
		q := e.presupuesto(t, ven, 1)
		r, err := e.s.ConvertirEnPedido(ctx, ven, q)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := e.s.Cancelar(ctx, ven, r.ID, &motivo); err != nil {
			t.Fatal(err)
		}
		return e.texto(t, `select estado::text || ' ' || coalesce(motivo_rechazo, '') from quotes where id = $1`, q)
	}
	if q := cancelar(); q != "aceptado " {
		t.Errorf("de siempre: %q", q)
	}
	if err := reglas.Fijar(ctx, e.pool, reglas.PresupuestoDelPedidoCancelado, "se_rechaza"); err != nil {
		t.Fatal(err)
	}
	if q := cancelar(); q != "rechazado "+motivo {
		t.Errorf("se rechaza: %q", q)
	}
}

// M4-074: los presupuestos se buscan también por el correo y el teléfono.
func TestPresupuestosPorCorreoYTelefono(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	_, ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	q := e.presupuesto(t, ven, 1)
	e.exec(t, `update quotes set contacto_email = 'sim.irenep@ejemplo.test', contacto_telefono = '+54 9 223 555-0604' where id = $1`, q)
	for _, buscar := range []string{"irenep", "2235550604"} {
		p, err := e.s.ListarPresupuestos(ctx, Filtros{Busqueda: buscar}, 0, 0)
		if err != nil {
			t.Fatal(err)
		}
		if p.Total != 1 {
			t.Errorf("%s: %d", buscar, p.Total)
		}
	}
}
