package compras

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// Las pruebas de la tanda del mes simulado 23 (compras y pagos).

func (e *entorno) vistaPrevia(t *testing.T, c *http.Client, archivo string, perfil map[string]string) VistaPreviaProveedor {
	t.Helper()
	cuerpo, tipo := multipartDe(t, archivo, perfil)
	req, _ := http.NewRequest("POST", e.u+"compras/lista-proveedor/vista-previa", cuerpo)
	req.Header.Set("Content-Type", tipo)
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var v VistaPreviaProveedor
	_ = json.NewDecoder(resp.Body).Decode(&v)
	return v
}

// M2S1-001, M2S1-003, M2S2-026, M2S2-042, M3S2-029: sin margen escrito, la
// vista previa mantiene el margen de cada variante (el costo sube 5 %, el
// precio sube 5 %), marca la baja, y aplicar deja el historial y el costo
// que después sugiere la orden.
func TestListaDelProveedorMantieneElMargenYDejaRastro(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	var lista string
	_ = e.pool.QueryRow(ctx, `insert into price_lists (slug, name, is_default) values ('general', 'General', true) returning id`).Scan(&lista)
	_, _ = e.pool.Exec(ctx, `insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 28500), ($1, $3, 1000)`, lista, e.placa, e.tornillo)
	_, _ = e.pool.Exec(ctx, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 10, 16800), ($2, 10, 500)`, e.placa, e.tornillo)

	perfil := map[string]string{"supplierId": e.proveedor, "columnaCodigo": "Código", "columnaPrecio": "Precio", "precioEsNeto": "on", "margenPorcentaje": ""}
	v := e.vistaPrevia(t, adm, "Código;Precio\nFEN18;17.640\nTOR;400\n", perfil)
	if len(v.Filas) != 2 {
		t.Fatalf("vista: %+v", v)
	}
	placa, tornillo := v.Filas[0], v.Filas[1]
	// 28.500 × 17.640 / 16.800 = 29.925: el mismo margen de hoy.
	if placa.CostoNeto != 17640 || placa.CostoAnterior == nil || *placa.CostoAnterior != 16800 || placa.PrecioSugerido != 29925 || placa.Cambio != CambioSube {
		t.Errorf("la placa: %+v", placa)
	}
	if tornillo.PrecioSugerido != 800 || tornillo.Cambio != CambioBaja {
		t.Errorf("el tornillo baja: %+v", tornillo)
	}

	// Con el margen escrito, se usa ese (como antes).
	perfil["margenPorcentaje"] = "40"
	if w := e.vistaPrevia(t, adm, "Código;Precio\nFEN18;17.640\n", perfil); w.Filas[0].PrecioSugerido != 29882.16 {
		t.Errorf("con margen 40: %+v", w.Filas[0])
	}

	perfil["margenPorcentaje"] = ""
	aplicar := map[string]string{}
	for k, x := range perfil {
		aplicar[k] = x
	}
	aplicar["filas"] = fmt.Sprintf(`[{"codigo":"FEN18","variantId":%q,"costo":21344.4,"costoNeto":17640,"precioSugerido":29925}]`, e.placa)
	c, b := pedir(t, adm, "POST", e.u+"compras/lista-proveedor/aplicar", aplicar)
	if c != 200 || !strings.Contains(b, "Listo: 1 precio actualizado.") {
		t.Fatalf("aplicar: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from price_history where variant_id = $1 and origen = 'importacion' and precio_anterior = 28500 and precio_nuevo = 29925
		and motivo = 'Lista de Maderas del Sur'`, e.placa); n != 1 {
		t.Errorf("el historial no tiene el cambio: %v", n)
	}
	if n := e.numero(t, `select costo_neto::float8 from supplier_variant_codes where supplier_id = $1 and variant_id = $2`, e.proveedor, e.placa); n != 17640 {
		t.Errorf("costo guardado: %v", n)
	}
	// La orden al mismo proveedor sugiere el costo de su lista; sin
	// proveedor, el promedio.
	if _, b := pedir(t, adm, "GET", e.u+"compras/mercaderia?texto=fen&proveedor="+e.proveedor, nil); !strings.Contains(b, `"costoActual":"17640.0000"`) {
		t.Errorf("con proveedor: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/mercaderia?ids="+e.placa+"&proveedor="+e.proveedor, nil); !strings.Contains(b, `"costoActual":"17640.0000"`) {
		t.Errorf("por ids con proveedor: %s", b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"compras/mercaderia?texto=fen", nil); !strings.Contains(b, `"costoActual":"16800.0000"`) {
		t.Errorf("sin proveedor: %s", b)
	}

	// Aplicar otra vez lo mismo no cambia nada ni suma historial; la vista
	// previa lo cuenta como sin cambios.
	if c, b := pedir(t, adm, "POST", e.u+"compras/lista-proveedor/aplicar", aplicar); c != 200 || !strings.Contains(b, "Listo: 0 precios actualizados y 1 costo guardado.") {
		t.Errorf("reaplicar: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from price_history where variant_id = $1`, e.placa); n != 1 {
		t.Errorf("historial duplicado: %v", n)
	}
	if w := e.vistaPrevia(t, adm, "Código;Precio\nFEN18;17.640\n", perfil); w.SinCambios != 1 || w.Filas[0].Cambio != CambioIgual {
		t.Errorf("sin cambios: %+v", w)
	}
}

// M3S2-057: buscar «laca» trae primero las lacas, no las placas.
func TestBuscarMercaderiaPrimeroLoQueEmpiezaIgual(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	var cat, laca string
	_ = e.pool.QueryRow(ctx, `select category_id from products where slug = 'fenolico'`).Scan(&cat)
	_, _ = e.pool.Exec(ctx, `update products set name = 'Fenólico placa' where slug = 'fenolico'`)
	_ = e.pool.QueryRow(ctx, `insert into products (slug, name, category_id, description, unit) values ('laca', 'Laca 4 L', $1, '', 'unidad') returning id`, cat).Scan(&laca)
	_, _ = e.pool.Exec(ctx, `insert into product_variants (product_id, sku, label) values ($1, 'LAC4', '4 L')`, laca)
	_, b := pedir(t, adm, "GET", e.u+"compras/mercaderia?texto=laca", nil)
	var xs []Mercaderia
	_ = json.Unmarshal([]byte(b), &xs)
	if len(xs) < 2 || xs[0].Producto != "Laca 4 L" {
		t.Errorf("orden: %s", b)
	}
}
