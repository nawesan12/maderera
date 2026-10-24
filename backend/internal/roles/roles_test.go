package roles

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"mjbj/internal/sqlc"
)

type golden struct {
	Acceso     map[string][]string `json:"acceso"`
	QuienEntra map[string][]string `json:"quienEntra"`
	Inicio     map[string]string   `json:"inicio"`
	Matriz     []struct {
		Ruta  string  `json:"ruta"`
		Rol   *string `json:"rol"`
		Puede bool    `json:"puede"`
	} `json:"matriz"`
}

func TestComoLibRoles(t *testing.T) {
	crudo, err := os.ReadFile("../../testdata/golden/roles/acceso.json")
	if err != nil {
		t.Fatal(err)
	}
	var g golden
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	if len(g.Acceso) != len(Acceso) {
		t.Errorf("ACCESO tiene %d rutas en el TS y %d en Go", len(g.Acceso), len(Acceso))
	}
	aTexto := func(rs []sqlc.StaffRole) []string {
		out := make([]string, len(rs))
		for i, r := range rs {
			out[i] = string(r)
		}
		return out
	}
	for ruta, want := range g.QuienEntra {
		if got := aTexto(QuienEntra(ruta)); !slices.Equal(got, want) && !(len(got) == 0 && want == nil) {
			t.Errorf("QuienEntra(%q) = %v, el TS da %v", ruta, got, want)
		}
	}
	for _, c := range g.Matriz {
		var rol *sqlc.StaffRole
		if c.Rol != nil {
			r := sqlc.StaffRole(*c.Rol)
			rol = &r
		}
		if got := PuedeEntrar(c.Ruta, rol); got != c.Puede {
			t.Errorf("PuedeEntrar(%q, %v) = %v, el TS da %v", c.Ruta, c.Rol, got, c.Puede)
		}
	}
	for rol, want := range g.Inicio {
		var r *sqlc.StaffRole
		if rol != "null" {
			v := sqlc.StaffRole(rol)
			r = &v
		}
		if got := InicioDelRol(r); got != want {
			t.Errorf("InicioDelRol(%s) = %q, el TS da %q", rol, got, want)
		}
	}
}
