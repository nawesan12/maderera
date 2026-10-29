package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// La entrada a la bandeja: mensajes, estados y conversaciones
// (lib/whatsapp/ingesta.ts). Todo lo que llega por el webhook es dato de un
// tercero: tamaños acotados, sin caracteres de control y nada de HTML.

// Conversacion es una fila de whatsapp_conversaciones.
type Conversacion struct {
	ID                string
	WaJid             string
	UsuarioMetaID     *string
	DisplayName       *string
	CustomerID        *string
	OrderID           *string
	BranchID          *string
	Estado            string
	AsignadoAUserID   *string
	UltimoMensajeAt   *time.Time
	UltimoEntranteAt  *time.Time
	NoLeidos          int32
	Notas             *string
	BajaAt            *time.Time
	BajaDetalle       *string
	ResueltaAt        *time.Time
	UltimoMensajePrev *string
}

const columnasConversacion = `id, wa_jid, usuario_meta_id, display_name, customer_id, order_id, branch_id, estado::text,
	asignado_a_user_id, ultimo_mensaje_at, ultimo_entrante_at, no_leidos, notas, baja_at, baja_detalle, resuelta_at, ultimo_mensaje_preview`

func escanearConversacion(r pgx.Row) (*Conversacion, error) {
	var c Conversacion
	err := r.Scan(&c.ID, &c.WaJid, &c.UsuarioMetaID, &c.DisplayName, &c.CustomerID, &c.OrderID, &c.BranchID, &c.Estado,
		&c.AsignadoAUserID, &c.UltimoMensajeAt, &c.UltimoEntranteAt, &c.NoLeidos, &c.Notas, &c.BajaAt, &c.BajaDetalle, &c.ResueltaAt, &c.UltimoMensajePrev)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// Conversacion lee una por id; nil si no está.
func (s *Servicio) Conversacion(ctx context.Context, id string) (*Conversacion, error) {
	return escanearConversacion(s.pool.QueryRow(ctx, `select `+columnasConversacion+` from whatsapp_conversaciones where id = $1`, id))
}

type cliente struct{ id, nombre string }

// clientePorTelefono es la ficha que corresponde a un número: candidatos por
// los últimos siete dígitos y, entre ellos, el mismo número completo.
func (s *Servicio) clientePorTelefono(ctx context.Context, waJid string) (*cliente, error) {
	waID := WaIdDeJid(waJid)
	nacional := NumeroNacional("+" + waID)
	if nacional == "" {
		return nil, nil
	}
	filas, err := s.pool.Query(ctx, `
		select id, nombre, telefono from customers
		 where active = true and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 7) = $1
		 limit 20`, nacional[len(nacional)-7:])
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var id, nombre string
		var tel *string
		if err := filas.Scan(&id, &nombre, &tel); err != nil {
			return nil, err
		}
		if tel != nil && *tel != "" && MismoNumero(*tel, "+"+waID) {
			return &cliente{id, nombre}, nil
		}
	}
	return nil, filas.Err()
}

