package whatsapp

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"mjbj/internal/pruebas"
)

// Mes simulado: el chat ponía «Profesional» a una constructora con la
// «Lista constructora». El detalle trae la lista propia (null si es la
// general) para que el chip diga la de su lista, como el portal.
func TestDetalleTraeLaListaDelCliente(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, Config{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	uno := func(q string, args ...any) string {
		var id string
		if err := pool.QueryRow(ctx, q, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	general := uno(`insert into price_lists (slug, name, is_default) values ('general-wa', 'General', true) returning id`)
	propia := uno(`insert into price_lists (slug, name) values ('constructora-wa', 'Lista constructora') returning id`)
	conLista := uno(`insert into customers (nombre, tipo, price_list_id) values ('Corralón', 'profesional', $1) returning id`, propia)
	conGeneral := uno(`insert into customers (nombre, price_list_id) values ('Ana', $1) returning id`, general)
	for cliente, quiero := range map[string]string{conLista: "Lista constructora", conGeneral: ""} {
		conv := uno(`insert into whatsapp_conversaciones (wa_jid, customer_id) values ($1, $2) returning id`, "549223"+cliente[:6], cliente)
		d, err := s.ObtenerConversacion(ctx, conv)
		if err != nil || d == nil {
			t.Fatal(err)
		}
		got := ""
		if d.ClienteLista != nil {
			got = *d.ClienteLista
		}
		if got != quiero {
			t.Errorf("lista %q, quería %q", got, quiero)
		}
	}
}
