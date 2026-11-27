package stock

import (
	"context"
	"strings"
	"testing"
)

// El conteo deja el stock en lo que se contó, calculando la diferencia con
// el candado tomado, y el motivo queda en el libro de movimientos.
func TestConteoYMotivo(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/stock/ajuste"

	// 200 bisagras de una: antes eran 200 clics.
	if c, b := pedir(t, dep, "POST", u, map[string]any{"variantId": e.tornillo, "branchSlug": "casa-central", "cantidad": 0, "contado": 200, "motivo": "conteo"}); c != 200 ||
		!strings.Contains(b, "Casa Central: 0 → 200") {
		t.Fatalf("conteo: %d %s", c, b)
	}
	// Contar lo mismo no mueve nada.
	if c, b := pedir(t, dep, "POST", u, map[string]any{"variantId": e.tornillo, "branchSlug": "casa-central", "cantidad": 0, "contado": 200}); c != 200 ||
		!strings.Contains(b, "el conteo coincide") {
		t.Fatalf("conteo igual: %d %s", c, b)
	}
	// Una rotura, con su motivo en el libro.
	if c, b := pedir(t, dep, "POST", u, map[string]any{"variantId": e.tornillo, "branchSlug": "casa-central", "cantidad": -3, "motivo": "rotura"}); c != 200 {
		t.Fatalf("rotura: %d %s", c, b)
	}
	if q := e.qty(t, e.tornillo, e.central); q != 197 {
		t.Fatalf("stock: %v", q)
	}
	var notas string
	_ = e.pool.QueryRow(context.Background(), `select string_agg(note, ' | ' order by created_at) from inventory_movements where variant_id = $1`, e.tornillo).Scan(&notas)
	if notas != "Conteo desde Stock (0 → 200) | Rotura desde Stock (200 → 197)" {
		t.Fatalf("libro: %s", notas)
	}
	// Y en la bitácora, con quién, cuánto y por qué (mes simulado, M2S4-019).
	var renglon string
	_ = e.pool.QueryRow(context.Background(), `select coalesce(max(descripcion), '') from audit_log where entidad = 'stock' and entidad_id = $1 and descripcion like '%Rotura%'`, e.tornillo).Scan(&renglon)
	if !strings.Contains(renglon, "Casa Central: Rotura desde Stock (200 → 197)") {
		t.Fatalf("bitácora: %q", renglon)
	}
	// El lector de código de barras encuentra la medida en la grilla.
	_, _ = e.pool.Exec(context.Background(), `update product_variants set codigo_barras = '7790001000025' where id = $1`, e.tornillo)
	if _, b := pedir(t, dep, "GET", e.srv.URL+"/api/v1/admin/stock?busqueda=7790001000025", nil); !strings.Contains(b, `"sku":"TOR"`) || strings.Contains(b, `"sku":"FEN18"`) {
		t.Fatalf("búsqueda por código de barras: %s", b)
	}
	// Un ajuste con motivo no deja lo disponible por debajo de lo reservado…
	if c, b := pedir(t, dep, "POST", u, map[string]any{"variantId": e.placa, "branchSlug": "casa-central", "cantidad": -6, "motivo": "rotura"}); c != 422 ||
		!strings.Contains(b, "reservado") {
		t.Fatalf("rotura bajo lo reservado: %d %s", c, b)
	}
	// …pero lo contado es lo que hay: el sistema no puede negarse a
	// registrarlo, y el faltante queda a la vista (mes simulado, H218).
	if c, b := pedir(t, dep, "POST", u, map[string]any{"variantId": e.placa, "branchSlug": "casa-central", "cantidad": 0, "contado": 5}); c != 200 ||
		!strings.Contains(b, "10 → 5") {
		t.Fatalf("conteo bajo lo reservado: %d %s", c, b)
	}
}