// pedidoAbierto es el último pedido abierto del cliente.
func (s *Servicio) pedidoAbierto(ctx context.Context, customerID string) (*string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `select id from orders where customer_id = $1 and estado not in ('entregado', 'cancelado')
		order by created_at desc limit 1`, customerID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// ConversacionDe es la conversación de un número, creándola si es la
// primera vez (con la ficha y el pedido abierto, si se encuentran). Dos
// webhooks del mismo número nuevo pueden llegar juntos: el alta va con
// `on conflict` y nunca crea dos.
func (s *Servicio) ConversacionDe(ctx context.Context, waJid string, displayName, usuarioMetaID *string) (*Conversacion, error) {
	existente, err := escanearConversacion(s.pool.QueryRow(ctx, `select `+columnasConversacion+` from whatsapp_conversaciones where wa_jid = $1`, waJid))
	if err != nil {
		return nil, err
	}
	// La misma persona pudo haber escrito antes sin número (solo BSUID).
	if existente == nil && !vacio(usuarioMetaID) {
		existente, err = escanearConversacion(s.pool.QueryRow(ctx, `select `+columnasConversacion+` from whatsapp_conversaciones where usuario_meta_id = $1 limit 1`, *usuarioMetaID))
		if err != nil {
			return nil, err
		}
		if existente != nil && !SinNumero(waJid) && SinNumero(existente.WaJid) {
			existente, err = escanearConversacion(s.pool.QueryRow(ctx, `update whatsapp_conversaciones set wa_jid = $2, updated_at = now()
				where id = $1 returning `+columnasConversacion, existente.ID, waJid))
			if err != nil {
				return nil, err
			}
		}
	}
	if existente != nil && !vacio(usuarioMetaID) && existente.UsuarioMetaID == nil {
		existente, err = escanearConversacion(s.pool.QueryRow(ctx, `update whatsapp_conversaciones set usuario_meta_id = $2
			where id = $1 returning `+columnasConversacion, existente.ID, *usuarioMetaID))
		if err != nil {
			return nil, err
		}
	}
	if existente != nil {
		if existente.CustomerID == nil && !SinNumero(existente.WaJid) {
			c, err := s.clientePorTelefono(ctx, waJid)
			if err != nil {
				return nil, err
			}
			if c != nil {
				pedido, err := s.pedidoAbierto(ctx, c.id)
				if err != nil {
					return nil, err
				}
				return escanearConversacion(s.pool.QueryRow(ctx, `update whatsapp_conversaciones set customer_id = $2, order_id = $3, updated_at = now()
					where id = $1 returning `+columnasConversacion, existente.ID, c.id, pedido))
			}
		}
		return existente, nil
	}

	var c *cliente
	if !SinNumero(waJid) {
		if c, err = s.clientePorTelefono(ctx, waJid); err != nil {
			return nil, err
		}
	}
	nombre := displayName
	var customerID, orderID *string
	if c != nil {
		if nombre == nil {
			nombre = &c.nombre
		}
		customerID = &c.id
		if orderID, err = s.pedidoAbierto(ctx, c.id); err != nil {
			return nil, err
		}
	}
	var meta *string
	if !vacio(usuarioMetaID) {
		meta = usuarioMetaID
	}
	creada, err := escanearConversacion(s.pool.QueryRow(ctx, `
		insert into whatsapp_conversaciones (wa_jid, usuario_meta_id, display_name, customer_id, order_id)
		values ($1, $2, $3, $4, $5)
		on conflict (wa_jid) do nothing
		returning `+columnasConversacion, waJid, meta, nombre, customerID, orderID))
	if err != nil || creada != nil {
		return creada, err
	}
	return escanearConversacion(s.pool.QueryRow(ctx, `select `+columnasConversacion+` from whatsapp_conversaciones where wa_jid = $1`, waJid))
}

// EntranteGuardado es lo que se guardó de un mensaje que llegó.
type EntranteGuardado struct {
	MensajeID, ConversacionID string
	MediaID                   *string
	Cuerpo, Nombre            string
	AsignadoA                 *string
}

func ocurridoDe(ms *float64, ahora time.Time) time.Time {
	if ms == nil || *ms == 0 {
		return ahora
	}
	return time.UnixMilli(int64(*ms)).UTC()
}

func datosJSON(d obj) []byte {
	if d == nil {
		return nil
	}
	b, _ := json.Marshal(d)
	return b
}

func mediaCampos(m *MediaMeta) (tipo, mime, nombre, id, estado *string) {
	if m == nil {
		return
	}
	tipo, mime, id, estado = &m.Tipo, m.Mime, &m.ID, ptr("pendiente")
	if !vacio(m.Nombre) {
		nombre = ptr(cortarJS(Limpiar(*m.Nombre), 200))
	}
	return
}

func nombrePerfil(m MensajeMeta) *string {
	if vacio(m.NombrePerfil) {
		return nil
	}
	return ptr(cortarJS(Limpiar(*m.NombrePerfil), 120))
}

// IngresarEntrante guarda un mensaje entrante; nil si ya estaba (el corte
// por repetido es el índice único de wa_message_id, sin carrera posible).
func (s *Servicio) IngresarEntrante(ctx context.Context, m MensajeMeta, waJid string) (*EntranteGuardado, error) {
	ocurrido := ocurridoDe(m.Ocurrido, s.ahora())
	conv, err := s.ConversacionDe(ctx, waJid, nombrePerfil(m), m.UsuarioMeta)
	if err != nil {
		return nil, err
	}
	// Una reacción no es un mensaje nuevo: va sobre el que reaccionó.
	if m.Tipo == "reaction" && m.Reaccion != nil {
		var emoji *string
		if m.Reaccion.Emoji != "" {
			emoji = &m.Reaccion.Emoji
		}
		if _, err := s.pool.Exec(ctx, `update whatsapp_mensajes set reaccion_cliente = $1 where wa_message_id = $2 and conversacion_id = $3`,
			emoji, m.Reaccion.AMensaje, conv.ID); err != nil {
			return nil, err
		}
		return nil, s.RegistrarSenal(ctx, false)
	}
	cuerpo := Limpiar(m.Texto)
	tipo, mime, nombre, mediaID, mediaEstado := mediaCampos(m.Media)
	var id string
	err = s.pool.QueryRow(ctx, `
		insert into whatsapp_mensajes (conversacion_id, direccion, wa_message_id, tipo, cuerpo, media_tipo, media_mime, media_nombre,
			media_id, media_estado, citado_wa_message_id, datos, estado, origen, ocurrido_at)
		values ($1, 'entrante', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'entregado', 'cliente', $12)
		on conflict (wa_message_id) do nothing returning id`,
		conv.ID, m.WaMessageID, m.Tipo, cuerpo, tipo, mime, nombre, mediaID, mediaEstado, m.Citado, datosJSON(m.Datos), ocurrido).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	nuevoNombre := nombrePerfil(m)
	if nuevoNombre == nil {
		nuevoNombre = conv.DisplayName
	}
	var nombreConv, asignado *string
	if err := s.pool.QueryRow(ctx, `
		update whatsapp_conversaciones set display_name = $2, ultimo_mensaje_at = $3, ultimo_mensaje_preview = $4,
			ultimo_entrante_at = greatest(ultimo_entrante_at, $3), no_leidos = no_leidos + 1,
			estado = 'abierta', resuelta_at = null, resuelta_por_user_id = null, updated_at = now()
		 where id = $1 returning display_name, asignado_a_user_id`,
		conv.ID, nuevoNombre, ocurrido, Resumen(cuerpo, m.Tipo)).Scan(&nombreConv, &asignado); err != nil {
		return nil, err
	}
	if err := s.RegistrarSenal(ctx, false); err != nil {
		return nil, err
	}
	nom := "Cliente"
	if nombreConv != nil {
		nom = *nombreConv
	}
	if conv.CustomerID != nil {
		var n string
		if err := s.pool.QueryRow(ctx, `select nombre from customers where id = $1`, *conv.CustomerID).Scan(&n); err == nil {
			nom = n
		}
	}
	var mid *string
	if m.Media != nil {
		mid = &m.Media.ID
	}
	return &EntranteGuardado{MensajeID: id, ConversacionID: conv.ID, MediaID: mid, Cuerpo: cuerpo, Nombre: nom, AsignadoA: asignado}, nil
}

// RegistrarEco guarda lo que el negocio escribió desde la app del teléfono:
// saliente, origen `telefono`, sin cobro, sin tocar la ventana y con los no
// leídos en cero. Devuelve el id, o "" si ya estaba.
func (s *Servicio) RegistrarEco(ctx context.Context, m MensajeMeta, waJidDestino string) (string, error) {
	conv, err := s.ConversacionDe(ctx, waJidDestino, nil, nil)
	if err != nil {
		return "", err
	}
	cuerpo := Limpiar(m.Texto)
	ocurrido := ocurridoDe(m.Ocurrido, s.ahora())
	tipo, mime, nombre, mediaID, mediaEstado := mediaCampos(m.Media)
	var id string
	err = s.pool.QueryRow(ctx, `
		insert into whatsapp_mensajes (conversacion_id, direccion, wa_message_id, tipo, cuerpo, media_tipo, media_mime, media_nombre,
			media_id, media_estado, citado_wa_message_id, datos, estado, origen, cobrable, ocurrido_at)
		values ($1, 'saliente', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'enviado', 'telefono', false, $12)
		on conflict (wa_message_id) do nothing returning id`,
		conv.ID, m.WaMessageID, m.Tipo, cuerpo, tipo, mime, nombre, mediaID, mediaEstado, m.Citado, datosJSON(m.Datos), ocurrido).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	_, err = s.pool.Exec(ctx, `update whatsapp_conversaciones set ultimo_mensaje_at = greatest(ultimo_mensaje_at, $2),
		ultimo_mensaje_preview = $3, no_leidos = 0, updated_at = now() where id = $1`, conv.ID, ocurrido, Resumen(cuerpo, m.Tipo))
	return id, err
}

// AplicarCambioDeEco cambia la burbuja de un mensaje del teléfono que se
// editó o se borró después de mandarlo.
func (s *Servicio) AplicarCambioDeEco(ctx context.Context, cambio, original string, texto *string) (bool, error) {
	var id string
	var datos []byte
	err := s.pool.QueryRow(ctx, `select id, datos from whatsapp_mensajes where wa_message_id = $1 limit 1`, original).Scan(&id, &datos)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	d := obj{}
	_ = json.Unmarshal(datos, &d)
	if d == nil {
		d = obj{}
	}
	if cambio == "eliminado" {
		d["eliminado"] = true
		_, err = s.pool.Exec(ctx, `update whatsapp_mensajes set cuerpo = 'Se eliminó este mensaje desde el teléfono.', datos = $2 where id = $1`, id, datosJSON(d))
	} else {
		d["editado"] = true
		if texto != nil {
			_, err = s.pool.Exec(ctx, `update whatsapp_mensajes set cuerpo = $3, datos = $2 where id = $1`, id, datosJSON(d), Limpiar(*texto))
		} else {
			_, err = s.pool.Exec(ctx, `update whatsapp_mensajes set datos = $2 where id = $1`, id, datosJSON(d))
		}
	}
	return err == nil, err
}

var estadoDelHistorial = map[string]string{
	"PENDING": "pendiente", "SENT": "enviado", "DELIVERED": "entregado", "READ": "leido", "PLAYED": "leido", "ERROR": "fallido",
}

// ImportarHistorial importa una parte del historial de la app del teléfono.
// Lo importado es pasado: no avisa a nadie, no suma no leídos, no reabre
// conversaciones y no abre la ventana. Cada hilo en una transacción.
func (s *Servicio) ImportarHistorial(ctx context.Context, parte ParteHistorial) (int, error) {
	nuevos := 0
	for _, hilo := range parte.Hilos {
		if len(hilo.Mensajes) == 0 {
			continue
		}
		conv, err := s.ConversacionDe(ctx, JidDeWaId(hilo.WaID), nil, nil)
		if err != nil {
			return nuevos, err
		}
		n, err := s.importarHilo(ctx, conv.ID, hilo.Mensajes)
		if err != nil {
			return nuevos, err
		}
		nuevos += n
	}
	return nuevos, nil
}

func (s *Servicio) importarHilo(ctx context.Context, convID string, mensajes []MensajeMeta) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	type fila struct {
		ocurrido     time.Time
		cuerpo, tipo string
	}
	var ultimo *fila
	nuevos := 0
	ahora := s.ahora()
	for _, m := range mensajes {
		direccion, origen, estado := "entrante", "cliente", "entregado"
		var cobrable *bool
		if m.DelNegocio {
			direccion, origen, estado = "saliente", "telefono", "enviado"
			if e, ok := estadoDelHistorial[oTexto(m.EstadoHistorial, "")]; ok {
				estado = e
			}
			cobrable = ptr(false)
		}
		tipo, mime, nombre, mediaID, mediaEstado := mediaCampos(m.Media)
		ocurrido := ocurridoDe(m.Ocurrido, ahora)
		var f fila
		err := tx.QueryRow(ctx, `
			insert into whatsapp_mensajes (conversacion_id, direccion, wa_message_id, tipo, cuerpo, media_tipo, media_mime, media_nombre,
				media_id, media_estado, citado_wa_message_id, datos, estado, origen, cobrable, importado, ocurrido_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true, $16)
			on conflict (wa_message_id) do nothing returning ocurrido_at, cuerpo, tipo`,
			convID, direccion, m.WaMessageID, m.Tipo, Limpiar(m.Texto), tipo, mime, nombre, mediaID, mediaEstado, m.Citado,
			datosJSON(m.Datos), estado, origen, cobrable, ocurrido).Scan(&f.ocurrido, &f.cuerpo, &f.tipo)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return 0, err
		}
		nuevos++
		if ultimo == nil || f.ocurrido.After(ultimo.ocurrido) {
			ff := f
			ultimo = &ff
		}
	}
	if ultimo != nil {
		if _, err := tx.Exec(ctx, `update whatsapp_conversaciones set
			ultimo_mensaje_preview = case when ultimo_mensaje_at is null or ultimo_mensaje_at < $2 then $3 else ultimo_mensaje_preview end,
			ultimo_mensaje_at = greatest(ultimo_mensaje_at, $2) where id = $1`, convID, ultimo.ocurrido, Resumen(ultimo.cuerpo, ultimo.tipo)); err != nil {
			return 0, err
		}
	}
	return nuevos, tx.Commit(ctx)
}

