package profesionales

import (
	"testing"

	"mjbj/internal/sqlc"
)

// M2S1-020, M3S2-092 y M2S1-137: la ficha que ya existía (consumidor final,
// sin CUIT) toma el CUIT de la solicitud; la condición frente al IVA y el
// plazo los elige quien aprueba.
func TestAprobarConCuitCondicionYPlazo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	cl, userID, ficha := e.web(t, "sim.profesional@prueba.test")
	if st, p := pedir(t, cl, "POST", e.srv.URL+"/api/v1/profesionales/solicitud", map[string]any{"nombre": "Martina", "documentoTipo": "cuit",
		"documentoNumero": "27-38555030-3", "email": "sim.profesional@prueba.test", "telefono": "2235550101", "rubro": "arquitecto"}); st != 200 {
		t.Fatalf("solicitud: %d %v", st, p)
	}
	sol := e.uno(t, `select id from professional_applications where user_id = $1`, userID)
	st, p := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/profesionales/aprobacion", map[string]any{"id": sol,
		"limiteCredito": "300000", "condicionIva": "monotributista", "diasCredito": "15"})
	if st != 200 {
		t.Fatalf("aprobar: %d %v", st, p)
	}
	if got := e.uno(t, `select coalesce(cuit, '-') || '/' || condicion_iva::text || '/' || dias_credito::text from customers where id = $1`, ficha); got != "27385550303/monotributista/15" {
		t.Errorf("la ficha quedó %s", got)
	}
}
