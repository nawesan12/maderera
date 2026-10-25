package productos

import (
	"encoding/json"
	"os"
	"testing"

	"mjbj/internal/formato"
)

type golden struct {
	Validacion []struct {
		Entrada json.RawMessage
		Error   string
		Campo   string
		Datos   map[string]any
	}
	Cantidades []struct {
		V, Redondeado float64
		Texto         string
	}
	Slugs []struct{ T, Slug string }
}

func leerGolden(t *testing.T) golden {
	crudo, err := os.ReadFile("../../testdata/golden/productos/ficha.json")
	if err != nil {
		t.Fatal(err)
	}
	var g golden
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func ptr(f *float64) any {
	if f == nil {
		return nil
	}
	return *f
}

func TestValidarComoZod(t *testing.T) {
	g := leerGolden(t)
	for i, c := range g.Validacion {
		var f FormProducto
		if err := json.Unmarshal(c.Entrada, &f); err != nil {
			t.Fatal(err)
		}
		var crudo map[string]any
		_ = json.Unmarshal(c.Entrada, &crudo)
		if v, ok := crudo["precioMediaPct"]; ok && v == "" {
			continue // la acción del TS nunca lo manda vacío: lo cambiaba por "50"
		}
		p, e := Validar(f)
		if c.Error != "" {
			if e == nil || e.Mensaje != c.Error || e.Campo != c.Campo {
				t.Errorf("caso %d: Go %+v, zod {%s %s}", i, e, c.Campo, c.Error)
			}
			continue
		}
		if e != nil {
			t.Errorf("caso %d: Go rechazó (%s: %s) y zod aceptó", i, e.Campo, e.Mensaje)
			continue
		}
		d := c.Datos
		mismos := func(campo string, go_, ts any) {
			if go_ != ts {
				t.Errorf("caso %d, %s: Go %#v, zod %#v", i, campo, go_, ts)
			}
		}
		texto := func(s *string) any {
			if s == nil {
				return nil
			}
			return *s
		}
		mismos("name", p.Name, d["name"])
		mismos("slug", p.Slug, d["slug"])
		mismos("subcategory", texto(p.Subcategory), d["subcategory"])
		mismos("brand", texto(p.Brand), d["brand"])
		mismos("imputacion", texto(p.Imputacion), d["imputacion"])
		mismos("description", p.Description, d["description"])
		mismos("formaDeVenta", p.FormaDeVenta, d["formaDeVenta"])
		mismos("precioMediaPct", p.PrecioMediaPct, d["precioMediaPct"])
		mismos("alicuotaIva", p.AlicuotaIva, d["alicuotaIva"])
		mismos("recargoElaboracionPct", ptr(p.RecargoElaboracionPct), d["recargoElaboracionPct"])
		mismos("imagen", p.Imagen, d["imagen"])
		vs := d["variantes"].([]any)
		for j, x := range p.Variantes {
			dv := vs[j].(map[string]any)
			mismos("sku", x.SKU, dv["sku"])
			mismos("label", x.Label, dv["label"])
			mismos("largoMm", ptr(x.LargoMm), dv["largoMm"])
			mismos("anchoMm", ptr(x.AnchoMm), dv["anchoMm"])
			mismos("espesorMm", ptr(x.EspesorMm), dv["espesorMm"])
			mismos("material", x.Material, dv["material"])
			mismos("precioGeneral", x.PrecioGeneral, dv["precioGeneral"])
			mismos("precioProfesional", x.PrecioProfesional, dv["precioProfesional"])
			mismos("stockCentral", ptr(x.StockCentral), dv["stockCentral"])
			mismos("stockAserradero", ptr(x.StockAserradero), dv["stockAserradero"])
			mismos("minCentral", ptr(x.MinCentral), dv["minCentral"])
			mismos("minAserradero", ptr(x.MinAserradero), dv["minAserradero"])
		}
	}
}

func TestCantidadYSlugComoTS(t *testing.T) {
	g := leerGolden(t)
	for _, c := range g.Cantidades {
		if r := formato.Cantidad(c.V); r != c.Texto {
			t.Errorf("Cantidad(%v) = %q, TS %q", c.V, r, c.Texto)
		}
	}
	for _, c := range g.Slugs {
		if r := GenerarSlug(c.T); r != c.Slug {
			t.Errorf("GenerarSlug(%q) = %q, TS %q", c.T, r, c.Slug)
		}
	}
}
