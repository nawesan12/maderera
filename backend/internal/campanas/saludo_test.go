package campanas

import (
	"strings"
	"testing"
)

// Un texto que empieza con «Hola {{nombre}},» lleva el nombre y no repite el
// saludo automático (mes simulado, M2S1-049).
func TestSaludoPropioConNombre(t *testing.T) {
	c := ParaArmar{Asunto: "Novedades", Cuerpo: "Hola {{nombre}},\n\nLlegaron las placas."}
	correo := ArmarCorreo("https://mjbj.test", "secreto-de-prueba-de-las-bajas-32-caracteres", c, "ana@prueba.test", "Arq. Ana Pérez")
	if strings.Contains(correo.Texto, "{{nombre}}") {
		t.Errorf("quedó la marca sin reemplazar:\n%s", correo.Texto)
	}
	if n := strings.Count(correo.Texto, "Hola"); n != 1 {
		t.Errorf("el saludo sale %d veces:\n%s", n, correo.Texto)
	}
	if !strings.Contains(correo.Texto, "Hola Ana,") {
		t.Errorf("falta «Hola Ana,»:\n%s", correo.Texto)
	}

	// Sin nombre: «Hola,» y nada de «Hola ,».
	if cuerpo, propio := Personalizar("Hola {{ nombre }}, ¿cómo va?", ""); cuerpo != "Hola, ¿cómo va?" || !propio {
		t.Errorf("sin nombre: %q %v", cuerpo, propio)
	}
	// Un texto sin saludo sigue llevando el automático.
	sin := ArmarCorreo("https://mjbj.test", "secreto-de-prueba-de-las-bajas-32-caracteres", ParaArmar{Asunto: "x", Cuerpo: "Llegaron las placas."}, "ana@prueba.test", "Ana")
	if !strings.Contains(sin.Texto, "Hola Ana,") {
		t.Errorf("se perdió el saludo automático:\n%s", sin.Texto)
	}
}
