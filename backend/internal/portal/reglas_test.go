package portal

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/reglas"
)

// H085: con la regla en «no» (arranque) el cliente solo contesta los
// presupuestos enviados; en «si», también los pendientes que el vendedor
// todavía no mandó. El de revisión del bot nunca.
func TestAceptarPresupuestoPendiente(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, idJuan := e.web(t, "juan@prueba.test")
	u := e.srv.URL + "/api/v1/cuenta/"
	if _, err := e.pool.Exec(ctx, `insert into quotes (numero, customer_id, contacto_nombre, estado, subtotal, total) values
		('P-2026-0101', $1, 'Juan', 'pendiente', 1000, 1000),
		('P-2026-0102', $1, 'Juan', 'enviado', 2000, 2000),
		('P-2026-0103', $1, 'Juan', 'revision', 3000, 3000)`, idJuan); err != nil {
		t.Fatal(err)
	}

	_, b := pedir(t, juan, "GET", u+"presupuestos", nil)
	if strings.Count(b, `"aResponder":true`) != 1 {
		t.Errorf("arranque, a responder: %s", b)
	}
	if _, b := pedir(t, juan, "GET", u+"resumen", nil); !strings.Contains(b, `"presupuestosAResponder":1`) {
		t.Errorf("arranque, resumen: %s", b)
	}
	if c, _ := pedir(t, juan, "POST", u+"presupuestos/P-2026-0101/respuesta", map[string]string{"respuesta": "aceptado"}); c != 422 {
		t.Errorf("arranque: aceptó un pendiente (%d)", c)
	}

	if err := reglas.Fijar(ctx, e.pool, reglas.AceptarPresupuestoPendiente, "si"); err != nil {
		t.Fatal(err)
	}
	_, b = pedir(t, juan, "GET", u+"presupuestos", nil)
	if strings.Count(b, `"aResponder":true`) != 2 {
		t.Errorf("con la regla, a responder: %s", b)
	}
	if _, b := pedir(t, juan, "GET", u+"presupuestos/P-2026-0101", nil); !strings.Contains(b, `"aResponder":true`) {
		t.Errorf("detalle del pendiente: %s", b)
	}
	if _, b := pedir(t, juan, "GET", u+"resumen", nil); !strings.Contains(b, `"presupuestosAResponder":2`) {
		t.Errorf("con la regla, resumen: %s", b)
	}
	if c, b := pedir(t, juan, "POST", u+"presupuestos/P-2026-0101/respuesta", map[string]string{"respuesta": "aceptado"}); c != 200 {
		t.Fatalf("con la regla, aceptar el pendiente: %d %s", c, b)
	}
	var estado string
	_ = e.pool.QueryRow(ctx, `select estado::text from quotes where numero = 'P-2026-0101'`).Scan(&estado)
	if estado != "aceptado" {
		t.Errorf("quedó %q", estado)
	}
	if c, _ := pedir(t, juan, "POST", u+"presupuestos/P-2026-0103/respuesta", map[string]string{"respuesta": "aceptado"}); c != 422 {
		t.Errorf("aceptó uno en revisión (%d)", c)
	}
}

// H079: con la regla en «ninguno», ni siquiera la ficha que todavía no
// facturó cambia lo fiscal desde Mi cuenta; el nombre sí.
func TestDatosFiscalesSoloLaCasa(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	juan, _ := e.web(t, "juan@prueba.test")
	u := e.srv.URL + "/api/v1/cuenta/"
	if _, b := pedir(t, juan, "GET", u+"ficha", nil); !strings.Contains(b, `"datosFiscalesFijos":false`) {
		t.Fatalf("arranque: %s", b)
	}
	if err := reglas.Fijar(ctx, e.pool, reglas.DatosFiscalesDelCliente, "ninguno"); err != nil {
		t.Fatal(err)
	}
	if _, b := pedir(t, juan, "GET", u+"ficha", nil); !strings.Contains(b, `"datosFiscalesFijos":true`) {
		t.Errorf("con la regla: %s", b)
	}
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "Juan", "cuit": "23-33555013-7", "condicionIva": "monotributista"}); c != 422 ||
		!strings.Contains(b, "desde el local") {
		t.Errorf("cambió lo fiscal: %d %s", c, b)
	}
	if c, b := pedir(t, juan, "PUT", u+"datos", map[string]string{"nombre": "Juan Pérez"}); c != 200 {
		t.Errorf("el nombre: %d %s", c, b)
	}
}
