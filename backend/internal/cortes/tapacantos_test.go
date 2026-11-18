package cortes

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestMedidaEnOrden(t *testing.T) {
	casos := []struct {
		etiqueta     string
		largo, ancho int32
		quiere       string
	}{
		{"1220 x 2440mm", 2440, 1220, "2440 × 1220 mm"},
		{"1830 x 2600mm — 18mm", 2600, 1830, "2600 × 1830 mm — 18mm"},
		{"2750 x 1830 — 18mm", 2750, 1830, "2750 × 1830 mm — 18mm"},
		{"2440×1220", 2440, 1220, "2440 × 1220 mm"},
		// Una medida que no es la de la variante no se toca.
		{"1220 x 2440mm", 3050, 1220, "1220 x 2440mm"},
		{"Blanco 18mm", 2750, 1830, "Blanco 18mm"},
		{"1220 x 2440mm", 0, 0, "1220 x 2440mm"},
	}
	for _, c := range casos {
		if got := MedidaEnOrden(c.etiqueta, c.largo, c.ancho); got != c.quiere {
			t.Errorf("MedidaEnOrden(%q, %d, %d) = %q, quería %q", c.etiqueta, c.largo, c.ancho, got, c.quiere)
		}
	}
}

func TestEspesorYTipoDeTapacanto(t *testing.T) {
	dos := int32(2)
	veintidos := int32(22)
	casos := []struct {
		texto  string
		campo  *int32
		grosor float64 // 0 es nulo
		tipo   string  // "" es nulo
	}{
		{"Tapacanto PVC Blanco 22 x 0,45 mm", nil, 0.45, "PVC"},
		{"Tapacanto PVC 22mm x 2mm", nil, 2, "PVC"},
		{"Tapacanto melamínico Roble 0.45", nil, 0.45, "Melamínico"},
		{"Tapacanto ABS Gris", &dos, 2, "ABS"},
		// El ancho del rollo no es el espesor.
		{"Tapacanto Negro 22 mm", &veintidos, 0, ""},
		{"Tapacanto Blanco", nil, 0, ""},
	}
	for _, c := range casos {
		e := EspesorDeTapacanto(c.texto, c.campo)
		if (e == nil) != (c.grosor == 0) || (e != nil && *e != c.grosor) {
			t.Errorf("espesor de %q: %v, quería %v", c.texto, e, c.grosor)
		}
		tp := TipoDeTapacanto(c.texto)
		if (tp == nil) != (c.tipo == "") || (tp != nil && *tp != c.tipo) {
			t.Errorf("tipo de %q: %v, quería %q", c.texto, tp, c.tipo)
		}
	}
}

// El desplegable del armador: lo del rubro «Tapacantos» o con el nombre, sin
// las variantes apagadas ni lo que no es tapacanto. Y las placas con la
// medida en el orden del plano.
func TestTapacantosYPlacasDelSitio(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	q := func(sql string, args ...any) string {
		var id string
		if err := e.pool.QueryRow(ctx, sql, args...).Scan(&id); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	u := e.srv.URL + "/api/v1/cortes/tapacantos"
	if code, b := pedir(t, http.DefaultClient, "GET", u, nil); code != 200 || strings.TrimSpace(b) != "[]" {
		t.Fatalf("sin tapacantos: %d %s", code, b)
	}

	ferr := q(`insert into categories (slug, name, description) values ('ferreteria', 'Ferretería', '') returning id`)
	rubro := q(`insert into subcategories (category_id, slug, name) values ($1, 'tapacantos', 'Tapacantos') returning id`, ferr)
	pr := q(`insert into products (slug, name, category_id, subcategory_id, description, unit) values ('canto-pvc', 'Cinta PVC', $1, $2, '', 'unidad') returning id`, ferr, rubro)
	pn := q(`insert into products (slug, name, category_id, description, unit) values ('tapacanto-mel', 'Tapacanto melamínico', $1, '', 'unidad') returning id`, ferr)
	po := q(`insert into products (slug, name, category_id, description, unit) values ('tornillo', 'Tornillo 4x40', $1, '', 'unidad') returning id`, ferr)
	_ = q(`insert into product_variants (product_id, sku, label, color, sort_order) values ($1, 'PVC-B', 'Blanco 22 x 0,45 mm', 'Blanco', 1) returning id`, pr)
	_ = q(`insert into product_variants (product_id, sku, label, color, espesor_mm, sort_order) values ($1, 'PVC-N', 'Negro 22mm', 'Negro', 2, 2) returning id`, pr)
	_ = q(`insert into product_variants (product_id, sku, label, active) values ($1, 'PVC-V', 'Viejo', false) returning id`, pr)
	_ = q(`insert into product_variants (product_id, sku, label, color) values ($1, 'MEL-R', 'Roble 0.45', 'Roble') returning id`, pn)
	_ = q(`insert into product_variants (product_id, sku, label) values ($1, 'T440', 'Caja x 100') returning id`, po)

	code, b := pedir(t, http.DefaultClient, "GET", u, nil)
	var lista []Tapacanto
	_ = json.Unmarshal([]byte(b), &lista)
	if code != 200 || len(lista) != 3 {
		t.Fatalf("tapacantos: %d %s", code, b)
	}
	if l := lista[0]; l.Descripcion != "Cinta PVC — Blanco 22 x 0,45 mm" || l.Tipo == nil || *l.Tipo != "PVC" ||
		l.EspesorMm == nil || *l.EspesorMm != 0.45 || l.Color == nil || *l.Color != "Blanco" {
		t.Errorf("el blanco: %+v", l)
	}
	if l := lista[1]; l.EspesorMm == nil || *l.EspesorMm != 2 {
		t.Errorf("el negro toma el espesor del campo: %+v", l)
	}
	if l := lista[2]; l.Tipo == nil || *l.Tipo != "Melamínico" || l.EspesorMm == nil || *l.EspesorMm != 0.45 {
		t.Errorf("el melamínico: %+v", l)
	}

	fibro := otraPlaca(t, e)
	_, b = pedir(t, http.DefaultClient, "GET", e.srv.URL+"/api/v1/cortes/placas?publico=true", nil)
	var placas []PlacaCortable
	_ = json.Unmarshal([]byte(b), &placas)
	descripciones := map[string]bool{}
	for _, p := range placas {
		descripciones[p.Descripcion] = true
	}
	if !descripciones["Melamina Blanca — 2750 × 1830 mm — 18mm"] || !descripciones["Fibrofácil — 2600 × 1830 mm — 3mm"] || fibro == "" {
		t.Errorf("las placas, en largo × ancho: %s", b)
	}
}

// otraPlaca es un fondo de 3 mm cortable (rubro «Placas», con precio y
// tarifa), cargado como viene del catálogo: ancho primero.
func otraPlaca(t *testing.T, e *entorno) string {
	t.Helper()
	ctx := context.Background()
	var cat, prod, id string
	if err := e.pool.QueryRow(ctx, `select id::text from categories where slug = 'placas'`).Scan(&cat); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(ctx, `insert into products (slug, name, category_id, description, unit) values ('fibro', 'Fibrofácil', $1, '', 'placa') returning id`, cat).Scan(&prod); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(ctx, `insert into product_variants (product_id, sku, label, largo_mm, ancho_mm) values ($1, 'FIB3', '1830 x 2600mm — 3mm', 2600, 1830) returning id`, prod).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 21000)`, e.general, id); err != nil {
		t.Fatal(err)
	}
	return id
}
