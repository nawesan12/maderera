package bitacora

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mjbj/internal/api/bitacoraapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

func TestDesdeHaceDiasEnHoraArgentina(t *testing.T) {
	// 22:30 del 10/11 en Argentina es 01:30 del 11 en UTC: «hoy» es el 10.
	ahora := time.Date(2026, 11, 11, 1, 30, 0, 0, time.UTC)
	if d := DesdeHaceDias(0, ahora); !d.Equal(time.Date(2026, 11, 10, 3, 0, 0, 0, time.UTC)) {
		t.Errorf("hoy empieza %v", d.UTC())
	}
	if d := DesdeHaceDias(7, ahora); !d.Equal(time.Date(2026, 11, 3, 3, 0, 0, 0, time.UTC)) {
		t.Errorf("hace 7 días empieza %v", d.UTC())
	}
}

func TestLeerLaBitacora(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	silencio := slog.New(slog.NewTextHandler(io.Discard, nil))
	ses := auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-la-bitacora-de-32-caract", URL: "http://localhost"}, pool)
	m := http.NewServeMux()
	bitacoraapi.HandlerWithOptions(
		bitacoraapi.NewStrictHandlerWithOptions(NuevaAPI(pool), []bitacoraapi.StrictMiddlewareFunc{plataforma.ConPedido[bitacoraapi.StrictHandlerFunc]},
			bitacoraapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		bitacoraapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := bitacoraapi.GetSwagger()
	validar, _ := plataforma.ValidarContra(spec)
	spec2, _ := bitacoraapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec2, ses.Middleware(validar(m))))
	defer srv.Close()

	id, err := ses.AltaDeStaff(ctx, "ana@prueba.test", "una clave larga", "Ana", sqlc.StaffRoleVendedor)
	if err != nil {
		t.Fatal(err)
	}
	persona := &auth.Sesion{UserID: id, Nombre: "Ana", Correo: "ana@prueba.test"}
	for i, d := range []string{"Creó el banner de invierno", "Editó el precio del fenólico", "Anuló el recibo REC-0001"} {
		Anotar(ctx, sqlc.New(pool), silencio, persona, []sqlc.AccionAuditoria{sqlc.AccionAuditoriaCrear, sqlc.AccionAuditoriaEditar, sqlc.AccionAuditoriaAnular}[i],
			[]string{"banner", "precio", "recibo"}[i], "", d, nil)
	}
	w := httptest.NewRecorder()
	if _, err := ses.Entrar(ctx, w, "ana@prueba.test", "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", srv.URL, nil)
	jar.SetCookies(u.URL, w.Result().Cookies())
	c := &http.Client{Jar: jar}

	leer := func(ruta string) (int, string) {
		r, err := c.Get(srv.URL + ruta)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		return r.StatusCode, string(b)
	}
	_, b := leer("/api/v1/admin/bitacora?buscar=precio&dias=7")
	var l struct {
		Filas []Linea
		Total int
	}
	_ = json.Unmarshal([]byte(b), &l)
	if l.Total != 1 || len(l.Filas) != 1 || l.Filas[0].Entidad != "precio" || l.Filas[0].UsuarioNombre != "Ana" {
		t.Errorf("buscar: %s", b)
	}
	if _, b := leer("/api/v1/admin/bitacora?limite=2"); !strings.Contains(b, `"total":3`) || strings.Count(b, `"id"`) != 2 {
		t.Errorf("limite: %s", b)
	}
	if _, b := leer("/api/v1/admin/bitacora?accion=anular"); !strings.Contains(b, "REC-0001") || !strings.Contains(b, `"total":1`) {
		t.Errorf("acción: %s", b)
	}
	if _, b := leer("/api/v1/admin/bitacora/opciones"); !strings.Contains(b, `"entidades":["banner","precio","recibo"]`) || !strings.Contains(b, `"usuarioNombre":"Ana"`) {
		t.Errorf("opciones: %s", b)
	}
	if r, _ := http.Get(srv.URL + "/api/v1/admin/bitacora"); r.StatusCode != 401 {
		t.Errorf("sin sesión: %d", r.StatusCode)
	}
}
