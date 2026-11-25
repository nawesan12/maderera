package clientes

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"mjbj/internal/cuit"
)

func TestDocumentoYCuitComoTS(t *testing.T) {
	crudo, err := os.ReadFile("../../testdata/golden/cuentas/logica.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Cuit []struct {
			C, Solo, Largo string
			Valido         bool
			Variantes      []string
			Dv             *int
		}
		Dnis []struct {
			D      string
			Valido bool
		}
		Documentos []struct {
			T   string
			R   map[string]string
			Iva *string
		}
		Precargas []struct {
			B string
			R struct{ Nombre, Documento string }
		}
	}
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	for _, c := range g.Cuit {
		dv := -1
		if c.Dv != nil {
			dv = *c.Dv
		}
		solo := cuit.SoloDigitos(c.C)
		diez := solo
		if len(diez) > 10 {
			diez = diez[:10]
		}
		if solo != c.Solo || cuit.Valido(c.C) != c.Valido || cuit.FormatearLargo(c.C) != c.Largo ||
			!reflect.DeepEqual(cuit.Variantes(c.C), c.Variantes) || cuit.DigitoVerificador(diez) != dv {
			t.Errorf("cuit %q: Go (%q, %v, %q, %v, %d), TS %+v", c.C, solo, cuit.Valido(c.C), cuit.FormatearLargo(c.C), cuit.Variantes(c.C), cuit.DigitoVerificador(diez), c)
		}
	}
	for _, c := range g.Dnis {
		if cuit.DniValido(c.D) != c.Valido {
			t.Errorf("dni %q", c.D)
		}
	}
	for _, c := range g.Documentos {
		doc, e := LeerDocumento(c.T)
		if c.R["error"] != "" {
			if e != c.R["error"] {
				t.Errorf("documento %q: Go %q, TS %q", c.T, e, c.R["error"])
			}
			continue
		}
		if e != "" || doc.Tipo != c.R["tipo"] || doc.Digitos != c.R["digitos"] || SugerirCondicionIva(doc) != *c.Iva {
			t.Errorf("documento %q: Go %+v %q, TS %v %v", c.T, doc, e, c.R, *c.Iva)
		}
	}
	for _, c := range g.Precargas {
		n, d := PrecargaDelAlta(c.B)
		if n != c.R.Nombre || d != c.R.Documento {
			t.Errorf("precarga %q: Go (%q, %q), TS %+v", c.B, n, d, c.R)
		}
	}
}
