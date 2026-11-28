package profesionales

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"mjbj/internal/sqlc"
)

// Mes 23 (como M3S2-033): seis personas del mismo wifi se anotan a un evento
// sin que la sexta choque con «Probaste varias veces seguidas»; la misma
// persona insistiendo sí se frena.
func TestLasInscripcionesSeCuentanPorCorreo(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	anon := &http.Client{}
	inicia := time.Now().In(Zona).AddDate(0, 0, 1).Format("2006-01-02") + "T18:00"
	if st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/eventos", map[string]any{"titulo": "Charla de barnices", "inicia": inicia, "cupo": "20",
		"precio": "", "soloProfesionales": false, "lugar": "Casa Central"}); st != 200 {
		t.Fatalf("crear: %d %v", st, p)
	}
	id := e.uno(t, `select id from events where slug = 'charla-de-barnices'`)
	if st, p := pedir(t, ven, "PUT", e.srv.URL+"/api/v1/admin/eventos/estado", map[string]any{"id": id, "estado": "publicado"}); st != 200 {
		t.Fatalf("publicar: %d %v", st, p)
	}
	for i := range 7 {
		anotar := map[string]any{"eventId": id, "slug": "charla-de-barnices", "nombre": "Persona", "email": fmt.Sprintf("persona%d@prueba.test", i)}
		if st, p := pedir(t, anon, "POST", e.srv.URL+"/api/v1/eventos/inscripcion", anotar); st != 200 {
			t.Fatalf("la persona %d del mismo wifi: %d %v", i+1, st, p)
		}
	}
	anotar := map[string]any{"eventId": id, "slug": "charla-de-barnices", "nombre": "Persona", "email": "persona0@prueba.test"}
	frenada := false
	for range 6 {
		if st, _ := pedir(t, anon, "POST", e.srv.URL+"/api/v1/eventos/inscripcion", anotar); st == 429 {
			frenada = true
		}
	}
	if !frenada {
		t.Error("la misma persona insistiendo no se frena")
	}
}
