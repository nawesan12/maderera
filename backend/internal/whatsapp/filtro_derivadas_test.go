package whatsapp

import "testing"

// «Derivadas» es a donde lleva «conversación derivada sin asignar» del
// inicio (mes simulado, M3S2-020): «Sin asignar» abría también las que
// atiende el bot.
func TestFiltroDerivadas(t *testing.T) {
	e := armar(t, false)
	e.uno(t, `insert into whatsapp_conversaciones (wa_jid, bot_estado) values ('1@s', 'derivada') returning id::text`)
	e.uno(t, `insert into whatsapp_conversaciones (wa_jid, bot_estado) values ('2@s', 'activo') returning id::text`)
	todas, err := e.wa.ListarConversaciones(e.ctx, "sin-asignar", "")
	if err != nil {
		t.Fatal(err)
	}
	derivadas, err := e.wa.ListarConversaciones(e.ctx, "derivadas", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(todas) != 2 || len(derivadas) != 1 || derivadas[0].WaJid != "1@s" {
		t.Fatalf("sin asignar %d, derivadas %+v", len(todas), derivadas)
	}
	filtro := "derivadas"
	if normalizarFiltro(&filtro) != "derivadas" {
		t.Fatal("el filtro se pierde al leerlo")
	}
}
