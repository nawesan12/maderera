package cobros

import (
	"context"
	"testing"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// Lo que encontró el mes simulado en el historial que ve el cliente.

func TestDetalleParaElCliente(t *testing.T) {
	// H386: el motivo interno de la anulación nombraba a otro cliente.
	d := "Anulación de la venta PED-1121: Se cargó a la Mueblería y era de la Constructora"
	if v := DetalleParaElCliente(&d); v == nil || *v != "Anulación de la venta PED-1121" {
		t.Errorf("anulación: %v", v)
	}
	// Tercera prueba: la cancelación desde el panel guarda el motivo igual.
	c := "Cancelación del pedido PED-1219: Se cargó a la Constructora y era de la Mueblería Sur"
	if v := DetalleParaElCliente(&c); v == nil || *v != "Cancelación del pedido PED-1219" {
		t.Errorf("cancelación: %v", v)
	}
	otro := "Cheque Banco Nación N° 1 rechazado por el banco: sin fondos"
	if v := DetalleParaElCliente(&otro); v != &otro {
		t.Errorf("el motivo del rechazo es para el cliente: %v", *v)
	}
	if DetalleParaElCliente(nil) != nil {
		t.Error("nil")
	}
}

func TestHistorialConReciboYChequeRechazado(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	q := sqlc.New(pool)
	var cliente, pedido, recibo string
	if err := pool.QueryRow(ctx, `insert into customers (nombre) values ('Carpintero') returning id`).Scan(&cliente); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, customer_id, total, subtotal, medio_pago, estado_pago)
		values ('PED-1005', 'Carpintero', $1, 1000, 1000, 'transferencia', 'pagado') returning id`, cliente).Scan(&pedido); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `insert into receipts (numero, customer_id, recibido_de, total, order_id, origen)
		values ('REC-0017', $1, 'Carpintero', 1000, $2, 'panel') returning id`, cliente, pedido).Scan(&recibo); err != nil {
		t.Fatal(err)
	}
	// Un pago a cuenta con un cheque que después rebotó.
	var otroRecibo string
	if err := pool.QueryRow(ctx, `insert into receipts (numero, customer_id, recibido_de, total, origen) values ('REC-0006', $1, 'Carpintero', 400, 'panel') returning id`,
		cliente).Scan(&otroRecibo); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, referencia, receipt_id, created_at) values
		($1, 'pago', -400, 'REC-0006', $2, now() - interval '2 day'),
		($1, 'nota_debito', 400, '55500321', $2, now() - interval '1 day')`, cliente, otroRecibo); err != nil {
		t.Fatal(err)
	}

	movs, _, err := Historial(ctx, q, cliente, nil, "todo", 200)
	if err != nil {
		t.Fatal(err)
	}
	var compra, pago *MovimientoDelCliente
	for i := range movs {
		switch movs[i].Clase {
		case "compra_contado":
			compra = &movs[i]
		case "pago":
			pago = &movs[i]
		}
	}
	// H305: pagada después con recibo, no «en el momento», y con su recibo.
	if compra == nil || compra.Detalle == nil || *compra.Detalle != "Pagada con recibo" || compra.Recibo == nil || compra.Recibo.Numero != "REC-0017" {
		t.Errorf("compra: %+v", compra)
	}
	// H212: el número del pedido va una vez (en el enlace), no en el título.
	if compra != nil && compra.Titulo != "Compra" {
		t.Errorf("título: %q", compra.Titulo)
	}
	// H303: el pago del recibo cuyo cheque rebotó lo dice.
	if pago == nil || pago.Recibo == nil || !pago.Recibo.ChequeRechazado {
		t.Errorf("pago: %+v", pago)
	}
}
