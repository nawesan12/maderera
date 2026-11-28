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
		// Mes 23: el rubro en la tercera palabra.
		"Sim V1at Carpintería Ruiz":    "Sim V1at Carpintería Ruiz",
		"Sim V1at Aberturas Norte SRL": "Sim V1at Aberturas Norte",
		"Sim V1at Bruno Arce":          "Sim",
		"Ana María Taller":             "Ana",
		// Recorrido M4-106.
		"Sim Club Náutico Sur Asociación Civil": "Sim Club Náutico Sur",
		"Club Atlético Kimberley":               "Club Atlético Kimberley",
		"Sim Escuela Técnica 5":                 "Sim Escuela Técnica 5",
	} {
		if got := NombreDeSaludo(entra); got != sale {
			t.Errorf("%q: %q, se esperaba %q", entra, got, sale)
		}
	}
}
