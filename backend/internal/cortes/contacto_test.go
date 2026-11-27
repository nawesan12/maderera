package cortes

import (
	"context"
	"testing"

	"mjbj/internal/pruebas"
)

// M2S3-024: la consulta que salió de una conversación trae el contacto al
// alta del corte: la ficha si está vinculada, o el nombre y el teléfono del
// chat.
func TestContactoDeLaConsulta(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	var conv, cliente string
	if err := pool.QueryRow(ctx, `insert into whatsapp_conversaciones (wa_jid, display_name) values ('5492235550312', 'Bruno') returning id`).Scan(&conv); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into consultas_corte (token, material, placa_largo_mm, placa_ancho_mm, piezas, ancho_sierra_mm, whatsapp_conversacion_id)
		values ('aaaaaaaaaaaaaaaa', 'Melamina', 2600, 1830, '[]', 4, $1), ('bbbbbbbbbbbbbbbb', 'Melamina', 2600, 1830, '[]', 4, null)`, conv); err != nil {
		t.Fatal(err)
	}
	c, err := s.ContactoDeLaConsulta(ctx, "aaaaaaaaaaaaaaaa")
	if err != nil || c.ClienteID != nil || c.Nombre == nil || *c.Nombre != "Bruno" || c.Telefono == nil || *c.Telefono != "223 555-0312" || c.Chat == nil {
		t.Fatalf("sin ficha: %+v %v", c, err)
	}
	if err := pool.QueryRow(ctx, `insert into customers (nombre, telefono) values ('Sim Bruno Arce', '223 555-0312') returning id`).Scan(&cliente); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `update whatsapp_conversaciones set customer_id = $1 where id = $2`, cliente, conv); err != nil {
		t.Fatal(err)
	}
	c, err = s.ContactoDeLaConsulta(ctx, "aaaaaaaaaaaaaaaa")
	if err != nil || c.ClienteID == nil || *c.ClienteID != cliente || *c.Nombre != "Sim Bruno Arce" {
		t.Fatalf("con ficha: %+v %v", c, err)
	}
	c, err = s.ContactoDeLaConsulta(ctx, "bbbbbbbbbbbbbbbb")
	if err != nil || c.Chat != nil || c.Nombre != nil {
		t.Fatalf("sin conversación: %+v %v", c, err)
	}
}
