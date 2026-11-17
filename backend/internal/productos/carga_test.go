package productos

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Lo que hace falta para cargar el catálogo: el código de barras sin
// repetir, el precio profesional que sigue el porcentaje de la lista cuando
// no se le pone uno, y guardar la ficha sin dar por revisados los precios
// que no cambiaron.
func TestFichaParaLaCargaDelCatalogo(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", "admin")
	u := e.srv.URL + "/api/v1/admin/"

	c, b := pedir(t, adm, "POST", u+"productos", e.ficha("Melamina",
		map[string]string{"sku": "MEL-BL", "codigoBarras": "7790001000018", "precioProfesional": ""}))
	if c != 201 {
		t.Fatalf("crear: %d %s", c, b)
	}
	var creado struct{ ID string }
	_ = json.Unmarshal([]byte(b), &creado)

	// Sin precio profesional no queda una fila en 0 que le gane al porcentaje.
	var filas int
	_ = e.pool.QueryRow(ctx, `select count(*) from price_list_items i join price_lists l on l.id = i.price_list_id
		join product_variants v on v.id = i.variant_id where l.slug = 'profesional' and v.sku = 'MEL-BL'`).Scan(&filas)
	if filas != 0 {
		t.Fatalf("quedó una fila del precio profesional: %d", filas)
	}

	// Otro producto con el mismo código de barras: error en ese campo.
	if c, b := pedir(t, adm, "POST", u+"productos", e.ficha("Aglomerado",
		map[string]string{"sku": "AGL-18", "codigoBarras": "7790001000018"})); c != 422 ||
		!strings.Contains(b, `"variantes.0.codigoBarras"`) {
		t.Fatalf("código repetido: %d %s", c, b)
	}

	// Un código que ya es de otro producto dice de cuál, en su campo (antes
	// era un error 500 sin explicación). Repetido en la misma ficha, también.
	if c, b := pedir(t, adm, "POST", u+"productos", e.ficha("Aglomerado", map[string]string{"sku": "MEL-BL"})); c != 422 ||
		!strings.Contains(b, `"variantes.0.sku":"El código MEL-BL ya es de Melamina."`) {
		t.Fatalf("código de otro producto: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", u+"productos", e.ficha("Aglomerado", map[string]string{"sku": "AGL-1"}, map[string]string{"sku": "agl-1"})); c != 422 ||
		!strings.Contains(b, `"variantes.1.sku"`) {
		t.Fatalf("código repetido en la ficha: %d %s", c, b)
	}

	// Guardar sin cambiar el precio no le toca la fecha.
	var antes time.Time
	_ = e.pool.QueryRow(ctx, `select i.updated_at from price_list_items i join product_variants v on v.id = i.variant_id
		where v.sku = 'MEL-BL'`).Scan(&antes)
	_, b = pedir(t, adm, "GET", u+"productos/"+creado.ID, nil)
	var f Ficha
	_ = json.Unmarshal([]byte(b), &f)
	if f.Variantes[0].CodigoBarras != "7790001000018" {
		t.Fatalf("la ficha no trae el código: %s", b)
	}
	edit := e.ficha("Melamina", map[string]string{"id": f.Variantes[0].ID, "sku": "MEL-BL", "codigoBarras": "7790001000018",
		"precioProfesional": "", "stockCentral": "3"})
	if c, b := pedir(t, adm, "PUT", u+"productos/"+creado.ID, edit); c != 200 {
		t.Fatalf("editar: %d %s", c, b)
	}
	var despues time.Time
	_ = e.pool.QueryRow(ctx, `select i.updated_at from price_list_items i join product_variants v on v.id = i.variant_id
		where v.sku = 'MEL-BL'`).Scan(&despues)
	if !despues.Equal(antes) {
		t.Fatalf("guardar sin cambios movió la fecha del precio: %v → %v", antes, despues)
	}
}

func TestCategoriasDesdeElPanel(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	u := e.srv.URL + "/api/v1/admin/categorias"
	if c, b := pedir(t, adm, "POST", u, map[string]any{"name": "Herrajes"}); c != 204 {
		t.Fatalf("crear: %d %s", c, b)
	}
	if c, b := pedir(t, adm, "POST", u, map[string]any{"name": "herrajes"}); c != 422 || !strings.Contains(b, "Ya hay una categoría") {
		t.Fatalf("repetida: %d %s", c, b)
	}
	var id, slug string
	_ = e.pool.QueryRow(context.Background(), `select id, slug from categories where name = 'Herrajes'`).Scan(&id, &slug)
	if c, b := pedir(t, adm, "PUT", u+"/"+id, map[string]any{"name": "Herrajes y ferretería"}); c != 204 {
		t.Fatalf("renombrar: %d %s", c, b)
	}
	var nombre, slug2 string
	_ = e.pool.QueryRow(context.Background(), `select name, slug from categories where id = $1`, id).Scan(&nombre, &slug2)
	if nombre != "Herrajes y ferretería" || slug2 != slug {
		t.Fatalf("renombrada: %s %s (antes %s)", nombre, slug2, slug)
	}
}
