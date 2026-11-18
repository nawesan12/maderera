package productos

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

// El listado de a páginas: los conteos de cada estado con el filtro puesto,
// el estado elegido en la consulta, y las páginas sin repetir.
func TestListadoPaginadoYEstados(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", "admin")
	u := e.srv.URL + "/api/v1/admin/productos"
	ids := map[string]string{}
	for _, n := range []string{"Fenólico A", "Fenólico B", "Melamina", "Terciado", "Oculto"} {
		c, b := pedir(t, adm, "POST", u, e.ficha(n, map[string]string{"sku": "S-" + GenerarSlug(n), "stockCentral": "2"}))
		if c != 201 {
			t.Fatalf("%s: %d %s", n, c, b)
		}
		var x struct{ ID string }
		_ = json.Unmarshal([]byte(b), &x)
		ids[n] = x.ID
	}
	// Melamina sin precio, Terciado sin stock y con foto, Oculto dado de baja.
	_, _ = e.pool.Exec(ctx, `delete from price_list_items where variant_id in (select id from product_variants where product_id = $1)`, ids["Melamina"])
	_, _ = e.pool.Exec(ctx, `update inventory set qty = 0 where variant_id in (select id from product_variants where product_id = $1)`, ids["Terciado"])
	_, _ = e.pool.Exec(ctx, `insert into product_images (product_id, url) values ($1, '/fotos/t.jpg')`, ids["Terciado"])
	_, _ = e.pool.Exec(ctx, `update products set active = false where id = $1`, ids["Oculto"])
	_, _ = e.pool.Exec(ctx, `update products set brand = ' Faplac' where id = $1`, ids["Melamina"])
	_, _ = e.pool.Exec(ctx, `update products set brand = 'faplac' where id = $1`, ids["Terciado"])

	leer := func(q string) ListaDeProductos {
		t.Helper()
		c, b := pedir(t, adm, "GET", u+q, nil)
		if c != 200 {
			t.Fatalf("%s: %d %s", q, c, b)
		}
		var l ListaDeProductos
		_ = json.Unmarshal([]byte(b), &l)
		return l
	}
	l := leer("?limite=2")
	if l.Total != 5 || len(l.Filas) != 2 || l.Conteos != (ConteosDeProductos{Todos: 5, SinFoto: 3, SinPrecio: 1, SinStock: 1, Ocultos: 1}) {
		t.Fatalf("primera página: %+v", l)
	}
	vistos := map[string]bool{}
	for desde := 0; desde < 5; desde += 2 {
		for _, p := range leer("?limite=2&desplazamiento=" + strconv.Itoa(desde)).Filas {
			if vistos[p.ID] {
				t.Errorf("%s repetido entre páginas", p.Name)
			}
			vistos[p.ID] = true
		}
	}
	if len(vistos) != 5 {
		t.Errorf("las páginas trajeron %d de 5", len(vistos))
	}
	for q, quiero := range map[string]string{"?estado=sin-precio": "Melamina", "?estado=sin-stock": "Terciado", "?estado=ocultos": "Oculto"} {
		if r := leer(q); r.Total != 1 || len(r.Filas) != 1 || r.Filas[0].Name != quiero {
			t.Errorf("%s: %+v", q, r.Filas)
		}
	}
	if r := leer("?estado=sin-foto&busqueda=fenol"); r.Total != 2 || r.Conteos.Todos != 2 {
		t.Errorf("sin foto con búsqueda: %+v", r)
	}
	// La marca, sin importar la mayúscula ni los espacios.
	if r := leer("?marca=FAPLAC"); r.Total != 2 {
		t.Errorf("por marca: %d", r.Total)
	}
	c, b := pedir(t, adm, "GET", e.srv.URL+"/api/v1/admin/productos-marcas", nil)
	if c != 200 || strings.ToLower(b) != "[\"faplac\"]\n" {
		t.Errorf("marcas: %d %s", c, b)
	}
}

