package precios

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// El ajuste masivo se mira antes de aplicar, se acota a un proveedor o una
// marca, y el último se deshace sin pisar lo que se corrigió a mano después.
func TestAjusteConVistaPreviaYDeshacer(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", "admin")
	u := e.srv.URL + "/api/v1/admin/precios/ajuste"

	var proveedor string
	_ = e.pool.QueryRow(ctx, `insert into suppliers (nombre) values ('Faplac') returning id`).Scan(&proveedor)
	_, _ = e.pool.Exec(ctx, `insert into supplier_variant_codes (supplier_id, variant_id, codigo) values ($1, $2, 'F-18'), ($1, $3, 'F-12')`,
		proveedor, e.fen18, e.fen12)

	// La vista previa no escribe nada y dice cuántos.
	c, b := pedir(t, adm, "POST", u+"/previa", map[string]string{"porcentaje": "10", "listaSlug": "general", "proveedor": proveedor})
	var v VistaDeAjuste
	_ = json.Unmarshal([]byte(b), &v)
	if c != 200 || v.Tocados != 2 || len(v.Muestra) != 2 || v.Muestra[1].Medida != "18 mm" || v.Muestra[1].Antes != "84500.00" || v.Muestra[1].Despues != "92950.00" {
		t.Fatalf("previa: %d %s", c, b)
	}
	if p := e.precio(t, e.fen18, e.general); p != "84500.00" {
		t.Fatalf("la vista previa cambió el precio: %s", p)
	}

	// Aplicado solo a lo del proveedor: la melamina queda igual.
	if c, b := pedir(t, adm, "POST", u, map[string]string{"porcentaje": "10", "listaSlug": "general", "proveedor": proveedor}); c != 200 ||
		!strings.Contains(b, "Se actualizaron 2 precios.") {
		t.Fatalf("ajuste: %d %s", c, b)
	}
	if p := e.precio(t, e.mel, e.general); p != "50000.00" {
		t.Fatalf("tocó lo que no era del proveedor: %s", p)
	}

	// Alguien corrige uno a mano; deshacer vuelve el otro y respeta ese.
	_, _ = e.pool.Exec(ctx, `update price_list_items set price = 90000 where variant_id = $1 and price_list_id = $2`, e.fen12, e.general)
	c, b = pedir(t, adm, "GET", u+"/ultimo", nil)
	if c != 200 || !strings.Contains(b, `"precios":2`) || !strings.Contains(b, `"deshacibles":1`) {
		t.Fatalf("último: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "DELETE", u+"/ultimo", nil); c != 200 || !strings.Contains(b, "1 precio volvió al anterior.") {
		t.Fatalf("deshacer: %d %s", c, b)
	}
	if p := e.precio(t, e.fen18, e.general); p != "84500.00" {
		t.Fatalf("no volvió: %s", p)
	}
	if p := e.precio(t, e.fen12, e.general); p != "90000.00" {
		t.Fatalf("pisó la corrección a mano: %s", p)
	}
	// Dos veces no deshace nada más.
	if c, b := pedir(t, adm, "DELETE", u+"/ultimo", nil); c != 422 || !strings.Contains(b, "ya se deshizo") {
		t.Fatalf("deshacer dos veces: %d %s", c, b)
	}
}
