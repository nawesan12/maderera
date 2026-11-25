package reportes

import (
	"encoding/json"
	"fmt"
	"testing"
)

// Las cobranzas del mes: todos los recibos, de cualquier origen, y los
// cobros en línea que no tienen recibo; el anulado se ve y no suma, el cobro
// en línea con recibo no se cuenta dos veces, y los totales por medio son
// del mes entero aunque la página traiga dos.
func TestCobranzasDelPeriodo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	cliente := e.id(t, `insert into customers (nombre) values ('Pérez') returning id`)
	cheque := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado) values ('recibido', '123456', 'Nación', now(), 500, 'cartera') returning id`)
	recibo := func(numero, origen, estado, cuando string, partes ...[3]any) string {
		id := e.id(t, `insert into receipts (numero, customer_id, recibido_de, total, estado, origen, created_at)
			values ($1, $2, 'Pérez', (select 0), $3, $4, $5) returning id`, numero, cliente, estado, origen, cuando)
		total := 0.0
		for i, p := range partes {
			e.exec(t, `insert into receipt_parts (receipt_id, medio, importe, cheque_id, orden) values ($1, $2, $3, $4, $5)`, id, p[0], p[1], p[2], i)
			total += p[1].(float64)
		}
		e.exec(t, `update receipts set total = $2 where id = $1`, id, total)
		return id
	}
	recibo("R-1", "panel", "emitido", "2026-10-10T15:00:00Z", [3]any{"efectivo", 300.0, nil}, [3]any{"cheque", 500.0, cheque})
	recibo("R-2", "mostrador", "anulado", "2026-10-11T15:00:00Z", [3]any{"transferencia", 100.0, nil})
	recibo("R-3", "panel", "emitido", "2026-09-30T15:00:00Z", [3]any{"efectivo", 999.0, nil})
	r4 := recibo("R-4", "mercado_pago", "emitido", "2026-10-12T15:00:00Z", [3]any{"mercado_pago", 90.0, nil})
	conRecibo := e.id(t, `insert into payments (customer_id, tipo, proveedor, medio, monto, estado, acreditado_at)
		values ($1, 'deuda', 'mercado_pago', 'visa', 90, 'aprobado', '2026-10-12T15:00:00Z') returning id`, cliente)
	e.exec(t, `update receipt_parts set payment_id = $1 where receipt_id = $2`, conRecibo, r4)
	e.exec(t, `insert into payments (tipo, proveedor, medio, monto, estado, acreditado_at) values
		('pedido', 'mercado_pago', 'visa', 200, 'aprobado', '2026-10-13T15:00:00Z'),
		('pedido', 'mercado_pago', 'visa', 777, 'rechazado', '2026-10-13T15:00:00Z')`)

	c, b, _ := pedir(t, adm, e.u+"cobranzas?periodo=mes&limite=2")
	var r Cobranzas
	if err := json.Unmarshal([]byte(b), &r); c != 200 || err != nil {
		t.Fatalf("%d %s", c, b)
	}
	if r.Total != 4 || r.Cobrado != 1090 || len(r.Filas) != 2 {
		t.Errorf("totales: %+v", r)
	}
	if fmt.Sprint(r.PorMedio) != "[{cheque 500 1} {efectivo 300 1} {mercado_pago 290 2}]" {
		t.Errorf("por medio: %+v", r.PorMedio)
	}
	if f := r.Filas[0]; f.Tipo != "en-linea" || f.Total != 200 || len(f.Partes) != 1 || f.Partes[0].Medio != "mercado_pago" {
		t.Errorf("lo último primero, el cobro en línea: %+v", f)
	}
	_, b, _ = pedir(t, adm, e.u+"cobranzas?periodo=mes&limite=2&desplazamiento=2")
	_ = json.Unmarshal([]byte(b), &r)
	if len(r.Filas) != 2 || *r.Filas[0].Numero != "R-2" || !r.Filas[0].Anulado || *r.Filas[1].Numero != "R-1" ||
		len(r.Filas[1].Partes) != 2 || r.Filas[1].Partes[1].ChequeID == nil || *r.Filas[1].Partes[1].ChequeID != cheque {
		t.Errorf("segunda página: %s", b)
	}
	if c, _, _ := pedir(t, ven, e.u+"cobranzas"); c != 403 {
		t.Errorf("el vendedor no ve las cobranzas: %d", c)
	}
}
