package precios

import (
	"context"
	"errors"
	"testing"

	"mjbj/internal/plataforma"
)

// No hay productos a $0 (comité final, M11 y decisión 4): con la lista en 0,
// vender a $0 no se medía como bajo la lista y no pedía el PIN. Se rechaza
// antes de tocar la base.
func TestPrecioEnCeroNoSeGuarda(t *testing.T) {
	s := &Servicio{}
	const v, l = "8f2b5c1e-1d2a-4c3b-9a8e-000000000001", "8f2b5c1e-1d2a-4c3b-9a8e-000000000002"
	for _, precio := range []string{"0", "0.00", "-1", "abc"} {
		var p *plataforma.Problema
		if err := s.Editar(context.Background(), nil, v, l, precio); !errors.As(err, &p) || p.Errores["precio"] == "" {
			t.Errorf("%q: %v", precio, err)
		}
	}
}
