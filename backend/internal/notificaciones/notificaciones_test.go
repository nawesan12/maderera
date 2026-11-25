package notificaciones

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/avisos"
	"mjbj/internal/cobros"
	"mjbj/internal/email"
	"mjbj/internal/facturacion"
	"mjbj/internal/pruebas"
	"mjbj/internal/whatsapp"
)

type buzon struct {
	mu        sync.Mutex
	recibidos []email.Mensaje
}

func (b *buzon) Nombre() string { return "prueba" }
func (b *buzon) Real() bool     { return true }
func (b *buzon) Enviar(_ context.Context, m email.Mensaje) email.Resultado {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.recibidos = append(b.recibidos, m)
	return email.Resultado{Enviado: true, ID: "x"}
}

func TestAvisosDeRecibosYCheques(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	silencio := slog.New(slog.NewTextHandler(io.Discard, nil))
	b := &buzon{}
	s := Nuevo(pool, "https://mjbj.com.ar/", avisos.Nuevo(pool, b, "MJBJ <avisos@mjbj.com.ar>", silencio),
		whatsapp.Nuevo(pool, whatsapp.Config{}, nil, silencio), facturacion.Nuevo(pool, silencio), silencio)

	var cliente string
	_ = pool.QueryRow(ctx, `insert into customers (nombre, email, telefono) values ('Juan Pérez', 'juan@prueba.test', '2235550000') returning id`).Scan(&cliente)
	_, _ = pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto) values ($1, 'compra', 300000)`, cliente)
	var r cobros.ReciboEmitido
	if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		var err error
		r, err = cobros.EmitirRecibo(ctx, tx, cobros.Cobro{CustomerID: &cliente, Origen: "panel", Partes: []cobros.Parte{
			{Medio: "transferencia", Importe: 100000},
			{Medio: "cheque", Importe: 50000, Cheque: &cobros.ChequeNuevo{Numero: "00123456", Banco: "Nación", FechaPago: time.Now()}},
		}})
		return err
	}); err != nil {
		t.Fatal(err)
	}

	if err := s.Recibo(ctx, r.ReceiptID); err != nil {
		t.Fatal(err)
	}
	if len(b.recibidos) != 1 {
		t.Fatalf("correos: %d", len(b.recibidos))
	}
	m := b.recibidos[0]
	if m.Para != "juan@prueba.test" || m.Asunto != "Recibo REC-0001 · $\u00a0150.000" || len(m.Adjuntos) != 1 ||
		m.Adjuntos[0].Nombre != "recibo-REC-0001.pdf" || !strings.HasPrefix(string(m.Adjuntos[0].Contenido), "%PDF") ||
		!strings.Contains(m.HTML, "Transferencia, Cheque") || !strings.Contains(m.HTML, "$\u00a0150.000") {
		t.Errorf("correo del recibo: %+v", m.Asunto)
	}
	var estados string
	_ = pool.QueryRow(ctx, `select string_agg(canal::text || ':' || evento || ':' || estado::text, ',' order by canal) from notifications_log`).Scan(&estados)
	if !strings.Contains(estados, "email:recibo_emitido:enviada") {
		t.Errorf("registro de avisos: %s", estados)
	}

	var cheque string
	_ = pool.QueryRow(ctx, `select id from cheques`).Scan(&cheque)
	_, _ = pool.Exec(ctx, `update cheques set motivo_rechazo = 'Sin fondos' where id = $1`, cheque)
	if err := s.ChequeRechazado(ctx, cheque, true); err != nil {
		t.Fatal(err)
	}
	if len(b.recibidos) != 2 || b.recibidos[1].Asunto != "Cheque rechazado · Cheque Nación N° 00123456" || !strings.Contains(b.recibidos[1].HTML, "Sin fondos") {
		t.Errorf("correo del cheque: %+v", b.recibidos[len(b.recibidos)-1].Asunto)
	}

	// Un recibo anulado no avisa; uno que no existe tampoco, y no falla.
	_ = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		_, _, err := cobros.AnularRecibo(ctx, tx, r.ReceiptID, "prueba", nil)
		return err
	})
	if err := s.Recibo(ctx, r.ReceiptID); err != nil || len(b.recibidos) != 2 {
		t.Errorf("recibo anulado: %v, %d correos", err, len(b.recibidos))
	}
	if err := s.Recibo(ctx, "00000000-0000-0000-0000-000000000000"); err != nil {
		t.Errorf("recibo que no existe: %v", err)
	}
}
