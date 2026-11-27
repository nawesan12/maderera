package cobros

import (
	"context"
	"testing"
	"time"

	"mjbj/internal/sqlc"
)

// Lo que encontró el mes simulado en Movimientos (tanda 23).

// M2S1-153: el cliente no lee el motivo interno de la anulación de un
// recibo, y el pago anulado y su ajuste se compensan en un renglón.
func TestElReciboAnuladoEnUnRenglon(t *testing.T) {
	motivo := "Anulación del recibo REC-0006: Sim: se cargó por error"
	if v := DetalleParaElCliente(&motivo); v == nil || *v != "Anulación del recibo REC-0006" {
		t.Fatalf("el motivo interno: %v", v)
	}
	pago, ajuste, otro := -1000.0, 1000.0, -500.0
	detallePago := "Transferencia"
	movs := HistorialParaElCliente([]MovimientoDelCliente{
		{ID: "a", Clase: "ajuste", Titulo: "Ajuste", Detalle: &motivo, Importe: &ajuste},
		{ID: "b", Clase: "pago", Titulo: "Pago a cuenta", Detalle: &detallePago, Importe: &pago,
			Recibo: &RefRecibo{ID: "r6", Numero: "REC-0006", Anulado: true}},
		{ID: "c", Clase: "pago", Titulo: "Pago a cuenta", Importe: &otro, Recibo: &RefRecibo{ID: "r7", Numero: "REC-0007"}},
	})
	if len(movs) != 2 {
		t.Fatalf("el ajuste de la anulación sigue aparte: %+v", movs)
	}
	if m := movs[0]; m.ID != "b" || m.Titulo != "Recibo REC-0006 anulado" || m.Importe != nil || m.Detalle != nil {
		t.Errorf("el anulado: %+v", m)
	}
	if m := movs[1]; m.ID != "c" || m.Importe == nil || *m.Importe != -500 {
		t.Errorf("el pago vivo no se toca: %+v", m)
	}
}

// M2S3-030: la devolución de lo que se pagó de contado (el reintegro no pasa
// por la cuenta) aparece en Movimientos, también con «Notas y ajustes»; el
// cheque informado que no se tomó no dice «rechazado» (M3S2-052).
func TestLaDevolucionDeContadoEnMovimientos(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	var pedido, nota string
	if err := b.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, estado_pago, total, customer_id)
		values ('PED-1069', 'Mueblería', $1, 'mostrador', 'entregado', 'pagado', 772000, $2) returning id`, b.sucursal, b.cliente).Scan(&pedido); err != nil {
		t.Fatal(err)
	}
	if err := b.pool.QueryRow(ctx, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, order_id)
		values ('nota_credito_a', 15, 2, 'Mueblería', 79752.07, 16747.93, 0, 0, 0, 96500, 'emitida', now(), $1) returning id`, pedido).Scan(&nota); err != nil {
		t.Fatal(err)
	}
	if _, err := b.pool.Exec(ctx, `insert into devoluciones (clave, order_id, nota_id, importe, destino, motivo) values ('m2s3-030', $1, $2, 96500, 'caja', 'cambio')`, pedido, nota); err != nil {
		t.Fatal(err)
	}
	if _, err := b.pool.Exec(ctx, `insert into cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado, customer_id)
		values ('recibido', 'fisico', '99001001', 'Banco Sim', now() + interval '200 days', 1000, 'rechazado', $1)`, b.cliente); err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(b.pool)
	for _, filtro := range []string{"todo", "ajustes"} {
		movs, _, err := Historial(ctx, q, b.cliente, nil, filtro, 0)
		if err != nil {
			t.Fatal(err)
		}
		var dev *MovimientoDelCliente
		for i := range movs {
			if movs[i].Titulo == "Devolución" {
				dev = &movs[i]
			}
		}
		if dev == nil || dev.Clase != "nota_credito" || dev.Importe != nil || dev.ImporteInformativo == nil || *dev.ImporteInformativo != -96500 ||
			dev.Detalle == nil || *dev.Detalle != "Nota de crédito A 0015-00000002" || dev.Pedido == nil || dev.Pedido.Numero != "PED-1069" {
			t.Fatalf("%s: la devolución de contado: %+v", filtro, movs)
		}
	}
	movs, _, err := Historial(ctx, q, b.cliente, nil, "cheques", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(movs) != 1 || movs[0].Clase != "cheque_no_tomado" {
		t.Fatalf("el cheque que no se tomó: %+v", movs)
	}
}

// M3S1-044: las fechas de los cheques con ceros, todas iguales.
func TestFechaCortaConCeros(t *testing.T) {
	if f := fechaCorta(time.Date(2027, 1, 15, 15, 0, 0, 0, time.UTC)); f != "15/01/2027" {
		t.Errorf("fecha: %s", f)
	}
}
