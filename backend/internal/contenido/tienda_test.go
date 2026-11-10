package contenido

import (
	"context"
	"strings"
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

// Atar un documento a productos y categorías reemplaza lo anterior, se ve en
// el listado del panel y lo puede hacer quien atiende el catálogo.
func TestDestinosDeDocumento(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.cliente(t, "admin@prueba.test", "admin")
	q := func(sql string) string {
		var id string
		if err := e.pool.QueryRow(ctx, sql).Scan(&id); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	cat := q(`insert into categories (slug, name, description) values ('placas', 'Placas', '') returning id`)
	prod := q(`insert into products (slug, name, category_id, description) select 'fenolico', 'Fenólico', id, '' from categories returning id`)
	doc := q(`insert into technical_documents (titulo, categoria, url, formato) values ('Ficha', 'fichas', 'x.pdf', 'pdf') returning id`)
	u := e.srv.URL + "/api/v1/admin/documentos/"

	if c, b := pedir(t, adm, "PUT", u+doc+"/destinos", map[string]any{"productos": []string{prod, "00000000-0000-0000-0000-000000000000"}, "categorias": []string{cat}}); c != 204 {
		t.Fatalf("guardar: %d %s", c, b)
	}
	_, b := pedir(t, adm, "GET", strings.TrimSuffix(u, "/"), nil)
	if !strings.Contains(string(b), `"productos":[{"id":"`+prod+`","nombre":"Fenólico"}]`) || !strings.Contains(string(b), `"categorias":[{"id":"`+cat+`","nombre":"Placas"}]`) {
		t.Errorf("listado: %s", b)
	}
	pedir(t, adm, "PUT", u+doc+"/destinos", map[string]any{"productos": []string{}, "categorias": []string{cat}})
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from technical_document_targets`).Scan(&n)
	if n != 1 {
		t.Errorf("reemplazar dejó %d destinos", n)
	}
	if c, _ := pedir(t, adm, "PUT", u+"00000000-0000-0000-0000-000000000000/destinos", map[string]any{"productos": []string{}, "categorias": []string{}}); c != 404 {
		t.Errorf("documento inexistente: %d", c)
	}
}
