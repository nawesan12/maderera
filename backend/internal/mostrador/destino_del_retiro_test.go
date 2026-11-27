package mostrador

import (
	"fmt"
	"testing"
	"time"

	"mjbj/internal/sqlc"
)

// El retiro guarda a dónde va (H333): al banco y a la caja fuerte sin
// escribir el motivo, «otro» con el motivo; el ingreso, de dónde viene. El retiro sin conexión también lo guarda; el de un cliente viejo
// que no lo manda queda sin destino.
func TestElRetiroGuardaADondeVa(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 5000)
	_, m, _ := pedir(t, ven, "GET", e.u+"/api/v1/mostrador/pantalla?sucursal="+e.central, nil)
	sesion := m["turno"].(map[string]any)["id"].(string)
	mov := func(cuerpo map[string]any) (int, map[string]any) {
		cuerpo["sessionId"] = sesion
		st, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/movimiento", cuerpo)
		return st, m
	}
	if st, m := mov(map[string]any{"tipo": "retiro", "monto": 1000, "motivo": "", "destino": "banco"}); st != 200 {
		t.Fatalf("al banco: %d %v", st, m)
	}
	if st, m := mov(map[string]any{"tipo": "retiro", "monto": 500, "motivo": "", "destino": "caja_fuerte"}); st != 200 {
		t.Fatalf("a la caja fuerte: %d %v", st, m)
	}
	if st, m := mov(map[string]any{"tipo": "retiro", "monto": 100, "motivo": "", "destino": "otro"}); st != 422 {
		t.Fatalf("otro sin motivo: %d %v", st, m)
	}
	if st, m := mov(map[string]any{"tipo": "retiro", "monto": 100, "motivo": "Viáticos del flete", "destino": "otro"}); st != 200 {
		t.Fatalf("otro: %d %v", st, m)
	}
	if st, m := mov(map[string]any{"tipo": "ingreso", "monto": 50, "motivo": "Cambio", "destino": "banco"}); st != 200 {
		t.Fatalf("ingreso: %d %v", st, m)
	}
	if st, m := mov(map[string]any{"tipo": "retiro", "monto": 10, "motivo": "x", "destino": "bolsillo"}); st != 400 && st != 422 {
		t.Fatalf("destino inventado: %d %v", st, m)
	}
	got := e.txt(t, `select string_agg(motivo || ':' || coalesce(destino, '-'), ' ' order by created_at, monto) from cash_movements
		where session_id = $1 and tipo in ('retiro', 'ingreso')`, sesion)
	// Desde la 00350 el ingreso también dice de dónde viene (M3S3-014).
	if got != "Depósito en el banco:banco A la caja fuerte:caja_fuerte Viáticos del flete:otro Cambio:banco" {
		t.Errorf("movimientos: %s", got)
	}
	// La pantalla dice el destino de cada retiro.
	_, m, _ = pedir(t, ven, "GET", e.u+"/api/v1/mostrador/pantalla?sucursal="+e.central, nil)
	destinos := []string{}
	for _, x := range m["movimientos"].([]any) {
		if d, ok := x.(map[string]any)["destino"].(string); ok {
			destinos = append(destinos, d)
		}
	}
	if fmt.Sprint(destinos) != "[banco otro caja_fuerte banco]" {
		t.Errorf("pantalla: %v", destinos)
	}

	// Sin conexión: con destino y sin él (el cliente de antes).
	for _, c := range []map[string]any{
		{"clave": "0b6f3f0e-4d0f-4a43-9a3f-2f1f3a0c0001", "destino": "caja_fuerte"},
		{"clave": "0b6f3f0e-4d0f-4a43-9a3f-2f1f3a0c0002"},
	} {
		c["branchId"], c["tipo"], c["monto"], c["motivo"] = e.central, "retiro", 20, "Diferido"
		c["hechoAt"] = time.Now().UTC().Format(time.RFC3339Nano)
		if st, m, _ := pedir(t, ven, "POST", e.u+"/api/mostrador/caja/movimientos", c); st != 200 || m["ok"] != true {
			t.Fatalf("diferido: %d %v", st, m)
		}
	}
	got = e.txt(t, `select string_agg(coalesce(destino, '-'), ' ' order by clave) from cash_movements where clave is not null`)
	if got != "caja_fuerte -" {
		t.Errorf("diferidos: %s", got)
	}
}
