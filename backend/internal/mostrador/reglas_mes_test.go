package mostrador

import (
	"context"
	"testing"

	"mjbj/internal/cortes"
	"mjbj/internal/reglas"
	"mjbj/internal/sqlc"
)

// La regla corte_chico_material (H019). Tres piezas chicas no pasan la mitad
// de la placa: con «sin_cargo» (el de arranque) se cobran las pasadas y no
// la placa; con «cobrar» se cobra la placa, que descuenta stock, y las
// pasadas no (la placa vendida entera no cobra su corte).
func TestElCorteChicoYSuMaterial(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	if _, err := e.pool.Exec(ctx, `insert into cutting_rates (material, precio_por_pasada, precio_por_metro_canto, activo)
		values ('Placas', 2500, 900, true)`); err != nil {
		t.Fatal(err)
	}
	sierra := 4.0
	cobro := cortes.ACobrar(cortes.DatosDelPlano{PlacaLargo: 2440, PlacaAncho: 1220, AnchoSierra: &sierra,
		Piezas: []cortes.PiezaAcortar{{LargoMm: 600, AnchoMm: 300, Cantidad: 3}}})
	if cobro.Placas != 0 || cobro.Parciales != 1 || cobro.Pasadas == 0 {
		t.Fatalf("el despiece no es chico: %+v", cobro)
	}
	pieza := map[string]any{"largoMm": 600, "anchoMm": 300, "cantidad": 3, "respetaVeta": 0, "cantoLargo": 0, "cantoAncho": 0, "etiqueta": nil, "aclaracion": nil}
	corte := map[string]any{
		"variantId": e.placa, "materialDescripcion": "Fenólico 18 mm", "placaLargoMm": 2440, "placaAnchoMm": 1220,
		"mitad": nil, "placas": 1, "pasadas": cobro.Pasadas, "acomodoManual": nil, "cantoDescripcion": nil, "piezas": []any{pieza},
	}
	pasadas := map[string]any{"variantId": nil, "descripcion": "Corte a medida · 3 piezas", "unidad": "pasada", "cantidad": cobro.Pasadas, "precioUnitario": 2500}
	vender := func(lineas ...map[string]any) (int, map[string]any, string) {
		v := e.venta("transferencia", lineas...)
		v["corte"] = corte
		return pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	}
	noCierra := "El corte de Fenólico 18 mm no cierra con su plano. Tocá «Corregir» en el corte y guardalo."

	// Sin cargo: la placa no se cobra.
	if _, m, b := vender(e.lineaPlaca(1), pasadas); m["error"] != noCierra {
		t.Fatalf("sin cargo, con la placa: %s", b)
	}
	if st, m, b := vender(pasadas); st != 200 || m["ok"] != true {
		t.Fatalf("sin cargo: %d %s", st, b)
	}

	// Cobrar: la placa sí, las pasadas no.
	if err := reglas.Fijar(ctx, e.pool, reglas.CorteChicoMaterial, "cobrar"); err != nil {
		t.Fatal(err)
	}
	if _, m, b := vender(pasadas); m["error"] == nil {
		t.Fatalf("cobrar, sin la placa: %s", b)
	}
	antes := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central)
	st, m, b := vender(e.lineaPlaca(1))
	if st != 200 || m["ok"] != true {
		t.Fatalf("cobrar: %d %s", st, b)
	}
	if s := e.txt(t, `select string_agg(unidad || ' ' || cantidad::text, ', ' order by orden) from order_items where order_id = $1`, m["orderId"]); s != "placa 1.00" {
		t.Errorf("renglones: %s", s)
	}
	if d := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); d != antes-1 {
		t.Errorf("stock: antes %v, después %v", antes, d)
	}
}
