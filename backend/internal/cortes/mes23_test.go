package cortes

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// Las pruebas del mes simulado 2–3 (rama mes23-cortes-taller).

// M3S1-015 y M2S1-014: el agente pide los de su taller, y el que está en la
// máquina viene aparte para que su archivo no salga de la carpeta.
func TestPendientesDelTaller(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	var aserradero string
	if err := e.pool.QueryRow(context.Background(), `insert into branches (slug, name, sort_order) values ('aserradero', 'Aserradero', 2) returning id::text`).Scan(&aserradero); err != nil {
		t.Fatal(err)
	}
	central := alta(t, e, ven, melamina(e, "branchId", e.central))
	enAserradero := alta(t, e, ven, melamina(e, "branchId", aserradero))
	u := e.srv.URL + "/api/cortes/pendientes"
	ver := func(q string) (int, string) {
		return pedir(t, http.DefaultClient, "GET", u+q, nil, "Authorization", "Bearer "+tokenAgente)
	}
	if code, b := ver("?sucursal=aserradero"); code != 200 || !strings.Contains(b, enAserradero) || strings.Contains(b, central) {
		t.Errorf("aserradero: %d %s", code, b)
	}
	if code, b := ver("?sucursal=" + e.central); code != 200 || strings.Contains(b, enAserradero) || !strings.Contains(b, central) {
		t.Errorf("casa central: %d %s", code, b)
	}
	if code, _ := ver("?sucursal=Otra"); code != 400 {
		t.Errorf("sucursal que no existe: %d", code)
	}
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes/"+enAserradero+"/avanzar?desde=en-cola", nil); code != 200 {
		t.Fatalf("empezar: %d %s", code, b)
	}
	code, b := ver("?sucursal=Aserradero")
	if code != 200 || !strings.Contains(b, `"enLaMaquina":[{"id":"`+enAserradero) || strings.Contains(b, `"cortes":[{`) {
		t.Errorf("en la máquina: %d %s", code, b)
	}
}
