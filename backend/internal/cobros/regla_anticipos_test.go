package cobros

import (
	"testing"
	"time"
)

// Lo que la regla manda a Anticipos (H374, H407): el B libre pasa a
// Anticipos y los cheques del circuito B se quedan en el B.
func TestExcedenteAAnticipos(t *testing.T) {
	if r := ExcedenteAAnticipos(Reparto{Deudores: 100, Anticipo: 50, B: 30}, 10); r != (Reparto{Deudores: 100, Anticipo: 70, B: 10}) {
		t.Errorf("%+v", r)
	}
	if r := ExcedenteAAnticipos(Reparto{Deudores: 100, B: 10}, 10); r != (Reparto{Deudores: 100, B: 10}) {
		t.Errorf("solo cheques del B: %+v", r)
	}
}

// Sin pedido, lo que sobró de la seña es un saldo a favor que se aplica a
// cualquier factura; la seña sigue atada a lo que esperaba. Con pedido, el
// anticipo espera la factura de ese pedido y no otra.
func TestBolsasDeLaRegla(t *testing.T) {
	d := func(dia int) time.Time { return time.Date(2026, 10, dia, 12, 0, 0, 0, time.UTC) }
	saldo := RepartirCobros([]EventoDeCuenta{
		{Clave: "c:1", Fecha: d(1), Tipo: EventoRecibo, ID: "r1", Monto: 768, Pendiente: true, Destinos: []string{"i:f1"}, PorFacturar: 755,
			Guardado: &Reparto{Anticipo: 768}, Pedido: "*"},
		{Clave: "c:1", Fecha: d(2), Tipo: EventoFactura, ID: "f2", Monto: 13},
	})
	if len(saldo.Aplicaciones) != 1 || saldo.Aplicaciones[0].Importe != 13 || saldo.Anticipos["c:1"] != 755 {
		t.Errorf("el saldo a favor va a otra factura: %+v %v", saldo.Aplicaciones, saldo.Anticipos)
	}
	pedido := RepartirCobros([]EventoDeCuenta{
		{Clave: "c:1", Fecha: d(1), Tipo: EventoRecibo, ID: "r1", Monto: 500, Guardado: &Reparto{Anticipo: 500}, Pedido: "p1"},
		{Clave: "c:1", Fecha: d(2), Tipo: EventoFactura, ID: "f9", Monto: 500, Pedido: "p9"},
		{Clave: "c:1", Fecha: d(3), Tipo: EventoFactura, ID: "f1", Monto: 500, Pedido: "p1"},
	})
	if len(pedido.Aplicaciones) != 1 || pedido.Aplicaciones[0].Evento.ID != "f1" || !pedido.PorRegla["r1"] {
		t.Errorf("el anticipo del pedido va a su factura: %+v", pedido.Aplicaciones)
	}
}
