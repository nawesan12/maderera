package main

import (
	"testing"

	"mjbj/internal/cortes"
)

func TestElegirPlaca(t *testing.T) {
	placas := []cortes.PlacaCortable{
		{VariantID: "a", Descripcion: "Melamina Negra 18mm"},
		{VariantID: "b", Descripcion: "Melamina Blanca 18mm"},
		{VariantID: "c", Descripcion: "Fenólico 18mm"},
	}
	casos := map[string]string{"melamina blanca": "b", "fenolico": "c", "melamina roble": "a", "quebracho": "", "": ""}
	for material, quiere := range casos {
		got := ""
		if p := elegirPlaca(placas, material); p != nil {
			got = p.VariantID
		}
		if got != quiere {
			t.Errorf("%q: %q, quería %q", material, got, quiere)
		}
	}
}
