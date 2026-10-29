package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// La lectura de la bandeja (lib/dal/admin/whatsapp.ts): conversaciones de
// todos los clientes juntas, con su saldo al costado. Quien llama ya exigió
// el rol de la bandeja.

// Filtros de la bandeja.
var Filtros = []string{"todas", "sin-leer", "mias", "sin-asignar", "resueltas"}

// ConversacionListada es una fila de la lista.
type ConversacionListada struct {
	ID                   string     `json:"id"`
	WaJid                string     `json:"waJid"`
	Nombre               string     `json:"nombre"`
	DisplayName          *string    `json:"displayName"`
	CustomerID           *string    `json:"customerId"`
	ClienteNombre        *string    `json:"clienteNombre"`
	ClienteTipo          *string    `json:"clienteTipo"`
	Estado               string     `json:"estado"`
	UltimoMensajeAt      *time.Time `json:"ultimoMensajeAt"`
	UltimoMensajePreview *string    `json:"ultimoMensajePreview"`
	UltimoEntranteAt     *time.Time `json:"ultimoEntranteAt"`
	NoLeidos             int32      `json:"noLeidos"`
	VentanaAbierta       bool       `json:"ventanaAbierta"`
	AsignadoAUserID      *string    `json:"asignadoAUserId"`
	AsignadoNombre       *string    `json:"asignadoNombre"`
	Baja                 bool       `json:"baja"`
}

// ListarConversaciones son las 150 más recientes del filtro.
func (s *Servicio) ListarConversaciones(ctx context.Context, filtro, usuarioID string) ([]ConversacionListada, error) {
	cond := `c.estado = 'abierta'`
	args := []any{}
	switch filtro {
	case "resueltas":
		cond = `c.estado = 'cerrada'`
	case "sin-leer":
		cond += ` and c.no_leidos > 0`
	case "mias":
		cond += ` and c.asignado_a_user_id = $1`
		args = append(args, usuarioID)
	case "sin-asignar":
		cond += ` and c.asignado_a_user_id is null`
	}
	r, err := s.pool.Query(ctx, `
		select c.id, c.wa_jid, c.display_name, c.customer_id, cu.nombre, cu.tipo::text, c.estado::text, c.ultimo_mensaje_at,
		       c.ultimo_mensaje_preview, c.ultimo_entrante_at, c.no_leidos, c.asignado_a_user_id, u.name, c.baja_at is not null
		  from whatsapp_conversaciones c
		  left join customers cu on cu.id = c.customer_id
		  left join "user" u on u.id = c.asignado_a_user_id
		 where `+cond+`
		 order by c.ultimo_mensaje_at desc nulls last
		 limit 150`, args...)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	ahora := s.ahora()
	out := []ConversacionListada{}
	for r.Next() {
		var c ConversacionListada
		if err := r.Scan(&c.ID, &c.WaJid, &c.DisplayName, &c.CustomerID, &c.ClienteNombre, &c.ClienteTipo, &c.Estado, &c.UltimoMensajeAt,
			&c.UltimoMensajePreview, &c.UltimoEntranteAt, &c.NoLeidos, &c.AsignadoAUserID, &c.AsignadoNombre, &c.Baja); err != nil {
			return nil, err
		}
		c.Nombre = oTexto(primero(c.ClienteNombre, c.DisplayName), "Sin identificar")
		c.VentanaAbierta = VentanaAbierta(c.UltimoEntranteAt, ahora)
		out = append(out, c)
	}
	return out, r.Err()
}

// Contadores son los números de los filtros.
type Contadores struct {
	SinLeer    int `json:"sinLeer"`
	Mias       int `json:"mias"`
	SinAsignar int `json:"sinAsignar"`
}

