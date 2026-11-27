package whatsapp

import "testing"

// El porqué de la derivación queda en la conversación y la bandeja lo
// muestra; al devolverla al bot se borra (mes 23, atención).
func TestBotGuardaElMotivoDeLaDerivacion(t *testing.T) {
	b := armarBot(t)
	jid := "5492235550301"
	b.texto(jid, "la placa que me vendieron vino rayada")
	_ = b.delBot(jid)
	if e := b.estado(jid); e != "derivada" {
		t.Fatalf("quedó %q", e)
	}
	var id string
	var motivo *string
	if err := b.pool.QueryRow(b.ctx, `select id, bot_motivo from whatsapp_conversaciones where wa_jid = $1`, jid).Scan(&id, &motivo); err != nil {
		t.Fatal(err)
	}
	if motivo == nil || *motivo != "Es un reclamo." {
		t.Errorf("motivo %v", motivo)
	}
	d, err := b.wa.ObtenerConversacion(b.ctx, id)
	if err != nil || d == nil || d.BotMotivo == nil || *d.BotMotivo != "Es un reclamo." {
		t.Errorf("la bandeja no trae el motivo: %v %v", d, err)
	}
	if err := b.wa.ReactivarBot(b.ctx, id); err != nil {
		t.Fatal(err)
	}
	_ = b.pool.QueryRow(b.ctx, `select bot_motivo from whatsapp_conversaciones where id = $1`, id).Scan(&motivo)
	if motivo != nil {
		t.Errorf("al devolverla al bot queda %q", *motivo)
	}
}
