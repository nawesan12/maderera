package pagos

import (
	"context"
	"testing"
)

// H375: dos transferencias iguales informadas en el mismo minuto: la segunda
// sale marcada como repetida, y las dos con lo que debe hoy el cliente.
func TestTransferenciaRepetidaEnAVerificar(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre) values ('Mueblería') returning id`)
	for range 2 {
		e.id(t, `insert into payments (customer_id, tipo, proveedor, medio, monto, estado) values ($1, 'deuda', 'transferencia', 'transferencia', 520116, 'en_revision') returning id`, cliente)
	}
	otro := e.id(t, `insert into payments (customer_id, tipo, proveedor, medio, monto, estado) values ($1, 'deuda', 'transferencia', 'transferencia', 1000, 'en_revision') returning id`, cliente)
	lista, err := e.s.Listar(ctx, "en_revision", nil)
	if err != nil {
		t.Fatal(err)
	}
	repetidos := 0
	for _, p := range lista {
		if p.Duplicado {
			repetidos++
		}
		if p.ID == otro && p.Duplicado {
			t.Errorf("el de otro importe no es repetido")
		}
		if p.SaldoCliente == nil || *p.SaldoCliente != 0 {
			t.Errorf("saldo: %v", p.SaldoCliente)
		}
	}
	if repetidos != 1 {
		t.Errorf("repetidos: %d", repetidos)
	}
}

// El aviso de pago de un pedido sin cobrar dice lo que falta del pedido, no
// «Sin deuda» de la cuenta corriente (mes simulado, tercera prueba).
func TestAvisoDeUnPedidoDiceLoQueFalta(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre) values ('Paula Ríos') returning id`)
	pedido := e.id(t, `insert into orders (numero, contacto_nombre, origen, subtotal, total, estado, estado_pago, medio_pago, customer_id)
		values ('PED-1220', 'Paula', 'mostrador', 80000, 80000, 'pendiente', 'pendiente', 'transferencia', $1) returning id`, cliente)
	aviso := e.id(t, `insert into payments (customer_id, order_id, tipo, proveedor, medio, monto, estado) values ($1, $2, 'pedido', 'transferencia', 'transferencia', 80000, 'en_revision') returning id`, cliente, pedido)
	lista, err := e.s.Listar(ctx, "en_revision", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range lista {
		if p.ID == aviso && (p.SaldoCliente == nil || *p.SaldoCliente != 80000) {
			t.Fatalf("lo que falta del pedido: %v", p.SaldoCliente)
		}
	}
}