// ContarBandeja son los contadores de los filtros.
func (s *Servicio) ContarBandeja(ctx context.Context, usuarioID string) (Contadores, error) {
	var c Contadores
	err := s.pool.QueryRow(ctx, `select
		(count(*) filter (where no_leidos > 0))::int, (count(*) filter (where asignado_a_user_id = $1))::int,
		(count(*) filter (where asignado_a_user_id is null))::int
		from whatsapp_conversaciones where estado = 'abierta'`, usuarioID).Scan(&c.SinLeer, &c.Mias, &c.SinAsignar)
	return c, err
}

// Citado es el mensaje al que responde otro.
type Citado struct {
	ID        string `json:"id"`
	Cuerpo    string `json:"cuerpo"`
	Direccion string `json:"direccion"`
}

// MensajeDeLaBandeja es una burbuja.
type MensajeDeLaBandeja struct {
	ID              string          `json:"id"`
	Direccion       string          `json:"direccion"`
	Tipo            string          `json:"tipo"`
	WaMessageID     *string         `json:"waMessageId"`
	Cuerpo          string          `json:"cuerpo"`
	MediaURL        *string         `json:"mediaUrl"`
	MediaTipo       *string         `json:"mediaTipo"`
	MediaMime       *string         `json:"mediaMime"`
	MediaNombre     *string         `json:"mediaNombre"`
	MediaEstado     *string         `json:"mediaEstado"`
	MediaBytes      *int32          `json:"mediaBytes"`
	Datos           json.RawMessage `json:"datos"`
	Citado          *Citado         `json:"citado"`
	ReaccionCliente *string         `json:"reaccionCliente"`
	ReaccionNuestra *string         `json:"reaccionNuestra"`
	Estado          string          `json:"estado"`
	ErrorCodigo     *int32          `json:"errorCodigo"`
	ErrorDetalle    *string         `json:"errorDetalle"`
	Plantilla       *string         `json:"plantilla"`
	Origen          *string         `json:"origen"`
	EnviadoPor      *string         `json:"enviadoPor"`
	CobroCategoria  *string         `json:"cobroCategoria"`
	Cobrable        *bool           `json:"cobrable"`
	Importado       bool            `json:"importado"`
	OcurridoAt      time.Time       `json:"ocurridoAt"`
}

// PedidoDelCliente es uno de los últimos pedidos, al costado de la charla.
type PedidoDelCliente struct {
	ID        string    `json:"id"`
	Numero    string    `json:"numero"`
	Estado    string    `json:"estado"`
	Total     string    `json:"total"`
	CreatedAt time.Time `json:"createdAt"`
	Sucursal  *string   `json:"sucursal"`
}

// DocumentoListado es un papel del cliente que se puede mandar.
type DocumentoListado struct {
	Tipo        string     `json:"tipo"`
	ID          string     `json:"id"`
	Titulo      string     `json:"titulo"`
	Detalle     string     `json:"detalle"`
	Descripcion string     `json:"descripcion"`
	Fecha       *time.Time `json:"fecha"`
}

// DetalleConversacion es una conversación con sus mensajes y el cliente.
type DetalleConversacion struct {
	ID               string               `json:"id"`
	WaJid            string               `json:"waJid"`
	DisplayName      *string              `json:"displayName"`
	CustomerID       *string              `json:"customerId"`
	OrderID          *string              `json:"orderId"`
	Estado           string               `json:"estado"`
	Notas            *string              `json:"notas"`
	UltimoEntranteAt *time.Time           `json:"ultimoEntranteAt"`
	NoLeidos         int32                `json:"noLeidos"`
	AsignadoAUserID  *string              `json:"asignadoAUserId"`
	BajaAt           *time.Time           `json:"bajaAt"`
	BajaDetalle      *string              `json:"bajaDetalle"`
	ResueltaAt       *time.Time           `json:"resueltaAt"`
	ClienteNombre    *string              `json:"clienteNombre"`
	ClienteTipo      *string              `json:"clienteTipo"`
	ClienteTelefono  *string              `json:"clienteTelefono"`
	ClienteEmail     *string              `json:"clienteEmail"`
	ClienteLimite    *string              `json:"clienteLimite"`
	ClienteEstado    *string              `json:"clienteEstado"`
	Conocidos        map[string]string    `json:"conocidos"`
	Nombre           string               `json:"nombre"`
	SinNumero        bool                 `json:"sinNumero"`
	VentanaAbierta   bool                 `json:"ventanaAbierta"`
	Mensajes         []MensajeDeLaBandeja `json:"mensajes"`
	Saldo            float64              `json:"saldo"`
	LimiteCredito    float64              `json:"limiteCredito"`
	Pedidos          []PedidoDelCliente   `json:"pedidos"`
	Documentos       []DocumentoListado   `json:"documentos"`
}

