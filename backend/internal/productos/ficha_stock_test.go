package productos

import (
	"context"
	"encoding/json"
	"testing"
)

// La ficha no pisa el físico con lo que vio al abrirse (auditoría del
// 30/10). Antes: con la ficha abierta en 10 se vendían 3, y guardar un
// cambio de precio volvía el físico a 10; un campo vacío lo ponía en 0.
func TestLaFichaNoPisaElStockConUnValorViejo(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", "admin")
	u := e.srv.URL + "/api/v1/admin/productos"
	_, b := pedir(t, adm, "POST", u, e.ficha("Melamina", map[string]string{"stockCentral": "10"}))
	var creado struct{ ID string }
	_ = json.Unmarshal([]byte(b), &creado)
	_, b = pedir(t, adm, "GET", u+"/"+creado.ID, nil)
	var f Ficha
	_ = json.Unmarshal([]byte(b), &f)
	vid := f.Variantes[0].ID
	var central string
	_ = e.pool.QueryRow(ctx, `select id from branches where slug = 'casa-central'`).Scan(&central)
	fisico := func() float64 {
		var q float64
		_ = e.pool.QueryRow(ctx, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, vid, central).Scan(&q)
		return q
	}
	// Con la ficha abierta (vio 10), se venden 3.
	_, _ = e.pool.Exec(ctx, `update inventory set qty = qty - 3 where variant_id = $1 and branch_id = $2`, vid, central)

	guardar := func(campos map[string]string) {
		t.Helper()
		campos["id"] = vid
		if c, b := pedir(t, adm, "PUT", u+"/"+creado.ID, e.ficha("Melamina", campos)); c != 200 {
			t.Fatalf("guardar: %d %s", c, b)
		}
	}
	// Cambia solo el precio: el stock no se toca.
	guardar(map[string]string{"precioGeneral": "90000", "stockCentral": "10", "stockCentralVisto": "10", "stockAserraderoVisto": "0"})
	if q := fisico(); q != 7 {
		t.Errorf("sin tocar el stock quedó %v (quería 7)", q)
	}
	// Lo corrige de 7 a 9 (vio 7): son dos más; entre tanto se vendió una.
	_, _ = e.pool.Exec(ctx, `update inventory set qty = qty - 1 where variant_id = $1 and branch_id = $2`, vid, central)
	guardar(map[string]string{"stockCentral": "9", "stockCentralVisto": "7", "stockAserraderoVisto": "0"})
	if q := fisico(); q != 8 {
		t.Errorf("con la diferencia quedó %v (quería 8)", q)
	}
	// Un campo vacío no lo pone en 0.
	guardar(map[string]string{"stockCentral": "", "stockCentralVisto": "8", "stockAserraderoVisto": "0"})
	if q := fisico(); q != 8 {
		t.Errorf("con el campo vacío quedó %v (quería 8)", q)
	}
	var notas int
	_ = e.pool.QueryRow(ctx, `select count(*) from inventory_movements where variant_id = $1 and branch_id = $2`, vid, central).Scan(&notas)
	if notas != 2 { // el alta (0 → 10) y la corrección (6 → 8)
		t.Errorf("movimientos de la ficha: %d", notas)
	}
}
