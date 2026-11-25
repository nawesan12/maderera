package csvexcel

import "testing"

// Un texto que Excel tomaría como fórmula sale con un apóstrofo adelante;
// el resto, igual que siempre.
func TestTextoSinFormula(t *testing.T) {
	for entrada, esperado := range map[string]string{
		`=HYPERLINK("http://x","clic")`: `"'=HYPERLINK(""http://x"",""clic"")"`,
		"+54 223":                       `"'+54 223"`,
		"-2+3":                          `"'-2+3"`,
		"@SUMA(A1)":                     `"'@SUMA(A1)"`,
		"\tcmd":                         "\"'\tcmd\"",
		"\rcmd":                         "\"'\rcmd\"",
		"Melamínica 18 mm":              `"Melamínica 18 mm"`,
		"20-12345678-9":                 `"20-12345678-9"`,
		"":                              `""`,
	} {
		if got := Texto(entrada); got != esperado {
			t.Errorf("Texto(%q) = %s, quería %s", entrada, got, esperado)
		}
	}
}
