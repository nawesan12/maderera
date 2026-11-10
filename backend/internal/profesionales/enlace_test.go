package profesionales

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/sqlc"
)

// El link de acceso: la aprobación de quien pidió sin cuenta le crea una sin
// clave y le manda el link en la bienvenida; el panel puede generar otro, que
// sirve una sola vez; con una cuenta con clave, el panel no emite links.
func TestLinkDeAcceso(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	anon := &http.Client{}
	form := map[string]any{"nombre": "Ana Pérez", "documentoTipo": "dni", "documentoNumero": "30111222", "email": "Ana@Prueba.test",
		"telefono": "2235551234", "rubro": "carpintero"}
	if st, p := pedir(t, anon, "POST", e.srv.URL+"/api/v1/profesionales/solicitud", form); st != 200 {
		t.Fatalf("solicitud: %d %v", st, p)
	}
	sol := e.uno(t, `select id from professional_applications`)
	if st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/profesionales/aprobacion", map[string]any{"id": sol}); st != 200 {
		t.Fatalf("aprobar: %d %v", st, p)
	}
	usuario := e.uno(t, `select u.id from "user" u join professional_applications a on a.user_id = u.id`)
	if r := e.uno(t, `select role::text from profiles where user_id = $1`, usuario); r != "profesional" {
		t.Errorf("rol: %s", r)
	}
	if !strings.Contains(e.buzon.mensajes[len(e.buzon.mensajes)-1].HTML, "/entrar/") {
		t.Errorf("la bienvenida no trae el link de activación")
	}

	st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/profesionales/"+sol+"/enlace", nil)
	if st != 200 || !strings.HasPrefix(p["url"].(string), "https://mjbj.com.ar/entrar/") || p["telefono"] != "2235551234" {
		t.Fatalf("link: %d %v", st, p)
	}
	token := strings.TrimPrefix(p["url"].(string), "https://mjbj.com.ar/entrar/")
	if n := e.uno(t, `select count(*)::text from verification where identifier like '%' || $1 || '%'`, token); n != "0" {
		t.Error("el token quedó en la base en claro")
	}

	w := httptest.NewRecorder()
	ses, proposito, err := e.ses.UsarEnlace(ctx, w, token, "", "")
	if err != nil || ses.UserID != usuario || proposito != auth.EnlaceActivacion || len(w.Result().Cookies()) == 0 {
		t.Fatalf("usar el link: %v %v %s", err, ses, proposito)
	}
	if _, _, err := e.ses.UsarEnlace(ctx, httptest.NewRecorder(), token, "", ""); err != auth.ErrEnlaceInvalido {
		t.Errorf("segundo uso: %v", err)
	}

	// Vencido.
	viejo, _ := auth.NuevoEnlace(ctx, e.pool, usuario, auth.EnlaceIngreso, time.Minute, time.Now().Add(-time.Hour))
	if _, _, err := e.ses.UsarEnlace(ctx, httptest.NewRecorder(), viejo, "", ""); err != auth.ErrEnlaceVencido {
		t.Errorf("vencido: %v", err)
	}

	// Con clave, el panel no manda links.
	_, _, _ = e.web(t, "beto@prueba.test")
	form["documentoNumero"], form["email"], form["nombre"] = "30111333", "beto@prueba.test", "Beto"
	pedir(t, anon, "POST", e.srv.URL+"/api/v1/profesionales/solicitud", form)
	sol2 := e.uno(t, `select id from professional_applications where documento_numero = '30111333'`)
	pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/profesionales/aprobacion", map[string]any{"id": sol2})
	if st, p := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/profesionales/"+sol2+"/enlace", nil); st != 422 || !strings.Contains(primerError(p)+p["detail"].(string), "ya tiene contraseña") {
		t.Errorf("cuenta con clave: %d %v", st, p)
	}
}
