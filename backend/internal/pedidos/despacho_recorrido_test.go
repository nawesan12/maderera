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
