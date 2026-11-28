package reportes

import (
	"strings"
	"testing"
)

// La campana del aserradero (mes 23, admin-atencion-Ndueña-admin-1): pedía
// lo pendiente en cada pantalla y Go contestaba 403. Ahora contesta lo suyo
// y nada de lo del admin.
func TestLaCampanaDelAserradero(t *testing.T) {
	e := armar(t)
	ase := e.staff(t, "aserradero@prueba.test", "aserradero")
	e.exec(t, `insert into quotes (numero, contacto_nombre, estado) values ('P-9', 'Y', 'aceptado')`)
	c, b, _ := pedir(t, ase, e.u+"inicio/pendientes")
	if c != 200 || strings.Contains(b, "presupuestos") {
		t.Errorf("aserradero: %d %s", c, b)
	}
}
