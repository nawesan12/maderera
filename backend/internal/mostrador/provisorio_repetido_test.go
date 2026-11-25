package mostrador

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"mjbj/internal/sqlc"
)

// Comité del 25/11: el contador de provisorios vive en el navegador de cada
// PC. Una PC nueva que vinculaba CAJA1 arrancaba en CAJA1-001 aunque esa
// caja ya hubiera numerado: el papel salía repetido y la venta no subía nunca
// (índice único, la cola reintentando). Vincular dice desde dónde seguir, y
// una venta con un número que ya existe entra igual, marcada.
func TestProvisorioRepetidoAlVincularEnOtraPC(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	ctx := context.Background()
	var caja string
	if err := e.pool.QueryRow(ctx, `insert into pos_devices (codigo, branch_id, secreto) values ('CAJA1', $1, 'secreto-1') returning id`, e.central).Scan(&caja); err != nil {
		t.Fatal(err)
	}
	cobrada := time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339)
	subir := func(numero string) map[string]any {
		t.Helper()
		v := e.venta("efectivo", e.lineaPlaca(1))
		v["numeroProvisorio"] = numero
		v["cobradaAt"] = cobrada
		st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/descarga", map[string]any{"cuerpo": map[string]any{"ventas": []any{v}}})
		if st != 200 {
			t.Fatalf("descarga %s: %d %s", numero, st, b)
		}
		return m["resultados"].([]any)[0].(map[string]any)
	}

	// La PC vieja subió hasta CAJA1-012; otra caja, CAJA10, no cuenta.
	for _, n := range []string{"CAJA1-007", "CAJA1-012", "CAJA10-050"} {
		if r := subir(n); r["estado"] != "sincronizada" {
			t.Fatalf("%s: %v", n, r)
		}
	}

	// Una PC nueva vincula CAJA1: sigue en el 13.
	_, _, b := crudo(t, ven, "POST", e.u+"/api/mostrador/caja/vincular", `{"cajaId":"`+caja+`"}`)
	var v struct {
		Caja struct {
			ProximoNumero float64 `json:"proximoNumero"`
		} `json:"caja"`
	}
	if err := json.Unmarshal([]byte(b), &v); err != nil || v.Caja.ProximoNumero != 13 {
		t.Fatalf("vincular: %s", b)
	}

	// Una venta que igual trae un número que ya existe (una PC sin
	// actualizar) entra, con el número desambiguado y marcada.
	r := subir("CAJA1-007")
	if r["estado"] != "sincronizada" {
		t.Fatalf("la repetida no subió: %v", r)
	}
	fila := e.txt(t, `select numero_provisorio || ' ' || bajo_lista_sin_autorizar::text || ' ' || coalesce(notas, '') from orders where id = $1`, r["orderId"])
	if !strings.HasPrefix(fila, "CAJA1-007-R") || !strings.Contains(fila, " true ") || !strings.Contains(fila, "el papel del cliente dice CAJA1-007") {
		t.Fatalf("la repetida: %q", fila)
	}
	if n := e.num(t, `select count(*)::float8 from orders where numero_provisorio like 'CAJA1-007%'`); n != 2 {
		t.Fatalf("tiene que haber dos: %v", n)
	}
	// El sufijo no mueve la numeración (la PC de recién quedó sin latido).
	if _, err := e.pool.Exec(ctx, `update pos_devices set ultima_vez_at = null where id = $1`, caja); err != nil {
		t.Fatal(err)
	}
	_, _, b = crudo(t, ven, "POST", e.u+"/api/mostrador/caja/vincular", `{"cajaId":"`+caja+`"}`)
	if !strings.Contains(b, `"proximoNumero":13`) {
		t.Fatalf("revincular: %s", b)
	}
}
