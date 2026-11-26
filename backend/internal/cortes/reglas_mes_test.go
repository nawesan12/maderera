package cortes

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"mjbj/internal/reglas"
)

// La regla corte_chico_material (H019) en el plano del mostrador y la ficha
// del corte suelto: con «sin_cargo» la placa chica no se cobra y el recorte
// queda en la maderera; con «cobrar» se cobra como material, sin pasadas, y
// el retal es del cliente.
func TestElCorteChicoCobraSuMaterialConLaRegla(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	plano := func() (placas, pasadas, parciales float64) {
		code, b := pedir(t, http.DefaultClient, "POST", e.srv.URL+"/api/v1/cortes/plano", map[string]any{
			"piezas":     []any{map[string]any{"largoMm": 600, "anchoMm": 300, "cantidad": 3, "respetaVeta": 0}},
			"placaLargo": 2440, "placaAncho": 1220,
		})
		var r map[string]any
		if code != 200 || json.Unmarshal([]byte(b), &r) != nil {
			t.Fatalf("plano: %d %s", code, b)
		}
		return r["placasACobrar"].(float64), r["pasadasACobrar"].(float64), r["placasParciales"].(float64)
	}
	suelto := alta(t, e, ven, melamina(e, "piezas", []any{pieza(600, 300, 3)}))

	if pl, pa, pc := plano(); pl != 0 || pa == 0 || pc != 1 {
		t.Errorf("sin cargo, el plano: %v %v %v", pl, pa, pc)
	}
	f := leerFicha(t, e, ven, suelto)
	if c := f["cuenta"].(map[string]any); c["subtotalPlacas"].(float64) != 0 || f["retalesDelCliente"] != false {
		t.Errorf("sin cargo, la ficha: %v %v", c, f["retalesDelCliente"])
	}

	if err := reglas.Fijar(ctx, e.pool, reglas.CorteChicoMaterial, "cobrar"); err != nil {
		t.Fatal(err)
	}
	if pl, pa, pc := plano(); pl != 1 || pa != 0 || pc != 0 {
		t.Errorf("cobrar, el plano: %v %v %v", pl, pa, pc)
	}
	f = leerFicha(t, e, ven, suelto)
	c := f["cuenta"].(map[string]any)
	if c["subtotalPlacas"].(float64) <= 0 || f["pasadasACobrar"].(float64) != 0 || f["retalesDelCliente"] != true {
		t.Errorf("cobrar, la ficha: %v %v %v", c, f["pasadasACobrar"], f["retalesDelCliente"])
	}
	// El corte de un pedido no cambia: sus placas las vende el pedido.
	pedido := e.pedido(t, "PED-2001", map[string]any{"variante": e.melamina, "descripcion": "Melamina Blanca", "unidad": "placa", "cantidad": 1, "precio": 84500})
	id := alta(t, e, ven, melamina(e, "orderId", pedido, "piezas", []any{pieza(600, 300, 3)}))
	if f := leerFicha(t, e, ven, id); f["modo"] != "pedido" || f["cuenta"].(map[string]any)["subtotalPlacas"].(float64) != 0 {
		t.Errorf("el corte del pedido cotiza la placa: %v", f["cuenta"])
	}
}
