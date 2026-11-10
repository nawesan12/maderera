package catalogo

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// La ficha suma usos, cuidados y los documentos públicos del producto y de su
// categoría; de los reservados va solo la cantidad (la ficha se cachea para
// todos).
func TestFichaConUsosYDocumentos(t *testing.T) {
	e := armar(t)
	e.sembrar(t)
	ctx := context.Background()
	ex := func(sql string, args ...any) {
		t.Helper()
		if _, err := e.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	ex(`update products set usos = '  Encofrados y muebles de exterior. ', cuidados = '' where slug = 'fenolico'`)
	doc := func(titulo string, reservado bool) string {
		var id string
		if err := e.pool.QueryRow(ctx, `insert into technical_documents (titulo, categoria, url, formato, solo_profesionales, activo)
			values ($1, 'fichas', 'privado/x.pdf', 'pdf', $2, true) returning id`, titulo, reservado).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	propio, deCategoria, reservado, ajeno := doc("Ficha del fenólico", false), doc("Tabla de cargas de placas", false), doc("Despiece profesional", true), doc("Otro", false)
	ex(`insert into technical_document_targets (document_id, product_id) select $1, id from products where slug = 'fenolico'`, propio)
	ex(`insert into technical_document_targets (document_id, category_id) select $1, id from categories where slug = 'placas'`, deCategoria)
	ex(`insert into technical_document_targets (document_id, product_id) select $1, id from products where slug = 'fenolico'`, reservado)
	ex(`insert into technical_document_targets (document_id, product_id) select $1, id from products where slug = 'melamina'`, ajeno)

	_, b := pedir(t, &http.Client{}, e.srv.URL+"/api/v1/catalogo/productos/fenolico?publico=true")
	var p ProductoDetalle
	_ = json.Unmarshal([]byte(b), &p)
	if p.Usos == nil || *p.Usos != "Encofrados y muebles de exterior." || p.Cuidados != nil {
		t.Errorf("usos y cuidados: %s", b)
	}
	if len(p.Documentos) != 2 || p.DocumentosReservados != 1 || strings.Contains(b, "Despiece profesional") || strings.Contains(b, "Otro") {
		t.Errorf("documentos: %s", b)
	}
	if len(p.Documentos) > 0 && p.Documentos[0].URL != "/api/v1/contenido/documentos/"+p.Documentos[0].ID+"/archivo" {
		t.Errorf("url: %s", p.Documentos[0].URL)
	}
}
