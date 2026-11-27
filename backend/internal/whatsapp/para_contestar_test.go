package whatsapp

import "testing"

// Mes 23: el cliente escribe en una charla donde alguien contestó desde el
// panel hace poco; el bot calla (botPuedeHablar) y la bandeja lo marca «Para
// contestar». La que atiende el bot o ya tiene respuesta, no.
func TestParaContestar(t *testing.T) {
	e := armar(t, false)
	panel := e.uno(t, `insert into whatsapp_conversaciones (wa_jid, bot_estado, ultimo_entrante_at, ultimo_mensaje_at)
		values ('1@s', 'activo', now(), now()) returning id::text`)
	e.uno(t, `insert into whatsapp_mensajes (conversacion_id, direccion, origen, ocurrido_at) values ($1, 'saliente', 'panel', now() - interval '30 minutes') returning id::text`, panel)
	e.uno(t, `insert into whatsapp_conversaciones (wa_jid, bot_estado, ultimo_entrante_at, ultimo_mensaje_at)
		values ('2@s', 'activo', now(), now()) returning id::text`)
	e.uno(t, `insert into whatsapp_conversaciones (wa_jid, bot_estado, ultimo_entrante_at, ultimo_mensaje_at)
		values ('3@s', 'derivada', now() - interval '1 hour', now()) returning id::text`)
	e.uno(t, `insert into whatsapp_conversaciones (wa_jid, bot_estado, ultimo_entrante_at, ultimo_mensaje_at)
		values ('4@s', 'derivada', now(), now()) returning id::text`)
	cs, err := e.wa.ListarConversaciones(e.ctx, "todas", "")
	if err != nil {
		t.Fatal(err)
	}
	quiere := map[string]bool{"1@s": true, "2@s": false, "3@s": false, "4@s": true}
	for _, c := range cs {
		if c.ParaContestar != quiere[c.WaJid] {
			t.Errorf("%s: %v", c.WaJid, c.ParaContestar)
		}
	}
	if len(cs) != 4 {
		t.Fatalf("%d conversaciones", len(cs))
	}
}