// CompletarMediosDelHistorial completa las burbujas de los adjuntos del
// historial que Meta manda después, y devuelve los ids para bajarlos.
func (s *Servicio) CompletarMediosDelHistorial(ctx context.Context, lista []MensajeMeta) ([]string, error) {
	out := []string{}
	for _, m := range lista {
		if m.Media == nil {
			continue
		}
		cuerpo := ""
		if m.Texto != "" {
			cuerpo = Limpiar(m.Texto)
		}
		var nombre *string
		if !vacio(m.Media.Nombre) {
			nombre = ptr(cortarJS(Limpiar(*m.Media.Nombre), 200))
		}
		var id, convID, c, tipo string
		err := s.pool.QueryRow(ctx, `update whatsapp_mensajes set tipo = $2, cuerpo = $3, media_tipo = $4, media_mime = $5,
			media_nombre = $6, media_id = $7, media_estado = 'pendiente'
			where wa_message_id = $1 and importado = true and media_url is null
			returning id, conversacion_id, cuerpo, tipo`, m.WaMessageID, m.Tipo, cuerpo, m.Media.Tipo, m.Media.Mime, nombre, m.Media.ID).
			Scan(&id, &convID, &c, &tipo)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return out, err
		}
		out = append(out, id)
		if _, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set ultimo_mensaje_preview = $2
			where id = $1 and ultimo_mensaje_preview like '(Un archivo del historial%'`, convID, Resumen(c, tipo)); err != nil {
			return out, err
		}
	}
	return out, nil
}

// SincronizarContactos le pone nombre, con la agenda del teléfono, a las
// conversaciones que no lo tienen. No crea conversaciones ni fichas.
func (s *Servicio) SincronizarContactos(ctx context.Context, contactos []ContactoApp) (int, error) {
	n := 0
	for _, c := range contactos {
		if c.Accion != "add" || c.Nombre == nil || trimJS(*c.Nombre) == "" {
			continue
		}
		t, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set display_name = $2 where wa_jid = $1 and display_name is null`,
			JidDeWaId(c.Telefono), cortarJS(Limpiar(*c.Nombre), 120))
		if err != nil {
			return n, err
		}
		n += int(t.RowsAffected())
	}
	return n, nil
}

