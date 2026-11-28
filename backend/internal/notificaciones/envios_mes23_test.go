package notificaciones

import (
	"context"
	"strings"
	"testing"
)

// Los correos de un envío (mes simulado, M2S1-074, M2S2-113, M3S1-055): el
// listo no dice «para retirar» aunque el asunto configurado lo diga, el
// remito dice «de tu entrega», el que ya se firmó no se pide firmar, y el
// envío que vuelve a salir no repite «salió para la entrega».
func TestLosCorreosDeUnEnvio(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	e.uno(t, `insert into email_avisos (evento, asunto) values ('listo', 'Tu pedido está listo para retirar'),
		('remito_para_firmar', 'Firmá el remito de tu retiro') returning 'ok'`)
	envio := e.pedido(t, "PED-001035", "rocio@prueba.test", "envio")
	if err := e.s.CambioDeEstado(ctx, envio, "listo"); err != nil {
		t.Fatal(err)
	}
	if _, asunto, _, texto := e.ultimo(t); strings.Contains(asunto, "retirar") || !strings.Contains(texto, "sale para la entrega") {
		t.Errorf("listo de un envío: %q %q", asunto, texto)
	}
	retiro := e.pedido(t, "PED-001036", "juan@prueba.test", "retiro")
	if err := e.s.CambioDeEstado(ctx, retiro, "listo"); err != nil {
		t.Fatal(err)
	}
	if _, asunto, _, _ := e.ultimo(t); asunto != "Tu pedido está listo para retirar" {
		t.Errorf("el retiro sigue con el asunto configurado: %q", asunto)
	}

	remito := e.uno(t, `insert into deliveries (numero, order_id, estado, tipo, firma_token) values ('REM-0011', $1, 'preparada', 'envio', 'tok-1') returning id`, envio)
	if err := e.s.RemitoParaFirmar(ctx, remito); err != nil {
		t.Fatal(err)
	}
	if _, asunto, _, _ := e.ultimo(t); asunto != "Firmá el remito de tu entrega" {
		t.Errorf("firmar un envío: %q", asunto)
	}
	firmado := e.uno(t, `insert into deliveries (numero, order_id, estado, tipo, firma_token, firmado_at) values ('REM-0012', $1, 'entregada', 'retiro', 'tok-2', now()) returning id`, retiro)
	antes := e.correos()
	if err := e.s.RemitoParaFirmar(ctx, firmado); err != nil || e.correos() != antes {
		t.Errorf("el firmado no se pide firmar: %v, %d correos", err, e.correos()-antes)
	}

	if err := e.s.CambioDeEstado(ctx, envio, "en-camino"); err != nil {
		t.Fatal(err)
	}
	antes = e.correos()
	if err := e.s.CambioDeEstado(ctx, envio, "en-camino"); err != nil || e.correos() != antes {
		t.Errorf("salió para la entrega dos veces: %v", err)
	}
}

// El rechazo de una transferencia informada se avisa con el motivo y el
// enlace al pedido (M3S2-014).
func TestElRechazoSeAvisa(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	id := e.pedido(t, "PED-001233", "paula@prueba.test", "retiro")
	motivo := "El importe no coincide"
	if err := e.s.ResultadoDePago(ctx, CargaResultadoDePago{OrderID: &id, Tipo: "pedido", Detalle: "rechazado", Motivo: &motivo}); err != nil {
		t.Fatal(err)
	}
	para, asunto, html, _ := e.ultimo(t)
	if para != "paula@prueba.test" || !strings.Contains(asunto, "No pudimos acreditar tu pago") || !strings.Contains(html, motivo) ||
		!strings.Contains(html, "/pedido/PED-001233?t=") {
		t.Errorf("rechazo: %s %q", para, asunto)
	}
}

// El envío que vuelve a salir tampoco repite el WhatsApp de «salió para la
// entrega» (mes 23, M3S1-055: el correo ya lo cuidaba, el WhatsApp no).
func TestElEnvioQueVuelveASalirNoRepiteElWhatsapp(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	e.uno(t, `insert into whatsapp_avisos (evento, plantilla, idioma, texto_libre, activo) values ('en-camino', 'pedido_en_camino', 'es_AR', 'Hola {{nombre}}, tu pedido {{pedido}} salió.', true) returning 'ok'`)
	envio := e.pedido(t, "PED-001204", "sim.particular@prueba.test", "envio")
	e.uno(t, `update orders set contacto_telefono = '2236000000' where id = $1 returning 'ok'`, envio)
	for range 2 {
		if err := e.s.CambioDeEstado(ctx, envio, "en-camino"); err != nil {
			t.Fatal(err)
		}
	}
	if r := e.registro(t, "en-camino"); strings.Count(r, "whatsapp:") > 1 || strings.Count(r, "email:") != 1 {
		t.Errorf("salió dos veces: %s", r)
	}
}
