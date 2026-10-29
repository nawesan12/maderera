package clientes

import (
	"encoding/json"
	"os"
	"testing"

	"mjbj/internal/plataforma"
)

func primerError(t *testing.T, err error) (string, string) {
	t.Helper()
	var p *plataforma.Problema
	if err == nil {
		return "", ""
	}
	b, _ := json.Marshal(err)
	if pe, ok := err.(*plataforma.Problema); ok {
		p = pe
	} else {
		t.Fatalf("error que no es un problema: %v %s", err, b)
	}
	for k, v := range p.Errores {
		return k, v
	}
	return "", p.Detalle
}

func TestFormularioDelClienteComoZod(t *testing.T) {
	crudo, err := os.ReadFile("../../testdata/golden/cuentas/formularios.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Clientes []struct {
			Entrada      map[string]string
			Error, Campo string
			Datos        map[string]any
		}
		Limites []struct{ T, R string }
	}
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	for i, c := range g.Clientes {
		e := c.Entrada
		cl, err := ValidarCliente(FormCliente{ID: e["id"], Nombre: e["nombre"], RazonSocial: e["razonSocial"], Cuit: e["cuit"],
			CondicionIva: e["condicionIva"], Tipo: e["tipo"], Email: e["email"], Telefono: e["telefono"], Direccion: e["direccion"],
			Rubro: e["rubro"], Asesor: e["asesor"], SellerID: e["sellerId"], LimiteCredito: e["limiteCredito"],
			PriceListID: e["priceListId"], Notas: e["notas"]})
		campo, msj := primerError(t, err)
		if c.Error != "" {
			if campo != c.Campo || msj != c.Error {
				t.Errorf("cliente %d: Go (%s, %q), zod (%s, %q)", i, campo, msj, c.Campo, c.Error)
			}
			continue
		}
		if err != nil {
			t.Errorf("cliente %d: Go rechazó %s %q", i, campo, msj)
			continue
		}
		if cl.Nombre != c.Datos["nombre"] {
			t.Errorf("cliente %d nombre: %q", i, cl.Nombre)
		}
		if r, ok := c.Datos["razonSocial"].(string); ok && (cl.RazonSocial == nil || *cl.RazonSocial != r) {
			t.Errorf("cliente %d razón social: %v", i, cl.RazonSocial)
		}
	}
	// El límite: igual al TS en todo lo que el TS leía bien; distinto (a
	// propósito) en lo que leía mal, que es el formato argentino.
	arreglados := map[string]string{"$ 1.500.000,50": "1500000.50", "1.500.000": "1500000.00", "250.000,99": "250000.99", "1.2.3": "123.00"}
	for _, c := range g.Limites {
		esperado := c.R
		if a, ok := arreglados[c.T]; ok {
			esperado = a
		}
		if r := LimiteDeCredito(c.T); r != esperado {
			t.Errorf("límite %q: Go %s, esperado %s (TS %s)", c.T, r, esperado, c.R)
		}
	}
}