var ordenEstados = map[string]int{"pendiente": 0, "enviado": 1, "entregado": 2, "leido": 3}

var traduccionEstado = map[string]string{"sent": "enviado", "delivered": "entregado", "read": "leido", "played": "leido", "failed": "fallido"}

func enteroCodigo(c *float64) *int32 {
	if c == nil || *c != float64(int32(*c)) {
		return nil
	}
	v := int32(*c)
	return &v
}

// ActualizarEstadoMensaje aplica un estado de Meta. Los estados no
// retroceden (un «entregado» tarde no pisa un «leído»); «fallido» pisa todo
// menos «leído». Devuelve false si el mensaje todavía no está.
func (s *Servicio) ActualizarEstadoMensaje(ctx context.Context, e EstadoMeta) (bool, error) {
	var id, actual string
	err := s.pool.QueryRow(ctx, `select id, estado::text from whatsapp_mensajes where wa_message_id = $1 limit 1`, e.WaMessageID).Scan(&id, &actual)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	nuevo := traduccionEstado[e.Estado]
	conCobro := e.Cobro != nil
	var categoria *string
	var cobrable *bool
	if conCobro {
		categoria, cobrable = e.Cobro.Categoria, e.Cobro.Cobrable
	}
	cuando := ocurridoDe(e.Ocurrido, s.ahora())
	if nuevo == "fallido" {
		if actual == "leido" {
			return true, nil
		}
		var codigo *float64
		detalle := ""
		if e.Error != nil {
			codigo = e.Error.Codigo
			detalle = oTexto(e.Error.Detalle, e.Error.Titulo)
		}
		texto := cortarJS(ExplicarError(codigo, detalle).Texto, 500)
		var errCodigo *int32
		if e.Error != nil {
			errCodigo = enteroCodigo(e.Error.Codigo)
		}
		_, err = s.pool.Exec(ctx, `update whatsapp_mensajes set estado = 'fallido', estado_at = $2, error_codigo = $3, error_detalle = $4,
			cobro_categoria = case when $5 then $6 else cobro_categoria end, cobrable = case when $5 then $7 else cobrable end
			where id = $1`, id, cuando, errCodigo, texto, conCobro, categoria, cobrable)
		return true, err
	}
	ia, ok := ordenEstados[actual]
	if !ok {
		ia = -1
	}
	if ia >= ordenEstados[nuevo] {
		// Aunque no avance, el cobro se guarda: Meta lo informa en el primer aviso.
		if conCobro {
			_, err = s.pool.Exec(ctx, `update whatsapp_mensajes set cobro_categoria = $2, cobrable = $3 where id = $1`, id, categoria, cobrable)
		}
		return true, err
	}
	_, err = s.pool.Exec(ctx, `update whatsapp_mensajes set estado = $2::estado_mensaje, estado_at = $3,
		cobro_categoria = case when $4 then $5 else cobro_categoria end, cobrable = case when $4 then $6 else cobrable end
		where id = $1`, id, nuevo, cuando, conCobro, categoria, cobrable)
	return true, err
}

// RegistrarSenal marca que hubo actividad (y, si vino del webhook, cuándo
// llegó el último POST con firma válida).
func (s *Servicio) RegistrarSenal(ctx context.Context, webhook bool) error {
	t, err := s.pool.Exec(ctx, `update whatsapp_sesion set ultima_senal = now(), updated_at = now(),
		ultimo_webhook_at = case when $1 then now() else ultimo_webhook_at end`, webhook)
	if err != nil {
		return err
	}
	if t.RowsAffected() == 0 {
		_, err = s.pool.Exec(ctx, `insert into whatsapp_sesion (ultima_senal, updated_at, ultimo_webhook_at)
			values (now(), now(), case when $1 then now() else null end)`, webhook)
	}
	return err
}
