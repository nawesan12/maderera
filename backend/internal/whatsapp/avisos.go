package whatsapp

import (
	"context"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5"
)

// Los avisos automáticos por WhatsApp (lib/whatsapp/avisos.ts). Cuidados que
// no son opcionales: nunca frenan la operación; nacen apagados (cada uno se
// cobra); quien pidió la baja no recibe nada; dentro de la ventana va el
// texto libre y fuera, la plantilla aprobada; no se repite lo que ya se avisó
// a mano, y al llegar al tope del mes deja de salir por WhatsApp. Todo queda
// en notifications_log con canal `whatsapp`.

// Sucursal es lo que se publica de cada local (lib/sucursales.ts): lo que
// usan los textos de los avisos.
type Sucursal struct{ Slug, Nombre, Direccion, Horario string }

// Sucursales son las dos, en el orden del TS.
var Sucursales = []Sucursal{
	{"casa-central", "Casa Central", "Av. Juan B. Justo 4153, Mar del Plata", "Lun a Vie 8:00-16:00 · Sáb 8:00-12:00"},
	{"aserradero", "Aserradero", "Diagonal Canosa 61, Mar del Plata", "Lun a Vie 8:00-16:00 · Sáb 8:00-12:00"},
}

var reMarDelPlata = regexp.MustCompile(`, Mar del Plata$`)

// DatosDeSucursal es la sucursal como la lee el cliente: nombre y dirección,
// y su horario.
func DatosDeSucursal(nombre, slug *string) map[string]string {
	var p *Sucursal
	for i := range Sucursales {
		if !vacio(slug) && Sucursales[i].Slug == *slug {
			p = &Sucursales[i]
			break
		}
	}
	if p == nil {
		for i := range Sucursales {
			if nombre != nil && Sucursales[i].Nombre == *nombre {
				p = &Sucursales[i]
				break
			}
		}
	}
	if p == nil {
		p = &Sucursales[0]
	}
	return map[string]string{"sucursal": p.Nombre + ", " + reMarDelPlata.ReplaceAllString(p.Direccion, ""), "horario": p.Horario}
}

// Documento es el PDF que va pegado al aviso (lo arma Next: los PDF siguen
// en TS hasta la tanda 12).
type Documento struct {
	Contenido []byte
	Nombre    string
}

// Entidad es de qué se avisa.
type Entidad struct {
	Tipo string `json:"tipo"`
	ID   string `json:"id"`
}

// OpcionesAviso es un aviso por mandar.
type OpcionesAviso struct {
	Evento   string            `json:"evento"`
	Telefono *string           `json:"telefono"`
	Nombre   *string           `json:"nombre"`
	Valores  map[string]string `json:"valores"`
	OrderID  *string           `json:"orderId"`
	Entidad  *Entidad          `json:"entidad"`
	// Forzar: desde el panel, se manda aunque el automático esté apagado.
	Forzar    bool    `json:"forzar"`
	UsuarioID *string `json:"usuarioId"`
	// ConDocumento: el aviso lleva un PDF. Si no vino (Documento nil) y el
	// aviso va a salir, vuelve «falta-documento» sin hacer nada: así Next arma
	// el PDF solo cuando hace falta, igual que el `documento: () => …` del TS.
	ConDocumento bool       `json:"conDocumento"`
	Documento    *Documento `json:"-"`
}

// ResultadoAviso es qué pasó.
type ResultadoAviso struct {
	Estado  string `json:"estado"` // enviada, simulada, fallida, omitida, falta-documento
	Detalle string `json:"detalle"`
}

type filaAviso struct {
	plantilla, idioma string
	textoLibre        *string
	activo            bool
}

