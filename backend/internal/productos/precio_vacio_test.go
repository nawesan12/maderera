package productos

import (
	"context"
	"encoding/json"
	"testing"
)

// La ficha con el precio general vacío guardaba un «0» en la lista general,
// y con la lista en 0 vender a $0 no se medía como bajo la lista (revisión
// del carril F; la tabla de Precios ya lo rechazaba, M11). Ahora la medida
// queda sin precio.
func TestPrecioVacioNoQuedaEnCero(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	c, b := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/productos",
		e.ficha("Fenólico", map[string]string{"precioGeneral": "", "precioProfesional": ""}))
	if c != 201 {
		t.Fatalf("crear: %d %s", c, b)
	}
	var creado struct{ ID string }
	_ = json.Unmarshal([]byte(b), &creado)
	var n int
	if err := e.pool.QueryRow(context.Background(), `
		select count(*)::int from price_list_items pli join product_variants pv on pv.id = pli.variant_id
		where pv.product_id = $1`, creado.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("quedaron %d precios guardados con el campo vacío", n)
	}
}
