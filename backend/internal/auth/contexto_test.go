package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

func estadoDe(t *testing.T, err error) int {
	t.Helper()
	if err == nil {
		return http.StatusOK
	}
	var p *plataforma.Problema
	if !errors.As(err, &p) {
		t.Fatalf("error que no es un problema: %v", err)
	}
	return p.Estado
}

// Una clave mal escrita en roles.QuienEntra devuelve nil: Exigir no puede
// tomar eso como «entra cualquiera».
func TestExigirSinRolesNoDejaEntrarANadie(t *testing.T) {
	admin := sqlc.StaffRoleAdmin
	personal := ConSesion(context.Background(), &Sesion{UserID: "u1", Rol: sqlc.UserRoleStaff, RolStaff: &admin})
	cliente := ConSesion(context.Background(), &Sesion{UserID: "u2", Rol: sqlc.UserRoleCliente})

	exigir := func(ctx context.Context, rs ...sqlc.StaffRole) int {
		_, err := Exigir(ctx, rs...)
		return estadoDe(t, err)
	}
	if got := exigir(personal, roles.QuienEntra("/admin/no-existe")...); got != http.StatusForbidden {
		t.Errorf("admin con una pantalla que no existe: %d, quería 403", got)
	}
	if got := exigir(cliente); got != http.StatusForbidden {
		t.Errorf("cliente sin roles pedidos: %d, quería 403", got)
	}
	if got := exigir(context.Background()); got != http.StatusUnauthorized {
		t.Errorf("sin sesión: %d, quería 401", got)
	}
	if got := exigir(personal, roles.QuienEntra("/admin/precios")...); got != http.StatusOK {
		t.Errorf("admin en /admin/precios: %d, quería que entre", got)
	}
	// La que sí acepta a cualquiera que haya entrado es ExigirSesion.
	_, err := ExigirSesion(cliente)
	if got := estadoDe(t, err); got != http.StatusOK {
		t.Errorf("ExigirSesion con un cliente: %d, quería que entre", got)
	}
}

// Un anónimo que manda un pedido mal formado a una ruta del panel recibe un
// 401, no el 400 del contrato que le describe el esquema.
func TestPanelCierraAntesDelContrato(t *testing.T) {
	interna := plataforma.ConfigInterna{Secreto: "secreto-interno"}
	contrato := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusBadRequest, "parameter \"q\" in query has an error: value is required"))
	})
	h := Panel(interna)(contrato)
	admin := sqlc.StaffRoleAdmin
	casos := []struct {
		nombre, ruta, cabecera string
		ses                    *Sesion
		quiero                 int
	}{
		{"anónimo en el panel", "/api/v1/admin/buscar", "", nil, http.StatusUnauthorized},
		{"cliente en el panel", "/api/v1/admin/buscar", "", &Sesion{UserID: "c", Rol: sqlc.UserRoleCliente}, http.StatusForbidden},
		{"personal en el panel", "/api/v1/admin/buscar", "", &Sesion{UserID: "a", Rol: sqlc.UserRoleStaff, RolStaff: &admin}, http.StatusBadRequest},
		{"Next con el secreto", "/api/v1/admin/buscar", "Bearer secreto-interno", nil, http.StatusBadRequest},
		{"anónimo en la tienda", "/api/v1/catalogo/rubros", "", nil, http.StatusBadRequest},
	}
	for _, c := range casos {
		r := httptest.NewRequest("GET", c.ruta, nil)
		if c.cabecera != "" {
			r.Header.Set("Authorization", c.cabecera)
		}
		if c.ses != nil {
			r = r.WithContext(ConSesion(r.Context(), c.ses))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.quiero {
			t.Errorf("%s: %d, quería %d", c.nombre, w.Code, c.quiero)
		}
	}
}
