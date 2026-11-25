package api

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Un `number` sin `format: double` lo genera oapi-codegen como float32: 4,4
// mm de sierra llegaban como 4.400000095, y la plata con float32 pierde
// centavos. Todo número de los contratos tiene que ser double.
func TestNumerosEnDoble(t *testing.T) {
	archivos, _ := filepath.Glob("*.yaml")
	sinFormato := regexp.MustCompile(`type: number(?:[ ,}]|$)`)
	for _, a := range archivos {
		if strings.HasSuffix(a, ".gen.yaml") {
			continue
		}
		crudo, err := os.ReadFile(a)
		if err != nil {
			t.Fatal(err)
		}
		lineas := strings.Split(string(crudo), "\n")
		for i, l := range lineas {
			if !sinFormato.MatchString(l) || strings.Contains(l, "format:") {
				continue
			}
			if i+1 < len(lineas) && strings.Contains(lineas[i+1], "format:") {
				continue
			}
			t.Errorf("%s:%d: un number sin format: double (llega como float32): %s", a, i+1, strings.TrimSpace(l))
		}
	}
}
