package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Lo que muestra /admin/whatsapp/configuracion: si está bien conectado, qué
// se avisa solo, qué textos aprueba Meta, cuánto se gasta y quién pidió no
// recibir nada.

// DiagnosticoGuardado es el último chequeo, para no repetirlo en cada visita.
type DiagnosticoGuardado struct {
	Diagnostico     json.RawMessage `json:"diagnostico"`
	DiagnosticoAt   *time.Time      `json:"diagnosticoAt"`
	Calidad         *string         `json:"calidad"`
	Limite          *string         `json:"limite"`
	UltimoWebhookAt *time.Time      `json:"ultimoWebhookAt"`
}

// Baja es un número que pidió no recibir avisos.
type Baja struct {
	ID          string     `json:"id"`
	WaJid       string     `json:"waJid"`
	Nombre      string     `json:"nombre"`
	BajaAt      *time.Time `json:"bajaAt"`
	BajaDetalle *string    `json:"bajaDetalle"`
}

// AvisoCortado es un aviso automático que este mes no salió por el tope.
type AvisoCortado struct {
	ID           string    `json:"id"`
	Evento       string    `json:"evento"`
	Destinatario string    `json:"destinatario"`
	Asunto       *string   `json:"asunto"`
	Fecha        time.Time `json:"fecha"`
	Correo       string    `json:"correo"`
	AvisadoAMano bool      `json:"avisadoAMano"`
	Enlace       *string   `json:"enlace"`
}

// Configuracion es todo junto.
type Configuracion struct {
	Estado         EstadoBandeja        `json:"estado"`
	Avisos         []AvisoGuardado      `json:"avisos"`
	Eventos        []EventoAviso        `json:"eventos"`
	Guardadas      []PlantillaGuardada  `json:"guardadas"`
	Diagnostico    *DiagnosticoGuardado `json:"diagnostico"`
	Gasto          GastoDelMes          `json:"gasto"`
	Bajas          []Baja               `json:"bajas"`
	Cortados       []AvisoCortado       `json:"cortados"`
	WebhookSecreto bool                 `json:"webhookSecreto"`
	FirmaSecreto   bool                 `json:"firmaSecreto"`
}

// LeerConfiguracion arma la pantalla. La primera vez deja los avisos
// creados y apagados.
func (s *Servicio) LeerConfiguracion(ctx context.Context) (*Configuracion, error) {
	if err := s.SembrarAvisos(ctx); err != nil {
		return nil, err
	}
	c := &Configuracion{Eventos: EventosWhatsapp, WebhookSecreto: s.cfg.WebhookSecret != "", FirmaSecreto: s.cfg.AppSecret != ""}
	var err error
	if c.Estado, err = s.EstadoWhatsapp(ctx); err != nil {
		return nil, err
	}
	if c.Avisos, err = s.ListarAvisos(ctx); err != nil {
		return nil, err
	}
	if c.Guardadas, err = s.PlantillasGuardadas(ctx); err != nil {
		return nil, err
	}
	var d DiagnosticoGuardado
	err = s.pool.QueryRow(ctx, `select diagnostico, diagnostico_at, calidad, limite_mensajes, ultimo_webhook_at from whatsapp_sesion limit 1`).
		Scan(&d.Diagnostico, &d.DiagnosticoAt, &d.Calidad, &d.Limite, &d.UltimoWebhookAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return nil, err
	default:
		if len(d.Diagnostico) == 0 {
			d.Diagnostico = json.RawMessage("null")
		}
		c.Diagnostico = &d
	}
	if c.Gasto, err = s.GastoDelMes(ctx, s.ahora()); err != nil {
		return nil, err
	}
	if c.Bajas, err = s.bajasRegistradas(ctx); err != nil {
		return nil, err
	}
	if c.Cortados, err = s.avisosCortadosPorTope(ctx); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Servicio) bajasRegistradas(ctx context.Context) ([]Baja, error) {
	r, err := s.pool.Query(ctx, `select c.id, c.wa_jid, coalesce(cu.nombre, c.display_name, 'Sin identificar'), c.baja_at, c.baja_detalle
		from whatsapp_conversaciones c left join customers cu on cu.id = c.customer_id
		where c.baja_at is not null order by c.baja_at desc`)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out := []Baja{}
	for r.Next() {
		var b Baja
		if err := r.Scan(&b.ID, &b.WaJid, &b.Nombre, &b.BajaAt, &b.BajaDetalle); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, r.Err()
}

// avisosCortadosPorTope son los automáticos de este mes que no salieron por
// el tope, con lo que hace falta para avisar a mano.
func (s *Servicio) avisosCortadosPorTope(ctx context.Context) ([]AvisoCortado, error) {
	r, err := s.pool.Query(ctx, `
		select n.id, n.evento, n.destinatario, n.asunto, n.entidad_tipo, n.entidad_id::text, n.created_at,
			(select e.estado::text from notifications_log e
			  where e.canal = 'email' and e.evento = n.evento and e.entidad_id = n.entidad_id order by e.created_at desc limit 1),
			exists(select 1 from notifications_log m
			  where m.canal = 'whatsapp_manual' and m.evento = n.evento and m.entidad_id = n.entidad_id),
			(select r.customer_id::text from receipts r where n.entidad_tipo = 'receipt' and r.id = n.entidad_id)
		from notifications_log n
		where n.canal = 'whatsapp' and n.estado = 'omitida' and n.error = $1 and n.created_at >= $2
		order by n.created_at desc limit 100`, MotivoTope, InicioDelMesArgentino(s.ahora()))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out := []AvisoCortado{}
	for r.Next() {
		var a AvisoCortado
		var tipo, entidad, correo, clienteDeRecibo *string
		if err := r.Scan(&a.ID, &a.Evento, &a.Destinatario, &a.Asunto, &tipo, &entidad, &a.Fecha, &correo, &a.AvisadoAMano, &clienteDeRecibo); err != nil {
			return nil, err
		}
		switch e := oTexto(correo, ""); {
		case e == "enviada" || e == "simulada":
			a.Correo = "salio"
		case e != "":
			a.Correo = "fallo"
		default:
			a.Correo = "sin-correo"
		}
		if entidad != nil {
			switch oTexto(tipo, "") {
			case "order":
				a.Enlace = ptr("/admin/pedidos/" + *entidad)
			case "quote":
				a.Enlace = ptr("/admin/presupuestos/" + *entidad)
			case "cheque":
				a.Enlace = ptr("/admin/cheques")
			case "receipt":
				if clienteDeRecibo != nil {
					a.Enlace = ptr("/admin/clientes/" + *clienteDeRecibo)
				}
			}
		}
		out = append(out, a)
	}
	return out, r.Err()
}
