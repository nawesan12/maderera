package whatsapp

import (
	"strings"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/sqlc"
)

// Mes simulado (H038, H183, H189, H190, H291).
//
//   - «PDF por la API» del presupuesto, a un número que nunca escribió, no
//     salía: la plantilla «presupuesto_enviado» pedía número, total y
//     vencimiento y el sistema no los completaba. Y el intento dejaba una
//     conversación vacía en la bandeja.
//   - Mandado por WhatsApp, el presupuesto seguía «pendiente».
//   - «Documento» ofrecía los presupuestos rechazados.
//   - Sin ?chat=, la bandeja abría sola la conversación más reciente.
func TestElPresupuestoPorWhatsapp(t *testing.T) {
	e := armar(t, false)
	admin := sqlc.StaffRoleAdmin
	ses := &auth.Sesion{UserID: "u", Rol: sqlc.UserRoleStaff, RolStaff: &admin}
	_ = e.uno(t, `insert into "user" (id, name, email, email_verified, created_at, updated_at)
		values ('u', 'Vera', 'vera@prueba.test', true, now(), now()) returning id`)
	cliente := e.uno(t, `insert into customers (nombre, telefono) values ('Sim Lucía', '223 555-0201') returning id::text`)
	quote := e.uno(t, `insert into quotes (numero, contacto_nombre, customer_id, estado, subtotal, total, valido_hasta)
		values ('P-2026-0001', 'Sim Lucía', $1, 'pendiente', 300000, 300000, now() + interval '15 days') returning id::text`, cliente)
	_ = e.uno(t, `insert into quotes (numero, contacto_nombre, customer_id, estado, subtotal, total)
		values ('P-2026-0002', 'Sim Lucía', $1, 'rechazado', 10, 10) returning id::text`, cliente)

	doc := &DocumentoAlCliente{PDF: PDF{Contenido: []byte("%PDF-1.4 prueba"), Nombre: "P-2026-0001.pdf", Descripcion: "el presupuesto P-2026-0001"},
		CustomerID: &cliente}
	r, err := e.wa.EnviarDocumentoAlCliente(e.ctx, ses, "presupuesto", quote, "", nil, doc, false)
	if err != nil || r.Error != "" {
		t.Fatalf("el presupuesto no salió: %v %+v", err, r)
	}
	if got := e.uno(t, `select cuerpo from whatsapp_mensajes where direccion = 'saliente'`); got == "" ||
		!contieneTodo(got, "P-2026-0001", "300.000") {
		t.Errorf("el mensaje no lleva los datos del presupuesto: %q", got)
	}
	if got := e.uno(t, `select estado::text from quotes where id = $1`, quote); got != "enviado" {
		t.Errorf("mandado por WhatsApp quedó %s", got)
	}

	// Uno que no sale (sin validez, la plantilla queda incompleta) no deja
	// una conversación vacía con un número nuevo.
	sinValidez := e.uno(t, `insert into quotes (numero, contacto_nombre, estado, subtotal, total)
		values ('P-2026-0003', 'Otro', 'pendiente', 10, 10) returning id::text`)
	antes := e.uno(t, `select count(*)::text from whatsapp_conversaciones`)
	otro := &DocumentoAlCliente{PDF: PDF{Contenido: []byte("%PDF-1.4"), Nombre: "P-2026-0003.pdf", Descripcion: "el presupuesto P-2026-0003"}}
	if r, _ := e.wa.EnviarDocumentoAlCliente(e.ctx, ses, "presupuesto", sinValidez, "223 555-0999", nil, otro, false); r.Error == "" {
		t.Fatal("tendría que fallar")
	}
	if got := e.uno(t, `select count(*)::text from whatsapp_conversaciones`); got != antes {
		t.Errorf("quedó una conversación vacía: %s → %s", antes, got)
	}

	// Avisado desde el teléfono, también queda enviado.
	porTelefono := e.uno(t, `insert into quotes (numero, contacto_nombre, estado, subtotal, total)
		values ('P-2026-0004', 'Otro', 'pendiente', 10, 10) returning id::text`)
	if r, err := e.wa.RegistrarAvisoManual(e.ctx, ses, "presupuesto_listo", "quote", porTelefono, nil); err != nil || r.Error != "" {
		t.Fatalf("aviso manual: %v %+v", err, r)
	}
	if got := e.uno(t, `select estado::text from quotes where id = $1`, porTelefono); got != "enviado" {
		t.Errorf("avisado desde el teléfono quedó %s", got)
	}

	docs, err := e.wa.DocumentosDelCliente(e.ctx, cliente)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range docs {
		if d.Titulo == "Presupuesto P-2026-0002" {
			t.Error("ofrece el presupuesto rechazado")
		}
	}

	b, err := e.wa.AbrirBandeja(e.ctx, ses, "todas", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Conversaciones) == 0 || b.Detalle != nil {
		t.Errorf("sin ?chat= abrió una conversación sola: %d conversaciones, detalle %v", len(b.Conversaciones), b.Detalle != nil)
	}
}

func contieneTodo(s string, partes ...string) bool {
	for _, p := range partes {
		if !strings.Contains(s, p) {
			return false
		}
	}
	return true
}
