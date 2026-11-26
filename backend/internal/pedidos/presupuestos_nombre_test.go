package pedidos

import (
	"context"
	"testing"
)

// Mes simulado: el panel cargaba la razón social como contacto y el portal
// el nombre, y la lista los mezclaba. Con la razón social de la ficha como
// contacto, la lista muestra el nombre; un contacto distinto se respeta.
func TestListaDePresupuestosNombraIgual(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	c := e.id(t, `insert into customers (nombre, razon_social) values ('Roberto Fernández', 'RF Construcciones SRL') returning id`)
	e.exec(t, `insert into quotes (numero, contacto_nombre, customer_id, estado) values
		('P-A', 'RF Construcciones SRL', $1, 'rechazado'),
		('P-B', 'Roberto Fernández', $1, 'pendiente'),
		('P-C', 'Juan del obrador', $1, 'pendiente')`, c)
	p, err := e.s.ListarPresupuestos(ctx, Filtros{}, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	quiero := map[string]string{"P-A": "Roberto Fernández", "P-B": "Roberto Fernández", "P-C": "Juan del obrador"}
	for _, f := range p.Filas {
		if f.Cliente != quiero[f.Numero] {
			t.Errorf("%s: %q, quería %q", f.Numero, f.Cliente, quiero[f.Numero])
		}
		if f.Empresa == nil || *f.Empresa != "RF Construcciones SRL" {
			t.Errorf("%s: empresa %v", f.Numero, f.Empresa)
		}
	}
}
