package cuentas

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"mjbj/internal/auth"
)

// El personal desde el panel (mes simulado, H006): la dueña da de alta a un
// vendedor, que entra con la contraseña inicial y aparece en Vendedores; le
// cambia el puesto, le da la baja y la sesión se cierra. Nadie se saca su
// propio puesto, siempre queda un admin, una cuenta de cliente conserva su
// clave y solo el admin entra.
func TestPersonalDesdeElPanel(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "duena@prueba.test", "admin")
	ven := e.staff(t, "vende@prueba.test", "vendedor")
	u := e.srv.URL + "/api/v1/admin/personal"

	if c, _ := pedir(t, ven, "GET", u, nil); c != 403 {
		t.Fatalf("el vendedor no entra a Personal: %d", c)
	}

	// Alta de una vendedora nueva.
	c, cuerpo := pedir(t, adm, "POST", u, map[string]string{"nombre": "Ana Rodríguez", "correo": " Ana@Prueba.test ", "rol": "vendedor", "clave": "corta"})
	if c != 422 || !strings.Contains(cuerpo, "8 caracteres") {
		t.Fatalf("clave corta: %d %s", c, cuerpo)
	}
	c, cuerpo = pedir(t, adm, "POST", u, map[string]string{"nombre": "Ana Rodríguez", "correo": " Ana@Prueba.test ", "rol": "vendedor", "clave": "una clave inicial"})
	if c != 200 || !strings.Contains(cuerpo, "Ana Rodríguez ya puede entrar") {
		t.Fatalf("alta: %d %s", c, cuerpo)
	}
	w := httptest.NewRecorder()
	if _, err := e.ses.Entrar(ctx, w, "ana@prueba.test", "una clave inicial", "", "", true); err != nil {
		t.Fatalf("entra con la clave inicial: %v", err)
	}
	var activa bool
	if err := e.pool.QueryRow(ctx, `SELECT activo FROM sellers WHERE nombre = 'Ana Rodríguez'`).Scan(&activa); err != nil || !activa {
		t.Fatalf("queda en Vendedores: %v %v", activa, err)
	}
	if c, cuerpo = pedir(t, adm, "POST", u, map[string]string{"nombre": "Ana", "correo": "ana@prueba.test", "rol": "deposito", "clave": "otra clave larga"}); c != 422 ||
		!strings.Contains(cuerpo, "Ya es del personal") {
		t.Fatalf("dos veces: %d %s", c, cuerpo)
	}

	// Una cuenta de cliente que pasa al personal conserva su clave.
	if _, err := e.ses.AltaDeCliente(ctx, "cliente@prueba.test", "la clave del cliente", "Carlos"); err != nil {
		t.Fatal(err)
	}
	c, cuerpo = pedir(t, adm, "POST", u, map[string]string{"nombre": "Carlos", "correo": "cliente@prueba.test", "rol": "deposito", "clave": "otra clave larga"})
	if c != 200 || !strings.Contains(cuerpo, "la contraseña que ya tenía") {
		t.Fatalf("cliente al personal: %d %s", c, cuerpo)
	}
	if _, err := e.ses.Entrar(ctx, httptest.NewRecorder(), "cliente@prueba.test", "la clave del cliente", "", "", true); err != nil {
		t.Fatalf("la clave del cliente sigue: %v", err)
	}

	_, cuerpo = pedir(t, adm, "GET", u, nil)
	var lista []auth.Persona
	if err := json.Unmarshal([]byte(cuerpo), &lista); err != nil {
		t.Fatal(cuerpo)
	}
	ids := map[string]string{}
	for _, p := range lista {
		ids[p.Correo] = p.ID
	}
	if len(lista) != 4 || lista[0].Rol != "admin" || ids["ana@prueba.test"] == "" {
		t.Fatalf("lista: %s", cuerpo)
	}

	// Nadie se cambia el suyo, y el único admin no se va.
	if c, _ := pedir(t, adm, "POST", u+"/"+ids["duena@prueba.test"]+"/puesto", map[string]string{"rol": "vendedor"}); c != 422 {
		t.Errorf("su propio puesto: %d", c)
	}
	if c, _ := pedir(t, adm, "POST", u+"/"+ids["duena@prueba.test"]+"/baja", nil); c != 422 {
		t.Errorf("su propia baja: %d", c)
	}
	// Ana pasa a admin; ahora la dueña tendría con quién quedar, pero igual
	// no se baja a sí misma. Ana sí puede volver a ventas.
	if c, cuerpo := pedir(t, adm, "POST", u+"/"+ids["ana@prueba.test"]+"/puesto", map[string]string{"rol": "admin"}); c != 200 {
		t.Fatalf("a admin: %d %s", c, cuerpo)
	}
	if c, cuerpo := pedir(t, adm, "POST", u+"/"+ids["ana@prueba.test"]+"/puesto", map[string]string{"rol": "vendedor"}); c != 200 {
		t.Fatalf("de vuelta a ventas: %d %s", c, cuerpo)
	}

	// La baja cierra sus sesiones y la saca de Vendedores.
	c, cuerpo = pedir(t, adm, "POST", u+"/"+ids["ana@prueba.test"]+"/baja", nil)
	if c != 200 || !strings.Contains(cuerpo, "ya no entra al panel") {
		t.Fatalf("baja: %d %s", c, cuerpo)
	}
	var sesiones int
	var rol *string
	_ = e.pool.QueryRow(ctx, `SELECT count(*)::int FROM session WHERE user_id = $1`, ids["ana@prueba.test"]).Scan(&sesiones)
	_ = e.pool.QueryRow(ctx, `SELECT staff_role::text FROM profiles WHERE user_id = $1`, ids["ana@prueba.test"]).Scan(&rol)
	_ = e.pool.QueryRow(ctx, `SELECT activo FROM sellers WHERE nombre = 'Ana Rodríguez'`).Scan(&activa)
	if sesiones != 0 || rol != nil || activa {
		t.Errorf("después de la baja: %d sesiones, rol %v, vendedora activa %v", sesiones, rol, activa)
	}
	// Y su clave ya no abre la cuenta (antes entraba a Mi cuenta como
	// cliente). Si vuelve al personal, el alta le pide una clave nueva.
	if _, err := e.ses.Entrar(ctx, httptest.NewRecorder(), "ana@prueba.test", "una clave inicial", "", "", true); err == nil {
		t.Errorf("la persona dada de baja sigue entrando con su clave")
	}
	if c, _ := pedir(t, adm, "POST", u+"/"+ids["ana@prueba.test"]+"/baja", nil); c != 404 {
		t.Errorf("dos bajas: %d", c)
	}
	c, cuerpo = pedir(t, adm, "POST", u, map[string]string{"nombre": "Ana Rodríguez", "correo": "ana@prueba.test", "rol": "vendedor", "clave": "otra clave nueva"})
	if c != 200 {
		t.Fatalf("vuelve al personal: %d %s", c, cuerpo)
	}
	if _, err := e.ses.Entrar(ctx, httptest.NewRecorder(), "ana@prueba.test", "otra clave nueva", "", "", true); err != nil {
		t.Errorf("vuelve con la clave nueva: %v", err)
	}
	_, _ = pedir(t, adm, "POST", u+"/"+ids["ana@prueba.test"]+"/baja", nil)
	var anotadas int
	_ = e.pool.QueryRow(ctx, `SELECT count(*)::int FROM audit_log WHERE entidad = 'usuario' AND entidad_id = $1`, ids["ana@prueba.test"]).Scan(&anotadas)
	if anotadas != 6 {
		t.Errorf("bitácora: %d", anotadas)
	}
}
