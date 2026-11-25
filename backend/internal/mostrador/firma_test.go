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
	ahora := time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC)
	reloj := ahora
	s := (&Servicio{ahora: func() time.Time { return reloj }}).ConClaveDeCola("clave")
	f, vence := s.FirmaDeCola("u1", ahora)
	en := func(d time.Duration) *time.Time { x := ahora.Add(d); return &x }
	if !s.FirmaValida(f, "u1", en(time.Hour)) || !s.FirmaValida(f, "u1", nil) {
		t.Fatal("vigente")
	}
	if s.FirmaValida(f, "u1", en(-48*time.Hour)) || s.FirmaValida(f, "u2", en(0)) {
		t.Fatal("anterior o de otro")
	}
	// Se drena tarde, tras el vencimiento: la venta cobrada justo al vencer
	// todavía vale; la cobrada después, no.
	reloj = vence.Add(24 * time.Hour)
	if !s.FirmaValida(f, "u1", &vence) {
		t.Fatal("cobrada al vencer, drenada al día siguiente")
	}
	if s.FirmaValida(f, "u1", en(8*24*time.Hour)) {
		t.Fatal("cobrada después de vencida")
	}
	if sin := (&Servicio{}).ConClaveDeCola(""); sin.FirmaValida(f, "u1", en(0)) {
		t.Fatal("sin clave no hay firma válida")
	}
}

// Una firma vencida hace meses no sirve aunque el cliente mande un
// `cobradaAt` de cuando estaba vigente: la hora se acota a la última semana.
func TestFirmaViejaConCobradaVieja(t *testing.T) {
	entregada := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	reloj := entregada
	s := (&Servicio{ahora: func() time.Time { return reloj }}).ConClaveDeCola("clave")
	f, _ := s.FirmaDeCola("u1", entregada)
	cobrada := entregada.Add(time.Hour)
	if !s.FirmaValida(f, "u1", &cobrada) {
		t.Fatal("en su momento era válida")
	}
	reloj = time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC)
	if s.FirmaValida(f, "u1", &cobrada) {
		t.Fatal("una firma de junio firmó una venta subida en noviembre")
	}
	// Ni siquiera justo después de la semana de gracia.
	reloj = entregada.Add(2*vigenciaDeFirma + time.Minute)
	if s.FirmaValida(f, "u1", &cobrada) {
		t.Fatal("firma vencida hace más de una vigencia")
	}
}
