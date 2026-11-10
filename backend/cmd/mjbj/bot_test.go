package main

import (
	"testing"

	"mjbj/internal/cortes"
)

func TestElegirPlaca(t *testing.T) {
	placas := []cortes.PlacaCortable{
		{VariantID: "a", Descripcion: "Melamina Negra 18mm"},
		{VariantID: "b", Descripcion: "Melamina Blanca 18mm"},
		{VariantID: "d", Descripcion: "Melamina Blanca 15mm"},
		{VariantID: "c", Descripcion: "Fenólico 18mm"},
	}
	casos := map[string]string{"melamina blanca": "b", "fenolico": "c", "melamina roble": "a", "quebracho": "", "": ""}
	for material, quiere := range casos {
		got := ""
		if p := elegirPlaca(placas, material, 0); p != nil {
			got = p.VariantID
		}
		if got != quiere {
			t.Errorf("%q: %q, quería %q", material, got, quiere)
		}
	}
}

func TestElegirPlacaPorEspesor(t *testing.T) {
	placas := []cortes.PlacaCortable{
		{VariantID: "b", Descripcion: "Melamina Blanca 18mm"},
		{VariantID: "d", Descripcion: "Melamina Blanca 15mm"},
	}
	if p := elegirPlaca(placas, "melamina blanca", 15); p == nil || p.VariantID != "d" {
		t.Errorf("15mm: %+v", p)
	}
	if p := elegirPlaca(placas, "melamina blanca", 25); p != nil {
		t.Errorf("sin ese espesor no se elige otra: %+v", p)
	}
}
