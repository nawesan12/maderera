package mostrador

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Desvincular una terminal (comité final, carril F): solo admin, cambia el
// secreto, el latido de la PC vieja ya no la reconoce y deja la bitácora.
func TestDesvincularTerminal(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ctx := context.Background()
	var caja string
	if err := e.pool.QueryRow(ctx, `insert into pos_devices (codigo, branch_id, secreto, ultima_vez_at) values ('CAJA1', $1, 'secreto-1', now()) returning id`, e.central).Scan(&caja); err != nil {
		t.Fatal(err)
	}
	ruta := e.u + "/api/v1/mostrador/caja/desvincular"

	// El vendedor vincula, pero no desvincula.
	if st, m, b := pedir(t, ven, "POST", ruta, map[string]any{"cajaId": caja}); st != 403 {
		t.Fatalf("vendedor: %d %v %s", st, m, b)
	}
	if s := e.txt(t, `select secreto from pos_devices where id = $1`, caja); s != "secreto-1" {
		t.Fatalf("el vendedor cambió el secreto: %q", s)
	}

	// El latido con el secreto vigente la reconoce.
	latido := `{"branchId":"` + e.central + `","caja":{"id":"` + caja + `","secreto":"secreto-1"},"pendientes":0}`
	_, _, b := crudo(t, ven, "POST", e.u+"/api/mostrador/latido", latido)
	var l map[string]any
	_ = json.Unmarshal([]byte(b), &l)
	if l["cajaVigente"] != true {
		t.Fatalf("latido vigente: %s", b)
	}

	// Con ventas sin subir no se suelta.
	if _, err := e.pool.Exec(ctx, `update pos_devices set pendientes = 2 where id = $1`, caja); err != nil {
		t.Fatal(err)
	}
	st, m, _ := pedir(t, adm, "POST", ruta, map[string]any{"cajaId": caja})
	if st != 422 || !strings.Contains(fmt.Sprint(m["errores"]), "CAJA1 tiene 2 ventas cobradas que todavía no subieron.") {
		t.Fatalf("con pendientes: %d %v", st, m)
	}
	if _, err := e.pool.Exec(ctx, `update pos_devices set pendientes = 0 where id = $1`, caja); err != nil {
		t.Fatal(err)
	}

	// Una que no existe.
	st, m, _ = pedir(t, adm, "POST", ruta, map[string]any{"cajaId": "00000000-0000-0000-0000-000000000000"})
	if st != 422 || !strings.Contains(fmt.Sprint(m["errores"]), "Esa terminal no existe.") {
		t.Fatalf("no existe: %d %v", st, m)
	}

	// El admin la suelta.
	st, m, _ = pedir(t, adm, "POST", ruta, map[string]any{"cajaId": caja})
	if st != 200 || m["ok"] != "Esta PC ya no es CAJA1." {
		t.Fatalf("desvincular: %d %v", st, m)
	}
	if s := e.txt(t, `select secreto from pos_devices where id = $1`, caja); s == "secreto-1" || len(s) != 32 {
		t.Fatalf("secreto nuevo: %q", s)
	}
	if n := e.num(t, `select count(*)::float8 from pos_devices where id = $1 and ultima_vez_at is null and activo`, caja); n != 1 {
		t.Fatal("la caja tiene que quedar activa y sin latido")
	}
	if n := e.num(t, `select count(*)::float8 from audit_log where entidad = 'caja' and entidad_id = $1 and descripcion = 'Desvinculó la terminal CAJA1'`, caja); n != 1 {
		t.Fatalf("bitácora: %v", n)
	}

	// La PC vieja ya no se reconoce: vuelve a pedir que se la vincule.
	_, _, b = crudo(t, ven, "POST", e.u+"/api/mostrador/latido", latido)
	l = nil
	_ = json.Unmarshal([]byte(b), &l)
	if l["cajaVigente"] != false {
		t.Fatalf("latido de la PC desvinculada: %s", b)
	}
	// Sin caja en el latido, nada que decir.
	_, _, b = crudo(t, ven, "POST", e.u+"/api/mostrador/latido", `{"branchId":"`+e.central+`"}`)
	l = nil
	_ = json.Unmarshal([]byte(b), &l)
	if _, hay := l["cajaVigente"]; hay {
		t.Fatalf("latido sin caja: %s", b)
	}
	// Y sigue en la lista para vincular otra vez, con el secreto nuevo.
	_, _, b = crudo(t, ven, "POST", e.u+"/api/mostrador/caja/vincular", `{"cajaId":"`+caja+`"}`)
	if !strings.Contains(b, `"codigo":"CAJA1"`) || strings.Contains(b, "secreto-1") {
		t.Fatalf("revincular: %s", b)
	}
}