// La ficha muestra una columna por sucursal activa de la base y guarda el
// stock por id: una tercera sucursal aparece sola, una dada de baja no.
func TestFichaConLasSucursalesDeLaBase(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", "admin")
	u := e.srv.URL + "/api/v1/admin/productos"
	var puerto string
	_ = e.pool.QueryRow(ctx, `insert into branches (slug, name, sort_order) values ('puerto', 'Puerto', 3) returning id`).Scan(&puerto)
	_, _ = e.pool.Exec(ctx, `insert into branches (slug, name, sort_order, active) values ('cerrada', 'Cerrada', 4, false)`)

	alta := e.ficha("Fenólico", map[string]string{})
	v := alta["variantes"].([]map[string]string)[0]
	delete(v, "stockCentral")
	delete(v, "stockAserradero")
	delete(v, "minCentral")
	delete(v, "minAserradero")
	cuerpo := map[string]any{}
	for k, x := range alta {
		cuerpo[k] = x
	}
	variante := map[string]any{}
	for k, x := range v {
		variante[k] = x
	}
	variante["stocks"] = []map[string]string{{"sucursal": puerto, "stock": "4", "minimo": "1"}}
	cuerpo["variantes"] = []map[string]any{variante}
	c, b := pedir(t, adm, "POST", u, cuerpo)
	if c != 201 {
		t.Fatalf("alta: %d %s", c, b)
	}
	var creado struct{ ID string }
	_ = json.Unmarshal([]byte(b), &creado)
	_, b = pedir(t, adm, "GET", u+"/"+creado.ID, nil)
	var f Ficha
	_ = json.Unmarshal([]byte(b), &f)
	if len(f.Sucursales) != 3 || f.Sucursales[2].Slug != "puerto" || len(f.Variantes[0].Stocks) != 3 {
		t.Fatalf("sucursales de la ficha: %s", b)
	}
	if st := f.Variantes[0].StockEn(puerto); st.Stock != 4 || st.Minimo != 1 {
		t.Errorf("stock en la sucursal nueva: %+v", st)
	}
	// Las otras dos no se tocaron: no vinieron.
	var filas int
	_ = e.pool.QueryRow(ctx, `select count(*) from inventory where variant_id = $1`, f.Variantes[0].ID).Scan(&filas)
	if filas != 1 {
		t.Errorf("filas de inventario: %d", filas)
	}
	// Una sucursal que no existe, con su campo.
	variante["stocks"] = []map[string]string{{"sucursal": "00000000-0000-4000-8000-000000000000", "stock": "1"}}
	variante["sku"] = "OTRO"
	cuerpo["name"], cuerpo["slug"] = "Otro", "otro"
	if c, b := pedir(t, adm, "POST", u, cuerpo); c != 422 || !strings.Contains(b, `"variantes.0.stocks.0.sucursal":"No se encontró la sucursal."`) {
		t.Errorf("sucursal inexistente: %d %s", c, b)
	}
	// Decimales en un producto por unidad, con el campo nuevo.
	cuerpo["unit"] = "unidad"
	variante["stocks"] = []map[string]string{{"sucursal": puerto, "stock": "1,5"}}
	if c, b := pedir(t, adm, "POST", u, cuerpo); c != 422 || !strings.Contains(b, `"variantes.0.stocks.0.stock"`) {
		t.Errorf("decimales: %d %s", c, b)
	}
}

func TestNombreCorto(t *testing.T) {
	for nombre, quiero := range map[string]string{
		"Fenólico":                 "Fenólico",
		"  Placa   de  melamina  ": "Placa de melamina",
		"Placa de melamina blanca texturada 18 mm Faplac":      "Placa de melamina blanca texturada 18…",
		"Aglomeradoconunnombrelarguísimosinespaciosparacortar": "Aglomeradoconunnombrelarguísimosinespac…",
	} {
		if got := NombreCorto(nombre); got != quiero {
			t.Errorf("NombreCorto(%q) = %q, quiero %q", nombre, got, quiero)
		}
	}
}

// Las etiquetas: EAN-13 si el código de barras es válido, Code 128 con el
// SKU si no hay; el precio solo si se pide; un producto suma sus medidas
// activas. Las imprime también el depósito.
func TestEtiquetas(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/"
	c, b := pedir(t, adm, "POST", u+"productos", e.ficha("Fenólico", map[string]string{"codigoBarras": "4006381333931"},
		map[string]string{"sku": "FEN12", "label": "12 mm"}))
	if c != 201 {
		t.Fatalf("alta: %d %s", c, b)
	}
	var creado struct{ ID string }
	_ = json.Unmarshal([]byte(b), &creado)
	_, b = pedir(t, adm, "GET", u+"productos/"+creado.ID, nil)
	var f Ficha
	_ = json.Unmarshal([]byte(b), &f)
	fen18, fen12 := f.Variantes[0].ID, f.Variantes[1].ID

	leer := func(q string) (int, []Etiqueta) {
		t.Helper()
		c, b := pedir(t, dep, "GET", u+"etiquetas"+q, nil)
		var out []Etiqueta
		_ = json.Unmarshal([]byte(b), &out)
		return c, out
	}
	c, et := leer("?medidas=" + fen12 + "," + fen18)
	if c != 200 || len(et) != 2 || et[0].VariantID != fen12 || et[1].VariantID != fen18 {
		t.Fatalf("orden pedido: %d %+v", c, et)
	}
	if et[1].Codigo != "4006381333931" || et[1].Barras == nil || et[1].Barras.Tipo != "ean13" || len(et[1].Barras.Modulos) != 95 {
		t.Errorf("EAN: %+v", et[1])
	}
	if et[0].Codigo != "FEN12" || et[0].Barras == nil || et[0].Barras.Tipo != "code128" || et[0].Precio != nil {
		t.Errorf("Code 128 sin precio: %+v", et[0])
	}
	_, et = leer("?precio=true&productos=" + creado.ID)
	if len(et) != 2 || et[0].Precio == nil || *et[0].Precio != "84500.00" {
		t.Errorf("por producto con precio: %+v", et)
	}
	// Ids que no son uuid se ignoran; ninguno, lista vacía.
	if c, et := leer("?medidas=x,y"); c != 200 || len(et) != 0 {
		t.Errorf("ids basura: %d %+v", c, et)
	}
}