// ObtenerConversacion es el detalle; nil si no existe.
func (s *Servicio) ObtenerConversacion(ctx context.Context, id string) (*DetalleConversacion, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	var d DetalleConversacion
	err := s.pool.QueryRow(ctx, `
		select c.id, c.wa_jid, c.display_name, c.customer_id, c.order_id, c.estado::text, c.notas, c.ultimo_entrante_at, c.no_leidos,
		       c.asignado_a_user_id, c.baja_at, c.baja_detalle, c.resuelta_at,
		       cu.nombre, cu.tipo::text, cu.telefono, cu.email, cu.limite_credito::text, cu.estado::text
		  from whatsapp_conversaciones c left join customers cu on cu.id = c.customer_id
		 where c.id = $1`, id).Scan(&d.ID, &d.WaJid, &d.DisplayName, &d.CustomerID, &d.OrderID, &d.Estado, &d.Notas, &d.UltimoEntranteAt,
		&d.NoLeidos, &d.AsignadoAUserID, &d.BajaAt, &d.BajaDetalle, &d.ResueltaAt,
		&d.ClienteNombre, &d.ClienteTipo, &d.ClienteTelefono, &d.ClienteEmail, &d.ClienteLimite, &d.ClienteEstado)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	ahora := s.ahora()
	if d.Mensajes, err = s.mensajesDe(ctx, id, ahora); err != nil {
		return nil, err
	}
	d.Pedidos, d.Documentos = []PedidoDelCliente{}, []DocumentoListado{}
	if d.CustomerID != nil {
		var saldo jsmath.Num
		if err := s.pool.QueryRow(ctx, `select coalesce(sum(monto), 0) from account_movements where customer_id = $1`, *d.CustomerID).Scan(&saldo); err != nil {
			return nil, err
		}
		d.Saldo = saldo.F()
		if d.Pedidos, err = s.pedidosDe(ctx, *d.CustomerID); err != nil {
			return nil, err
		}
		if d.Documentos, err = s.DocumentosDelCliente(ctx, *d.CustomerID); err != nil {
			return nil, err
		}
	}
	// Lo que ya se sabe, para precargar los datos de un mensaje preparado.
	d.Conocidos = map[string]string{}
	if len(d.Pedidos) > 0 {
		for k, v := range DatosDeSucursal(d.Pedidos[0].Sucursal, nil) {
			d.Conocidos[k] = v
		}
		d.Conocidos["pedido"] = d.Pedidos[0].Numero
	}
	if d.Saldo > 0 {
		d.Conocidos["saldo"] = Moneda(d.Saldo)
	}
	d.Conocidos["fecha"] = FechaCorta(ahora)
	d.Nombre = oTexto(primero(d.ClienteNombre, d.DisplayName), "Sin identificar")
	d.SinNumero = SinNumero(d.WaJid)
	d.VentanaAbierta = VentanaAbierta(d.UltimoEntranteAt, ahora)
	if d.ClienteLimite != nil {
		d.LimiteCredito = jsmath.Numero(*d.ClienteLimite)
	}
	return &d, nil
}

// FechaCorta es fechaCorta de lib/formato.ts («29/10/26»), en hora de
// Argentina (el TS usaba la del servidor).
func FechaCorta(t time.Time) string { return t.In(zonaArgentina).Format("02/01/06") }

