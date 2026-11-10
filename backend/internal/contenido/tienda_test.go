package contenido

import (
	"context"
	"testing"

	"mjbj/internal/pruebas"
)

// Los interruptores de la tienda solo valen «si» o «no», y prenderlos o
// apagarlos queda en la bitácora con quién lo hizo.
func TestInterruptoresDeLaTienda(t *testing.T) {
	e := armar(t)
	pruebas.TiendaApagada(t, e.pool)
	adm := e.cliente(t, "admin@prueba.test", "admin")
	u := e.srv.URL + "/api/v1/admin/contenido/ajustes/"

	if c, b := pedir(t, adm, "PUT", u+"tienda_activa", map[string]string{"valor": "quizás"}); c != 422 {
		t.Errorf("valor inválido: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "PUT", u+"tienda_activa", map[string]string{"valor": "si"}); c != 204 {
		t.Fatalf("encender: %d %s", c, b)
	}
	var desc, quien string
	if err := e.pool.QueryRow(context.Background(),
		`select descripcion, usuario_email from audit_log where entidad = 'tienda' and entidad_id = 'tienda_activa'`).Scan(&desc, &quien); err != nil {
		t.Fatal(err)
	}
	if desc != "Encendió la tienda online" || quien != "admin@prueba.test" {
		t.Errorf("bitácora: %q %q", desc, quien)
	}
	// Un texto común no pasa por la bitácora.
	_, _ = e.pool.Exec(context.Background(), `insert into site_settings (clave, valor) values ('telefono', '223 000')`)
	pedir(t, adm, "PUT", u+"telefono", map[string]string{"valor": "223 590-3118"})
	var n int
	_ = e.pool.QueryRow(context.Background(), `select count(*) from audit_log`).Scan(&n)
	if n != 1 {
		t.Errorf("líneas en la bitácora: %d", n)
	}
}
