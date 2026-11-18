package mostrador

import (
	"strings"
	"testing"
	"time"

	"mjbj/internal/sqlc"
)

// Quien drena la cola ya no puede firmar a nombre de otro vendedor: la venta
// queda a nombre de quien dice solo con la firma que el latido le dio a esa
// sesión. Sin firma (las ventas que ya estaban en la cola) sube igual, a
// nombre de quien la sube.
func TestFirmaDeLaColaSinConexion(t *testing.T) {
	e := armar(t)
	ana := e.staff(t, "ana@prueba.test", sqlc.StaffRoleVendedor)
	beto := e.staff(t, "beto@prueba.test", sqlc.StaffRoleVendedor)
	e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	idDe := func(correo string) string {
		return e.txt(t, `select id from "user" where email = $1`, correo)
	}
	anaID, betoID, adminID := idDe("ana@prueba.test"), idDe("beto@prueba.test"), idDe("admin@prueba.test")

	// El latido de Ana le da su firma.
	_, l, b := pedir(t, ana, "POST", e.u+"/api/mostrador/latido", map[string]any{})
	fc, _ := l["firmaCola"].(map[string]any)
	firmaAna, _ := fc["firma"].(string)
	if fc == nil || fc["usuarioId"] != anaID || !strings.HasPrefix(firmaAna, "v1.") {
		t.Fatalf("latido sin firma: %s", b)
	}

	cobrada := time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339)
	n := 0
	subir := func(usuario string, firma any) string {
		t.Helper()
		n++
		v := e.venta("efectivo", e.lineaPlaca(1))
		v["numeroProvisorio"] = "CAJA1-" + strings.Repeat("0", 2) + string(rune('0'+n))
		v["cobradaAt"] = cobrada
		v["usuarioId"] = usuario
		if firma != nil {
			v["firmaUsuario"] = firma
		}
		st, m, b := pedir(t, beto, "POST", e.u+"/api/v1/mostrador/descarga", map[string]any{"cuerpo": map[string]any{"ventas": []any{v}}})
		r := m["resultados"].([]any)[0].(map[string]any)
		if st != 200 || r["estado"] != "sincronizada" {
			t.Fatalf("descarga: %d %s", st, b)
		}
		return e.txt(t, `select created_by_user_id from orders where id = $1`, r["orderId"])
	}

	// Beto sube una de Ana sin firma (una de antes): queda a nombre de Beto.
	if u := subir(anaID, nil); u != betoID {
		t.Fatalf("sin firma quedó a nombre de %s", u)
	}
	// Con la firma de Ana: es de Ana.
	if u := subir(anaID, firmaAna); u != anaID {
		t.Fatalf("con la firma de Ana quedó a nombre de %s", u)
	}
	// La firma de Ana no sirve para decir que la hizo el admin.
	if u := subir(adminID, firmaAna); u != betoID {
		t.Fatalf("la firma de Ana firmó por el admin: %s", u)
	}
	// Una firma tocada tampoco.
	if u := subir(anaID, firmaAna[:len(firmaAna)-2]+"xx"); u != betoID {
		t.Fatalf("firma tocada: %s", u)
	}
}

// La firma vence: una venta cobrada después del vencimiento, o mucho antes de
// que se entregara, no la puede usar.
func TestVigenciaDeLaFirma(t *testing.T) {
	s := (&Servicio{ahora: time.Now}).ConClaveDeCola("clave")
	ahora := time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC)
	f, vence := s.FirmaDeCola("u1", ahora)
	en := func(d time.Duration) *time.Time { x := ahora.Add(d); return &x }
	if !s.FirmaValida(f, "u1", en(time.Hour)) || !s.FirmaValida(f, "u1", &vence) {
		t.Fatal("vigente")
	}
	if s.FirmaValida(f, "u1", en(8*24*time.Hour)) || s.FirmaValida(f, "u1", en(-48*time.Hour)) || s.FirmaValida(f, "u2", en(0)) {
		t.Fatal("vencida, anterior o de otro")
	}
	if sin := (&Servicio{}).ConClaveDeCola(""); sin.FirmaValida(f, "u1", en(0)) {
		t.Fatal("sin clave no hay firma válida")
	}
}
