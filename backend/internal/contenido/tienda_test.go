package contenido

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/pruebas"
	reglasdel "mjbj/internal/reglas"
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

// Las reglas que esperan al contador (00290): solo aceptan sus opciones,
// arrancan con el comportamiento de antes y cada cambio queda en la
// bitácora con el antes y el después. El depósito no las toca.
func TestReglasQueEsperanAlContador(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.cliente(t, "admin@prueba.test", "admin")
	ven := e.cliente(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/contenido/ajustes/"

	for clave, opciones := range reglasdel.Opciones {
		var v string
		if err := e.pool.QueryRow(ctx, `select valor from site_settings where clave = $1`, clave).Scan(&v); err != nil {
			t.Fatalf("%s sin fila: %v", clave, err)
		}
		if v != opciones[0] {
			t.Errorf("%s arranca en %q, no en %q", clave, v, opciones[0])
		}
	}
	if c, b := pedir(t, adm, "PUT", u+"venta_reconocida", map[string]string{"valor": "cuando_quiera"}); c != 422 {
		t.Errorf("valor inválido: %d %s", c, b)
	}
	if c, _ := pedir(t, ven, "PUT", u+"venta_reconocida", map[string]string{"valor": "tomar"}); c != 403 {
		t.Errorf("el depósito cambió una regla: %d", c)
	}
	if c, b := pedir(t, adm, "PUT", u+"venta_reconocida", map[string]string{"valor": "tomar"}); c != 204 {
		t.Fatalf("guardar: %d %s", c, b)
	}
	// Guardar lo mismo otra vez no anota nada.
	pedir(t, adm, "PUT", u+"venta_reconocida", map[string]string{"valor": "tomar"})
	var desc string
	var n int
	if err := e.pool.QueryRow(ctx, `select max(descripcion), count(*) from audit_log where entidad = 'regla' and entidad_id = 'venta_reconocida'`).Scan(&desc, &n); err != nil {
		t.Fatal(err)
	}
	if n != 1 || desc != "Regla «venta_reconocida»: entregar_o_facturar → tomar" {
		t.Errorf("bitácora: %d %q", n, desc)
	}
	if !reglasdel.Es(ctx, e.pool, reglasdel.VentaReconocida, "tomar") {
		t.Error("reglas.Es no lee lo guardado")
	}
	// Una fila con basura se lee como el de arranque.
	_, _ = e.pool.Exec(ctx, `update site_settings set valor = 'x' where clave = 'venta_reconocida'`)
	if v, _ := reglasdel.Valor(ctx, e.pool, reglasdel.VentaReconocida); v != "entregar_o_facturar" {
		t.Errorf("basura: %q", v)
	}
}
