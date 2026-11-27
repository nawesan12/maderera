package pedidos

import (
	"context"
	"testing"

	"mjbj/internal/sqlc"
)

// Mes 23 (depósito): el envío a una zona a cotizar que se pasa a pedido con
// «Sin cargo» a propósito no queda marcado «Flete sin cotizar», ni en la
// ficha ni en el reparto. El que sale sin flete y sin elegirlo, sí.
func TestElSinCargoNoEsUnFletePorCotizar(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.exec(t, `insert into shipping_zones (nombre, costo, a_cotizar) values ('Sim Batán', 0, true)`)
	u := e.srv.URL + "/api/v1/admin/"
	alta := func() string {
		t.Helper()
		c, b := pedir(t, ven, "POST", u+"presupuestos", e.alta("Sim Lucía", 1, nil))
		if c != 200 {
			t.Fatalf("alta: %d %s", c, b)
		}
		return leer[Resultado](t, b).ID
	}
	pasar := func(extra map[string]any) string {
		t.Helper()
		m := map[string]any{"tipoEntrega": "envio", "direccion": "Colón 1234", "zona": "Sim Batán"}
		for k, v := range extra {
			m[k] = v
		}
		c, b := pedir(t, ven, "POST", u+"presupuestos/"+alta()+"/pedido", m)
		if c != 200 {
			t.Fatalf("pasar a pedido: %d %s", c, b)
		}
		return leer[Resultado](t, b).ID
	}
	gratis := pasar(map[string]any{"sinCargo": true})
	aCotizar := pasar(map[string]any{"costoEnvio": 0.0})

	for id, quiere := range map[string]bool{gratis: true, aCotizar: false} {
		f, err := e.s.Pedido(ctx, id, false)
		if err != nil || f == nil {
			t.Fatalf("ficha: %v", err)
		}
		if f.FleteSinCargo != quiere {
			t.Errorf("%s: fleteSinCargo %v", f.Numero, f.FleteSinCargo)
		}
	}
	e.exec(t, `update orders set estado = 'listo' where id in ($1, $2)`, gratis, aCotizar)
	lista, err := e.s.ListarPedidosEn(ctx, Filtros{}, VistaDePedidos{Vista: "tablero"})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range lista {
		if p.ID == gratis && p.FleteACotizar {
			t.Errorf("el sin cargo figura por cotizar")
		}
		if p.ID == aCotizar && !p.FleteACotizar {
			t.Errorf("el de flete en cero no figura por cotizar")
		}
	}
}
