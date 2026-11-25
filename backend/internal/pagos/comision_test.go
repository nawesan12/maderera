package pagos

import (
	"context"
	"testing"
)

// Lo que Mercado Pago se queda de cada cobro: el neto acreditado de
// transaction_details, o los cargos que paga el vendedor si no viene.
func TestComisionDeMercadoPago(t *testing.T) {
	casos := []struct {
		nombre         string
		json           string
		comision, neto float64
		sinDato        bool
	}{
		{"el neto manda", `{"id": 1, "status": "approved", "transaction_amount": 1000,
			"transaction_details": {"net_received_amount": 940, "total_paid_amount": 1000},
			"fee_details": [{"type": "mercadopago_fee", "amount": 55, "fee_payer": "collector"}]}`, 60, 940, false},
		{"sin neto, los cargos del vendedor", `{"id": 1, "status": "approved", "transaction_amount": 1000,
			"fee_details": [{"type": "mercadopago_fee", "amount": 49.99, "fee_payer": "collector"},
			                {"type": "financing_fee", "amount": 120, "fee_payer": "payer"},
			                {"type": "application_fee", "amount": "10.01", "fee_payer": "collector"}]}`, 60, 940, false},
		{"sin comisión", `{"id": 1, "status": "approved", "transaction_amount": 1000,
			"transaction_details": {"net_received_amount": 1000}}`, 0, 1000, false},
		{"sin dato", `{"id": 1, "status": "approved", "transaction_amount": 1000}`, 0, 0, true},
		{"un neto que no tiene sentido", `{"id": 1, "status": "approved", "transaction_amount": 1000,
			"transaction_details": {"net_received_amount": 1500}}`, 0, 0, true},
		// Comité del 25/11: un neto en 0 era una comisión del 100 % y Banco
		// en cero.
		{"un neto en cero", `{"id": 1, "status": "approved", "transaction_amount": 1000,
			"transaction_details": {"net_received_amount": 0}}`, 0, 0, true},
		{"un neto en cero con cargos: valen los cargos", `{"id": 1, "status": "approved", "transaction_amount": 1000,
			"transaction_details": {"net_received_amount": 0},
			"fee_details": [{"amount": 60, "fee_payer": "collector"}]}`, 60, 940, false},
		{"una comisión de más de la mitad", `{"id": 1, "status": "approved", "transaction_amount": 1000,
			"transaction_details": {"net_received_amount": 300}}`, 0, 0, true},
		{"cuotas que absorbe el vendedor", `{"id": 1, "status": "approved", "transaction_amount": 1000,
			"transaction_details": {"net_received_amount": 680}}`, 320, 680, false},
		{"cargos de más de la mitad", `{"id": 1, "status": "approved", "transaction_amount": 1000,
			"fee_details": [{"amount": 600, "fee_payer": "collector"}]}`, 0, 0, true},
		{"cargos mayores al pago", `{"id": 1, "status": "approved", "transaction_amount": 10,
			"fee_details": [{"amount": 11, "fee_payer": "collector"}]}`, 0, 0, true},
	}
	for _, c := range casos {
		r := PagoDeMercadoPago([]byte(c.json))
		if c.sinDato {
			if r.Comision != nil || r.Neto != nil {
				t.Errorf("%s: %v %v", c.nombre, *r.Comision, *r.Neto)
			}
			continue
		}
		if r.Comision == nil || r.Neto == nil || *r.Comision != c.comision || *r.Neto != c.neto {
			t.Errorf("%s: %+v", c.nombre, r)
		}
	}
}

// El aviso que acredita el pago deja la comisión en payments; uno posterior
// sin el dato no la borra.
func TestAcreditarGuardaLaComision(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre, tipo) values ('Carpintería Este', 'particular') returning id`)
	pago := e.id(t, `insert into payments (customer_id, tipo, proveedor, monto, estado) values ($1, 'deuda', 'mercado_pago', 1000, 'iniciado') returning id`, cliente)
	r := PagoDeMercadoPago([]byte(`{"id": 901, "status": "approved", "transaction_amount": 1000,
		"transaction_details": {"net_received_amount": 940}}`))
	if _, err := e.s.Acreditar(ctx, pago, r); err != nil {
		t.Fatal(err)
	}
	if c := e.texto(t, `select comision::text || ' ' || neto_acreditado::text from payments where id = $1`, pago); c != "60.00 940.00" {
		t.Errorf("comisión y neto: %s", c)
	}
	monto := 1000.0
	if _, err := e.s.Acreditar(ctx, pago, &PagoRemoto{ID: "901", Estado: Aprobado, Monto: &monto, Crudo: []byte(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if c := e.texto(t, `select comision::text from payments where id = $1`, pago); c != "60.00" {
		t.Errorf("otro aviso sin el dato: %s", c)
	}
}
