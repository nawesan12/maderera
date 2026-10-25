package plataforma

import "testing"

func TestCorreoComoZod(t *testing.T) {
	// Lo que contesta /…/.test() de zod 4.4.3 para cada uno.
	for c, ok := range map[string]bool{
		"juan@mjbj.com.ar": true, "a.b+c@x.io": true, "o'neil@x.com": true, "x@sub-dominio.ar": true,
		".juan@x.com": false, "ju..an@x.com": false, "juan.@x.com": false, "juan@x": false, "juan@x.c": false,
		"juan@-x.com": false, "juan @x.com": false, "Juan <j@x.com>": false, "j@x.com.": false, "ñandú@x.com": false, "": false,
	} {
		if CorreoValido(c) != ok {
			t.Errorf("CorreoValido(%q) = %v", c, !ok)
		}
	}
}
