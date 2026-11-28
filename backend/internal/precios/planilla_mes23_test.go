package precios

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"testing"
)

// La planilla exportada vuelve a entrar sin tocarla aunque una medida no
// tenga precio de lista (mes 23, M2S1-044: «Escalera a medida» salía con
// «0,00» y daba «1 con problemas»). El cero de lista de una medida que sí
// tiene precio sigue siendo un error: la regalaba.
func TestLaPlanillaSinPrecioDeListaVuelveAEntrar(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	var prod string
	if err := e.pool.QueryRow(context.Background(), `select product_id::text from product_variants where id = $1`, e.mel).Scan(&prod); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(context.Background(), `insert into product_variants (product_id, sku, label) values ($1, 'DEC-ESC-PIN-MED', 'A medida')`, prod); err != nil {
		t.Fatal(err)
	}
	subir := func(contenido string) VistaPrevia {
		var b bytes.Buffer
		w := multipart.NewWriter(&b)
		p, _ := w.CreateFormFile("archivo", "precios.csv")
		_, _ = p.Write([]byte(contenido))
		_ = w.Close()
		_, cuerpo := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/precios/importar/previa", &b, w.FormDataContentType())
		var v VistaPrevia
		if err := json.Unmarshal([]byte(cuerpo), &v); err != nil {
			t.Fatal(cuerpo)
		}
		return v
	}
	if v := subir("DEC-ESC-PIN-MED;0.00;"); v.Problemas != 0 || v.Iguales != 1 {
		t.Errorf("sin precio de lista: %+v", v)
	}
	if v := subir("FEN12;0;"); v.Problemas != 1 {
		t.Errorf("el cero de una medida con precio sigue siendo error: %+v", v)
	}
}
