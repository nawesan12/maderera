package cobros

import (
	"context"
	"testing"

	"mjbj/internal/sqlc"
)

// M4-067: la rebaja de un pedido corregido (una compra en negativo) se ve
// como ajuste, también con «Notas y ajustes», y no en «Compras».
func TestLaRebajaDelPedidoEsUnAjuste(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	if _, err := b.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, detalle, referencia)
		values ($1, 'compra', 513000, 'Compra PED-1017', 'PED-1017'), ($1, 'compra', -57800, 'Corrección del pedido PED-1017', 'PED-1017')`, b.cliente); err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(b.pool)
	for filtro, quiero := range map[string]int{"ajustes": 1, "compras": 1} {
		movs, _, err := Historial(ctx, q, b.cliente, nil, filtro, 0)
		if err != nil {
			t.Fatal(err)
		}
		if len(movs) != quiero {
			t.Fatalf("%s: %+v", filtro, movs)
		}
		if filtro == "ajustes" && (movs[0].Clase != "ajuste" || movs[0].Titulo != "Ajuste") {
			t.Errorf("la rebaja: %+v", movs[0])
		}
	}
}
