package reglas_test

import (
	"context"
	"testing"

	"mjbj/internal/pruebas"
	"mjbj/internal/reglas"
)

// La palabra del circuito sin factura (H167): de arranque «circuito B», y
// con la regla, la que se eligió, en frases y en los textos armados del
// cierre. El valor guardado no cambia.
func TestElNombreDelCircuito(t *testing.T) {
	if got := reglas.EnElTexto("Cobros en el B de ventas facturadas después", "sin_factura"); got != "Cobros en el circuito sin factura de ventas facturadas después" {
		t.Errorf("en el B: %q", got)
	}
	if got := reglas.EnElTexto("Pagos del circuito B con retención", "interno"); got != "Pagos del circuito interno con retención" {
		t.Errorf("circuito B: %q", got)
	}
	if got := reglas.EnElTexto("La retención va al archivo del estudio y el pago al del circuito B: Proveedores queda partido.", "b"); got != "La retención va al archivo del estudio y el pago al del circuito B: Proveedores queda partido." {
		t.Errorf("con b no cambia: %q", got)
	}
	if reglas.EtiquetaCorta("sin_factura") != "Sin factura" || reglas.EtiquetaCorta("b") != "B" {
		t.Error("etiqueta corta")
	}
	pool := pruebas.Base(t)
	ctx := context.Background()
	if reglas.Circuito(ctx, pool) != "circuito B" || reglas.CircuitoCorto(ctx, pool) != "B" {
		t.Errorf("de arranque: %q", reglas.Circuito(ctx, pool))
	}
	_ = reglas.Fijar(ctx, pool, reglas.EtiquetaDelCircuito, "interno")
	if reglas.Circuito(ctx, pool) != "circuito interno" || reglas.CircuitoCorto(ctx, pool) != "Interno" {
		t.Errorf("interno: %q", reglas.Circuito(ctx, pool))
	}
}

func TestElArchivoBCambiaConLaRegla(t *testing.T) {
	if got := reglas.EnElTexto("$ 10,00 en el archivo B: la factura queda sola.", "interno"); got != "$ 10,00 en el archivo del circuito interno: la factura queda sola." {
		t.Errorf("%q", got)
	}
	if got := reglas.EnElTexto("van al archivo B.", "b"); got != "van al archivo B." {
		t.Errorf("con «b» no cambia: %q", got)
	}
}