func (s *Servicio) avisoConfigurado(ctx context.Context, evento string) (*filaAviso, error) {
	var a filaAviso
	err := s.pool.QueryRow(ctx, `select plantilla, idioma, texto_libre, activo from whatsapp_avisos where evento = $1 limit 1`, evento).
		Scan(&a.plantilla, &a.idioma, &a.textoLibre, &a.activo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &a, err
}

func (s *Servicio) yaSeAvisoAMano(ctx context.Context, evento, entidadID string) (bool, error) {
	var hay bool
	err := s.pool.QueryRow(ctx, `select exists(select 1 from notifications_log where canal = 'whatsapp_manual' and evento = $1 and entidad_id = $2)`,
		evento, entidadID).Scan(&hay)
	return hay, err
}

// AvisarPorWhatsapp manda un aviso. No falla nunca para afuera.
func (s *Servicio) AvisarPorWhatsapp(ctx context.Context, o OpcionesAviso) ResultadoAviso {
	r, err := s.avisarPorWhatsapp(ctx, o)
	if err != nil {
		// Se traga el error a propósito: la operación que lo disparó ya terminó.
		s.log.Error("whatsapp: aviso", "evento", o.Evento, "error", err)
		return ResultadoAviso{"fallida", "Error inesperado."}
	}
	return r
}

func (s *Servicio) avisarPorWhatsapp(ctx context.Context, o OpcionesAviso) (ResultadoAviso, error) {
	entidadID := ""
	switch {
	case o.Entidad != nil:
		entidadID = o.Entidad.ID
	case o.OrderID != nil:
		entidadID = *o.OrderID
	}
	registrar := func(estado, detalle, destinatario, waID string) (ResultadoAviso, error) {
		asunto := primero(textoDeMapa(o.Valores, "pedido"), textoDeMapa(o.Valores, "presupuesto"), textoDeMapa(o.Valores, "recibo"))
		var entTipo *string
		if o.Entidad != nil {
			entTipo = &o.Entidad.Tipo
		} else if o.OrderID != nil {
			entTipo = ptr("order")
		}
		var errTexto *string
		if estado != "enviada" && estado != "simulada" {
			errTexto = &detalle
		}
		if _, err := s.pool.Exec(ctx, `insert into notifications_log (canal, evento, destinatario, asunto, entidad_tipo, entidad_id, estado, proveedor_mensaje_id, error)
			values ('whatsapp', $1, $2, $3, $4, $5, $6, $7, $8)`,
			o.Evento, destinatario, asunto, entTipo, nulo(&entidadID), estado, nulo(&waID), errTexto); err != nil {
			s.log.Error("whatsapp: bitácora de avisos", "error", err)
		}
		return ResultadoAviso{estado, detalle}, nil
	}

	aviso, err := s.avisoConfigurado(ctx, o.Evento)
	if err != nil {
		return ResultadoAviso{}, err
	}
	activo := o.Forzar || (aviso != nil && aviso.activo)
	if !activo {
		return ResultadoAviso{"omitida", "El aviso está apagado."}, nil
	}
	if vacio(o.Telefono) {
		return registrar("omitida", "Sin teléfono en la ficha ni en el pedido.", "-", "")
	}
	waJid := AJid(*o.Telefono)
	if waJid == "" {
		return registrar("omitida", "Teléfono que no se entiende: «"+*o.Telefono+"».", *o.Telefono, "")
	}
	if !o.Forzar {
		if entidadID != "" {
			ya, err := s.yaSeAvisoAMano(ctx, o.Evento, entidadID)
			if err != nil {
				return ResultadoAviso{}, err
			}
			if ya {
				return registrar("omitida", "Ya se avisó a mano desde WhatsApp Business.", waJid, "")
			}
		}
		if s.TopeAlcanzado(ctx) {
			return registrar("omitida", MotivoTope, waJid, "")
		}
	}

	nombre := ""
	if o.Nombre != nil {
		nombre = *o.Nombre
	}
	valores := map[string]string{"nombre": primeraPalabraJS(nombre)}
	if valores["nombre"] == "" {
		valores["nombre"] = "qué tal"
	}
	for k, v := range o.Valores {
		valores[k] = v
	}
	conv, err := s.ConversacionDe(ctx, waJid, nulo(o.Nombre), nil)
	if err != nil {
		return ResultadoAviso{}, err
	}
	if o.OrderID != nil && conv.OrderID == nil {
		if _, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set order_id = $2, updated_at = now() where id = $1`, conv.ID, *o.OrderID); err != nil {
			return ResultadoAviso{}, err
		}
	}

	nombrePlantilla := ""
	idioma := ""
	if aviso != nil {
		nombrePlantilla, idioma = aviso.plantilla, aviso.idioma
	} else if e := EventoDeAviso(o.Evento); e != nil {
		nombrePlantilla = e.Plantilla
	}
	var plantilla *PlantillaDisponible
	if nombrePlantilla != "" {
		if plantilla, err = s.PlantillaDisponible(ctx, nombrePlantilla, idioma); err != nil {
			return ResultadoAviso{}, err
		}
	}
	hayTexto := aviso != nil && aviso.textoLibre != nil && trimJS(*aviso.textoLibre) != ""
	d := DecidirEnvio(activo, conv.BajaAt != nil, VentanaAbierta(conv.UltimoEntranteAt, s.ahora()), hayTexto, plantilla != nil)
	if d.Como == "omitir" {
		motivo := "El aviso está apagado."
		switch d.Motivo {
		case "baja":
			motivo = "El número pidió la baja de los avisos."
		case "sin-plantilla":
			motivo = "La plantilla «" + nombrePlantilla + "» no está aprobada en Meta."
		}
		return registrar("omitida", motivo, waJid, "")
	}
	if o.ConDocumento && o.Documento == nil {
		return ResultadoAviso{"falta-documento", "Mandá el PDF para que salga."}, nil
	}

	simulado := s.prov.ID() == "demo"
	var media *MediaRegistro
	if o.Documento != nil {
		ref, n, err := s.GuardarPrivado(o.Documento.Contenido, "application/pdf")
		if err != nil {
			return ResultadoAviso{}, err
		}
		id, e := s.prov.SubirMedia(ctx, o.Documento.Contenido, "application/pdf", o.Documento.Nombre)
		if e != nil || id == "" {
			t := "No se pudo subir el PDF."
			if e != nil {
				t = e.Texto
			}
			return registrar("fallida", t, waJid, "")
		}
		media = &MediaRegistro{Referencia: ref, Tipo: "document", Mime: "application/pdf", Nombre: ptr(o.Documento.Nombre), Bytes: &n, MediaID: &id}
	}

	envio := Envio{ConversacionID: conv.ID, WaJid: waJid, Origen: "aviso", EnviadoPor: o.UsuarioID}
	if d.Como == "texto" {
		cuerpo := Completar(*aviso.textoLibre, valores)
		if media != nil {
			envio.Mensaje = Saliente{Tipo: "media", Clase: "document", Media: &RefMedia{ID: *media.MediaID}, Epigrafe: &cuerpo, NombreArchivo: media.Nombre}
		} else {
			envio.Mensaje = Saliente{Tipo: "texto", Cuerpo: cuerpo}
		}
		envio.Registro = Registro{Cuerpo: cuerpo, Media: media, Datos: obj{"aviso": o.Evento}}
	} else {
		completos := SugerirValores(plantilla.Plantilla, valores, nil)
		var me *MediaEncabezado
		if media != nil {
			me = &MediaEncabezado{ID: *media.MediaID, Nombre: *media.Nombre}
		}
		envio.Mensaje = Saliente{Tipo: "plantilla", Nombre: plantilla.Nombre, Idioma: plantilla.Idioma, Componentes: ArmarComponentes(plantilla.Plantilla, completos, me)}
		envio.Registro = Registro{Cuerpo: VistaPrevia(plantilla.Plantilla, completos), Media: media, Plantilla: &plantilla.Nombre, Datos: obj{"aviso": o.Evento}}
	}
	res, err := s.EnviarYRegistrar(ctx, envio)
	if err != nil {
		return ResultadoAviso{}, err
	}
	if res.Error != nil {
		return registrar("fallida", res.Error.Texto, waJid, res.WaMessageID)
	}
	estado := "enviada"
	if simulado {
		estado = "simulada"
	}
	detalle := "Mensaje común (dentro de las 24 h)."
	if d.Como != "texto" {
		detalle = "Plantilla " + plantilla.Nombre + "."
	}
	return registrar(estado, detalle, waJid, res.WaMessageID)
}

func textoDeMapa(m map[string]string, k string) *string {
	if v, ok := m[k]; ok {
		return &v
	}
	return nil
}

// AvisarCambioDePedido es el aviso del cambio de estado de un pedido (o del
// pedido recibido). El teléfono de la ficha manda sobre el del pedido.
func (s *Servicio) AvisarCambioDePedido(ctx context.Context, orderID, nuevoEstado string) ResultadoAviso {
	var numero string
	var contactoNombre, contactoTel, clienteNombre, clienteTel, sucursal, slug *string
	err := s.pool.QueryRow(ctx, `
		select o.numero, o.contacto_nombre, o.contacto_telefono, c.nombre, c.telefono, b.name, b.slug
		  from orders o left join customers c on c.id = o.customer_id left join branches b on b.id = o.branch_id
		 where o.id = $1`, orderID).Scan(&numero, &contactoNombre, &contactoTel, &clienteNombre, &clienteTel, &sucursal, &slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return ResultadoAviso{"omitida", "No existe el pedido."}
	}
	if err != nil {
		s.log.Error("whatsapp: aviso de pedido", "error", err)
		return ResultadoAviso{"fallida", "Error inesperado."}
	}
	valores := DatosDeSucursal(sucursal, slug)
	valores["pedido"] = numero
	return s.AvisarPorWhatsapp(ctx, OpcionesAviso{
		Evento: nuevoEstado, Telefono: primero(clienteTel, contactoTel), Nombre: primero(clienteNombre, contactoNombre),
		Valores: valores, OrderID: &orderID,
	})
}

// SembrarAvisos deja creados los avisos que faltan, apagados, y pasa a los
// nombres los textos viejos con {{1}} que nadie tocó.
func (s *Servicio) SembrarAvisos(ctx context.Context) error {
	for _, e := range EventosWhatsapp {
		if _, err := s.pool.Exec(ctx, `insert into whatsapp_avisos (evento, plantilla, idioma, texto_libre, activo)
			values ($1, $2, 'es_AR', $3, false) on conflict (evento) do nothing`, e.Evento, e.Plantilla, e.TextoLibre); err != nil {
			return err
		}
		if _, err := s.pool.Exec(ctx, `update whatsapp_avisos set texto_libre = $2, updated_at = now()
			where evento = $1 and texto_libre ~ '\{\{[0-9]+\}\}'`, e.Evento, e.TextoLibre); err != nil {
			return err
		}
	}
	return nil
}
