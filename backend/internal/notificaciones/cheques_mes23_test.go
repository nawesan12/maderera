package notificaciones

import (
	"context"
	"strings"
	"testing"
)

// M2S3-088: el cheque de la cartera que se le devolvió al cliente no le
// llega como «No pudimos tomar tu cheque… Tu cuenta no cambió» cuando la
// nota de débito subió la deuda.
func TestElChequeDevueltoDiceQueVolvioALaCuenta(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	cliente := e.uno(t, `insert into customers (nombre, email) values ('Roberto Ferreyra', 'rf@prueba.test') returning id`)
	cheque := e.uno(t, `insert into cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado, customer_id, motivo_rechazo)
		values ('recibido', 'fisico', '00061001', 'Santander', now(), 300000, 'rechazado', $1, 'Lo pidió de vuelta') returning id`, cliente)
	for _, caso := range []struct {
		volvio bool
		dice   string
	}{{true, "volvió a tu cuenta corriente"}, {false, "Tu cuenta no cambió"}} {
		if err := e.s.ChequeDevuelto(ctx, cheque, caso.volvio); err != nil {
			t.Fatal(err)
		}
		para, asunto, html, _ := e.ultimo(t)
		if para != "rf@prueba.test" || asunto != "Te devolvimos un cheque · Cheque Santander N° 00061001" || !strings.Contains(html, caso.dice) ||
			strings.Contains(html, "No pudimos tomar") || strings.Contains(html, "Lo pidió de vuelta") {
			t.Errorf("volvió %v: %q %q", caso.volvio, asunto, html)
		}
		if caso.volvio && strings.Contains(html, "Tu cuenta no cambió") {
			t.Errorf("dice que la cuenta no cambió: %q", html)
		}
	}
}

// M2S1-053: la transferencia de la cuenta (sin pedido) que no se acreditó le
// llega al cliente con el motivo y el enlace a Movimientos.
func TestLaTransferenciaDeLaCuentaRechazadaSeAvisa(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	cliente := e.uno(t, `insert into customers (nombre, email) values ('Sim Constructora del Sur', 'sim@prueba.test') returning id`)
	pago := e.uno(t, `insert into payments (customer_id, tipo, proveedor, medio, monto, estado) values ($1, 'deuda', 'transferencia', 'transferencia', 300000, 'rechazado') returning id`, cliente)
	motivo, importe := "No llegó al banco", 300000.0
	if err := e.s.ResultadoDePago(ctx, CargaResultadoDePago{CustomerID: &cliente, PagoID: &pago, Tipo: "deuda", Detalle: "rechazado", Motivo: &motivo, Importe: &importe}); err != nil {
		t.Fatal(err)
	}
	para, asunto, html, _ := e.ultimo(t)
	if para != "sim@prueba.test" || asunto != "No pudimos acreditar tu transferencia" || !strings.Contains(html, motivo) ||
		!strings.Contains(html, "/mi-cuenta/movimientos") || !strings.Contains(html, "300.000") {
		t.Errorf("rechazo: %s %q", para, asunto)
	}
	if r := e.registro(t, "transferencia_rechazada"); r != "email:enviada" {
		t.Errorf("registro: %s", r)
	}
}
