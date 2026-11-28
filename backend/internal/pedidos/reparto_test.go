package pedidos

import (
	"context"
	"testing"

	"mjbj/internal/sqlc"
)

// Mes simulado 2 (M2S1-078, M3S1-021, M2S2-054): la tarjeta del reparto
// dice qué cargar, qué va en el camión (y no lo que quedó en el galpón), y
// marca el flete por cotizar.
func TestElRepartoDiceQueLlevaCadaEnvio(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.exec(t, `insert into shipping_zones (nombre, costo, a_cotizar) values ('Mar del Plata', 0, true)`)
	pedido := e.pedido(t, ses, 3)
	e.exec(t, `update orders set tipo_entrega = 'envio', estado = 'listo', zona_envio = 'Mar del Plata', costo_envio = 0 where id = $1`, pedido)
	buscar := func() PedidoListado {
		t.Helper()
		lista, err := e.s.ListarPedidosEn(ctx, Filtros{}, VistaDePedidos{Vista: "tablero"})
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range lista {
			if p.ID == pedido {
				return p
			}
		}
		t.Fatal("no está en el tablero")
		return PedidoListado{}
	}
	p := buscar()
	if len(p.ALlevar) == 0 || p.ALlevar[0].Pendiente != 3 || !p.FleteACotizar || len(p.EnElCamion) != 0 {
		t.Fatalf("antes de salir: %+v", p)
	}
	// Sale un remito por 2: en el camión van 2, y queda 1 por llevar.
	remito := e.id(t, `insert into deliveries (numero, order_id, tipo, estado, firma_token) values ('REM-9', $1, 'envio', 'preparada', 'tok-reparto-123') returning id`, pedido)
	e.exec(t, `insert into delivery_items (delivery_id, order_item_id, cantidad) select $1, id, 2 from order_items where order_id = $2 and variant_id is not null`, remito, pedido)
	e.exec(t, `update orders set estado = 'en-camino' where id = $1`, pedido)
	p = buscar()
	if len(p.EnElCamion) != 1 || p.EnElCamion[0].Numero != "REM-9" || p.EnElCamion[0].Lineas[0].Pendiente != 2 || p.EnElCamion[0].FirmaToken != "tok-reparto-123" {
		t.Fatalf("en el camión: %+v", p.EnElCamion)
	}
	falta := 0.0
	for _, r := range p.ALlevar {
		falta += r.Pendiente
	}
	if falta != 1 { // la placa que queda: el flete no se carga
		t.Errorf("falta llevar: %+v", p.ALlevar)
	}
}
