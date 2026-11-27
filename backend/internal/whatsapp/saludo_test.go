package whatsapp

import "testing"

func TestNombreDeSaludo(t *testing.T) {
	for entra, sale := range map[string]string{
		"Carpintería Prueba SRL":   "Carpintería Prueba",
		"RF Construcciones S.R.L.": "RF Construcciones",
		"Maderas del Sur":          "Maderas del Sur",
		"Marta Gómez":              "Marta",
		"Dr. Juan Pérez":           "Dr.",
		"  ":                       "",
		"Aberturas Pérez S.A.":     "Aberturas Pérez",
		"Sim Mueblería Atlántica":  "Sim Mueblería Atlántica",
		"Sim Obra Barrio Parque":   "Sim Obra Barrio Parque",
		"Juan Obra":                "Juan",
	} {
		if got := NombreDeSaludo(entra); got != sale {
			t.Errorf("%q: %q, se esperaba %q", entra, got, sale)
		}
	}
}
