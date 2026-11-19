package pagos

import "testing"

// Con token y sin el secreto del webhook, los avisos se descartarían (la
// firma nunca valida): no se abre ningún checkout, y lo que ya quedó
// pendiente se rescata con «Reconsultar», que solo necesita el token.
func TestMercadoPagoSinSecreto(t *testing.T) {
	c := Config{AccessToken: "APP_USR-123"}
	if p := c.Elegir(); p != nil {
		t.Fatalf("sin secreto eligió %s", p.Nombre())
	}
	if p := c.PorNombre("mercado_pago"); p == nil {
		t.Fatal("sin secreto no se puede reconsultar lo pendiente")
	}
	if e := c.EstadoMercadoPago(); e != MercadoPagoSinSecreto {
		t.Fatalf("estado %q", e)
	}
	c.WebhookSecret = "secreto"
	if p := c.Elegir(); p == nil || p.Nombre() != "mercado_pago" {
		t.Fatal("con token y secreto no eligió Mercado Pago")
	}
	if e := (Config{}).EstadoMercadoPago(); e != MercadoPagoApagado {
		t.Fatalf("sin nada: %q", e)
	}
}
