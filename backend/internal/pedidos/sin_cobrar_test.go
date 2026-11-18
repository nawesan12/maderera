package pedidos

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Entregar sin cobrar se puede, pero deja firma en el historial: cuánto
// faltaba y quién lo entregó. El pedido aparece en el historial filtrado
// «sin-cobrar» (el renglón de «Me deben»), con lo que falta en sinCobrar;
// uno cobrado no deja nota ni aparece.
func TestEntregarSinCobrarDejaFirma(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	sinCobrar := e.pedido(t, ses, 1)
	cobrado := e.pedido(t, ses, 1)
	e.exec(t, `update orders set medio_pago = 'efectivo'`)
	e.exec(t, `update orders set estado_pago = 'pagado' where id = $1`, cobrado)
	total := e.numero(t, `select total from orders where id = $1`, sinCobrar)

	for _, id := range []string{sinCobrar, cobrado} {
		for i := 0; i < 4; i++ {
			r, err := e.s.Avanzar(ctx, ses, id)
			if err != nil {
				t.Fatal(err)
			}
			if r.Estado == "entregado" {
				break
			}
		}
	}
	nota := func(id string) string {
		return e.texto(t, `select coalesce(nota, '') from order_status_history where order_id = $1 and estado = 'entregado'`, id)
	}
	if n := nota(sinCobrar); !strings.HasPrefix(n, NotaEntregadoSinCobrar+" · $") {
		t.Errorf("nota: %q", n)
	}
	if n := nota(cobrado); n != "" {
		t.Errorf("el cobrado no deja nota: %q", n)
	}

	lista, err := e.s.ListarPedidosEn(ctx, Filtros{Estado: EstadoSinCobrar}, VistaDePedidos{Vista: "historial"})
	if err != nil {
		t.Fatal(err)
	}
	if len(lista) != 1 || lista[0].ID != sinCobrar || lista[0].SinCobrar == nil || *lista[0].SinCobrar != total {
		t.Fatalf("sin cobrar: %+v", lista)
	}
	ficha, err := e.s.Pedido(ctx, cobrado, false)
	if err != nil || ficha.SinCobrar != nil {
		t.Errorf("el cobrado no debe nada: %+v %v", ficha.SinCobrar, err)
	}
}
