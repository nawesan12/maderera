package compras

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"mjbj/internal/reglas"
)

// La lista del proveedor dejaba el precio con centavos (mes 23: MDF
// $ 81.876,92). Con «redondeo_lista_proveedor» en centavos sigue igual; al
// peso, a la decena o a la centena sube, en la vista previa y al aplicar.
func TestRedondeoDeLaListaDelProveedor(t *testing.T) {
	for _, c := range []struct {
		modo   string
		quiero float64
	}{{"centavos", 81876.92}, {"peso", 81877}, {"decena", 81880}, {"centena", 81900}, {"otra", 81876.92}} {
		if got := RedondearSugerido(81876.921, c.modo); got != c.quiero {
			t.Errorf("%s: %v", c.modo, got)
		}
	}
	if got := RedondearSugerido(81877, "peso"); got != 81877 {
		t.Errorf("el que ya es redondo no sube: %v", got)
	}

	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	var lista string
	_ = e.pool.QueryRow(ctx, `insert into price_lists (slug, name, is_default) values ('general', 'General', true) returning id`).Scan(&lista)
	_, _ = e.pool.Exec(ctx, `insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 28500)`, lista, e.placa)
	_, _ = e.pool.Exec(ctx, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 10, 16800)`, e.placa)
	perfil := map[string]string{"supplierId": e.proveedor, "columnaCodigo": "Código", "columnaPrecio": "Precio", "precioEsNeto": "on", "margenPorcentaje": "40"}
	if v := e.vistaPrevia(t, adm, "Código;Precio\nFEN18;17.640\n", perfil); v.Filas[0].PrecioSugerido != 29882.16 {
		t.Errorf("con centavos, como siempre: %+v", v.Filas[0])
	}
	if err := reglas.Fijar(ctx, e.pool, reglas.RedondeoListaProveedor, "decena"); err != nil {
		t.Fatal(err)
	}
	if v := e.vistaPrevia(t, adm, "Código;Precio\nFEN18;17.640\n", perfil); v.Filas[0].PrecioSugerido != 29890 {
		t.Errorf("a la decena: %+v", v.Filas[0])
	}
	// Aunque el navegador mande el de centavos, se guarda redondeado.
	aplicar := map[string]string{"filas": fmt.Sprintf(`[{"codigo":"FEN18","variantId":%q,"costo":21344.4,"costoNeto":17640,"precioSugerido":29882.16}]`, e.placa)}
	for k, x := range perfil {
		aplicar[k] = x
	}
	if c, b := pedir(t, adm, "POST", e.u+"compras/lista-proveedor/aplicar", aplicar); c != 200 || !strings.Contains(b, "1 precio actualizado") {
		t.Fatalf("aplicar: %d %s", c, b)
	}
	if n := e.numero(t, `select price::float8 from price_list_items where variant_id = $1`, e.placa); n != 29890 {
		t.Errorf("el precio guardado: %v", n)
	}
}