// FechaHora es fechaHora de lib/formato.ts («29/10, 15:32»), en hora de Argentina.
func FechaHora(t time.Time) string { return t.In(zonaArgentina).Format("02/01, 15:04") }

func (s *Servicio) mensajesDe(ctx context.Context, convID string, ahora time.Time) ([]MensajeDeLaBandeja, error) {
	// Los últimos 300, en orden: una conversación de años no se carga entera.
	r, err := s.pool.Query(ctx, `
		select m.id, m.direccion::text, m.tipo, m.wa_message_id, m.cuerpo, m.media_url, m.media_tipo::text, m.media_mime, m.media_nombre,
		       m.media_estado, m.media_bytes, m.datos, m.citado_wa_message_id, m.reaccion_cliente, m.reaccion_nuestra, m.estado::text,
		       m.error_codigo, m.error_detalle, m.plantilla, m.origen, u.name, m.cobro_categoria, m.cobrable, m.importado, m.ocurrido_at, m.created_at
		  from whatsapp_mensajes m left join "user" u on u.id = m.enviado_por_user_id
		 where m.conversacion_id = $1
		 order by m.ocurrido_at desc limit 300`, convID)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	type crudo struct {
		m      MensajeDeLaBandeja
		url    *string
		citado *string
		creado time.Time
	}
	filas := []crudo{}
	for r.Next() {
		var c crudo
		m := &c.m
		var datos []byte
		if err := r.Scan(&m.ID, &m.Direccion, &m.Tipo, &m.WaMessageID, &m.Cuerpo, &c.url, &m.MediaTipo, &m.MediaMime, &m.MediaNombre,
			&m.MediaEstado, &m.MediaBytes, &datos, &c.citado, &m.ReaccionCliente, &m.ReaccionNuestra, &m.Estado,
			&m.ErrorCodigo, &m.ErrorDetalle, &m.Plantilla, &m.Origen, &m.EnviadoPor, &m.CobroCategoria, &m.Cobrable, &m.Importado, &m.OcurridoAt, &c.creado); err != nil {
			return nil, err
		}
		if len(datos) > 0 {
			m.Datos = datos
		} else {
			m.Datos = json.RawMessage("null")
		}
		filas = append(filas, c)
	}
	if err := r.Err(); err != nil {
		return nil, err
	}
	porWaID := map[string]*crudo{}
	for i := len(filas) - 1; i >= 0; i-- {
		if f := &filas[i]; f.m.WaMessageID != nil {
			porWaID[*f.m.WaMessageID] = f
		}
	}
	out := make([]MensajeDeLaBandeja, 0, len(filas))
	for i := len(filas) - 1; i >= 0; i-- {
		f := filas[i]
		m := f.m
		estado := oTexto(m.MediaEstado, "")
		if f.url != nil && *f.url != "" && estado != "pendiente" && estado != "fallido" {
			m.MediaURL = ptr("/api/whatsapp/medios/" + m.ID)
		}
		// Un «pendiente» de hace más de cinco minutos es una descarga que se
		// cortó: se muestra como fallida para que aparezca el botón.
		switch {
		case estado == "pendiente" && ahora.Sub(f.creado) > 5*time.Minute:
			m.MediaEstado = ptr("fallido")
		case m.MediaEstado == nil && f.url != nil && *f.url != "":
			m.MediaEstado = ptr("listo")
		}
		if f.citado != nil && *f.citado != "" {
			if c, ok := porWaID[*f.citado]; ok {
				cuerpo := c.m.Cuerpo
				if cuerpo == "" && c.m.MediaTipo != nil {
					cuerpo = "Archivo"
				}
				m.Citado = &Citado{c.m.ID, cuerpo, c.m.Direccion}
			} else {
				m.Citado = &Citado{"", "Un mensaje anterior", "saliente"}
			}
		}
		out = append(out, m)
	}
	return out, nil
}

func (s *Servicio) pedidosDe(ctx context.Context, customerID string) ([]PedidoDelCliente, error) {
	r, err := s.pool.Query(ctx, `select o.id, o.numero, o.estado::text, o.total::text, o.created_at, b.name
		from orders o left join branches b on b.id = o.branch_id where o.customer_id = $1 order by o.created_at desc limit 5`, customerID)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out := []PedidoDelCliente{}
	for r.Next() {
		var p PedidoDelCliente
		if err := r.Scan(&p.ID, &p.Numero, &p.Estado, &p.Total, &p.CreatedAt, &p.Sucursal); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, r.Err()
}

func numeroFormateado(pv, n int32) string { return fmt.Sprintf("%04d-%08d", pv, n) }

// DocumentosDelCliente son los papeles recientes de un cliente (cinco de
// cada uno), para elegir cuál mandar desde la conversación
// (documentosDelCliente de lib/whatsapp/documentos.ts).
func (s *Servicio) DocumentosDelCliente(ctx context.Context, customerID string) ([]DocumentoListado, error) {
	out := []DocumentoListado{{Tipo: "cuenta", ID: customerID, Titulo: "Resumen de cuenta", Detalle: "Movimientos y saldo al día de hoy",
		Descripcion: "el resumen de tu cuenta corriente"}}
	consultas := []struct {
		sql   string
		armar func(pgx.Rows) (DocumentoListado, error)
	}{
		{`select id, numero, total::float8, created_at from quotes where customer_id = $1 order by created_at desc limit 5`,
			func(r pgx.Rows) (DocumentoListado, error) {
				var d DocumentoListado
				var numero string
				var total float64
				var f time.Time
				err := r.Scan(&d.ID, &numero, &total, &f)
				d.Tipo, d.Titulo, d.Descripcion, d.Detalle, d.Fecha = "presupuesto", "Presupuesto "+numero, "el presupuesto "+numero, Moneda(total), &f
				return d, err
			}},
		{`select id, tipo::text, punto_venta, numero, total::float8, created_at from invoices where customer_id = $1 and estado <> 'borrador'
			order by created_at desc limit 5`,
			func(r pgx.Rows) (DocumentoListado, error) {
				var d DocumentoListado
				var tipo string
				var pv, n int32
				var total float64
				var f time.Time
				err := r.Scan(&d.ID, &tipo, &pv, &n, &total, &f)
				num := numeroFormateado(pv, n)
				d.Tipo, d.Titulo, d.Descripcion, d.Detalle, d.Fecha = "comprobante",
					"Factura "+mayusculasJS(reemplazarPrimero(tipo, "factura_", ""))+" "+num, "la factura "+num, Moneda(total), &f
				return d, err
			}},
		{`select d.id, d.numero, o.numero, d.created_at from deliveries d join orders o on o.id = d.order_id
			where o.customer_id = $1 order by d.created_at desc limit 5`,
			func(r pgx.Rows) (DocumentoListado, error) {
				var d DocumentoListado
				var numero, pedido string
				var f time.Time
				err := r.Scan(&d.ID, &numero, &pedido, &f)
				d.Tipo, d.Titulo, d.Descripcion, d.Detalle, d.Fecha = "remito", "Remito "+numero, "el remito "+numero, "Pedido "+pedido, &f
				return d, err
			}},
		{`select id, numero, total::float8, created_at from receipts where customer_id = $1 and estado = 'emitido' order by created_at desc limit 5`,
			func(r pgx.Rows) (DocumentoListado, error) {
				var d DocumentoListado
				var numero string
				var total float64
				var f time.Time
				err := r.Scan(&d.ID, &numero, &total, &f)
				d.Tipo, d.Titulo, d.Descripcion, d.Detalle, d.Fecha = "recibo", "Recibo "+numero, "el recibo "+numero, Moneda(total), &f
				return d, err
			}},
		{`select id, numero, created_at from cutting_orders where customer_id = $1 order by created_at desc limit 5`,
			func(r pgx.Rows) (DocumentoListado, error) {
				var d DocumentoListado
				var numero string
				var f time.Time
				err := r.Scan(&d.ID, &numero, &f)
				d.Tipo, d.Titulo, d.Descripcion, d.Detalle, d.Fecha = "corte", "Corte "+numero, "el plano de corte "+numero, "Plano de corte", &f
				return d, err
			}},
	}
	for _, c := range consultas {
		r, err := s.pool.Query(ctx, c.sql, customerID)
		if err != nil {
			return nil, err
		}
		for r.Next() {
			d, err := c.armar(r)
			if err != nil {
				r.Close()
				return nil, err
			}
			out = append(out, d)
		}
		r.Close()
		if err := r.Err(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func reemplazarPrimero(s, viejo, nuevo string) string {
	for i := 0; i+len(viejo) <= len(s); i++ {
		if s[i:i+len(viejo)] == viejo {
			return s[:i] + nuevo + s[i+len(viejo):]
		}
	}
	return s
}

// MarcarLeidaSilencioso pone en cero los no leídos y devuelve el último
// entrante, para avisarle a WhatsApp que se leyó.
func (s *Servicio) MarcarLeidaSilencioso(ctx context.Context, id string) (string, error) {
	if _, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set no_leidos = 0 where id = $1 and no_leidos > 0`, id); err != nil {
		return "", err
	}
	var w string
	err := s.pool.QueryRow(ctx, `select wa_message_id from whatsapp_mensajes where conversacion_id = $1 and direccion = 'entrante'
		and wa_message_id is not null order by ocurrido_at desc limit 1`, id).Scan(&w)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return w, err
}

// ConversacionesSinLeer cuenta las que tienen mensajes sin leer (el menú).
func (s *Servicio) ConversacionesSinLeer(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `select count(*)::int from whatsapp_conversaciones where estado = 'abierta' and no_leidos > 0`).Scan(&n)
	return n, err
}

// EstadoBandeja es el estado de la conexión, con lo guardado.
type EstadoBandeja struct {
	EstadoConexion
	UltimoWebhookAt *int64 `json:"ultimoWebhookAt"`
}

// EstadoWhatsapp mezcla lo que dice el proveedor y lo guardado.
func (s *Servicio) EstadoWhatsapp(ctx context.Context) (EstadoBandeja, error) {
	e := s.prov.Estado(ctx)
	var senal, webhook *time.Time
	err := s.pool.QueryRow(ctx, `select ultima_senal, ultimo_webhook_at from whatsapp_sesion limit 1`).Scan(&senal, &webhook)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return EstadoBandeja{}, err
	}
	out := EstadoBandeja{EstadoConexion: e}
	if senal != nil {
		out.UltimaSenal = ptr(senal.UnixMilli())
	}
	if webhook != nil {
		out.UltimoWebhookAt = ptr(webhook.UnixMilli())
	}
	return out, nil
}

// Persona es alguien que puede atender.
type Persona struct {
	ID     string `json:"id"`
	Nombre string `json:"nombre"`
}

// PersonalDeLaBandeja son quienes pueden atender (para el «asignar a»).
func (s *Servicio) PersonalDeLaBandeja(ctx context.Context) ([]Persona, error) {
	nombres := []string{}
	for _, r := range roles.QuienEntra("/admin/whatsapp") {
		nombres = append(nombres, string(r))
	}
	r, err := s.pool.Query(ctx, `select u.id, u.name from "user" u join profiles p on p.user_id = u.id
		where p.role = 'staff' and p.staff_role::text = any($1) order by u.name`, nombres)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out := []Persona{}
	for r.Next() {
		var p Persona
		if err := r.Scan(&p.ID, &p.Nombre); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, r.Err()
}

// GastoChico es el gasto para la bandeja: cuánto va y si se llegó al tope.
type GastoChico struct {
	USD        float64 `json:"usd"`
	Tope       float64 `json:"tope"`
	Proporcion float64 `json:"proporcion"`
	Alcanzado  bool    `json:"alcanzado"`
}
