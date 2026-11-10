package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/asistente"
	"mjbj/internal/push"
)

// El bot de WhatsApp (10/11/2026, Nahuel: «quieren contestar menos
// whatsapps»). Usa el mismo motor sin IA que el asistente del sitio
// (internal/asistente) y hace una de dos cosas: contesta con datos —horarios,
// envíos, pagos, qué hay en el catálogo, el corte armado— o pasa a una
// persona, mandándole al cliente un wa.me al número humano con lo que pidió ya
// escrito. Una vez derivada, la conversación es de la persona y el bot se
// calla hasta que alguien lo reactive desde la bandeja.
//
// **No da precios.** Ningún precio sale sin que alguien lo mire: la pregunta
// de precio se deriva con el producto en el resumen.
//
// Responder es puro (se prueba sin base); atenderConBot es lo que lee y
// escribe.

// ProductoBot es lo que el bot necesita de un producto del catálogo.
type ProductoBot struct {
	Nombre  string
	Slug    string
	Medidas []string
	Central bool
	Aserr   bool
}

// Buscador busca en el catálogo. Lo pone cmd/mjbj: el paquete no conoce el
// catálogo para no atarse a él.
type Buscador func(ctx context.Context, consulta, rubro string) ([]ProductoBot, error)

// ConBuscador conecta el catálogo.
func (s *Servicio) ConBuscador(b Buscador) *Servicio { s.buscar = b; return s }

// EstadoBot es lo que el bot recuerda de una conversación.
type EstadoBot struct {
	Fallos   int
	Consulta string
}

// DatosBot es lo que el bot sabe del negocio.
type DatosBot struct {
	Sitio        string // https://mjbj.iamnaw.dev
	NumeroHumano string // 549223…, sin el +
	StockVisible bool
	Envios       []string
	Productos    []ProductoBot // lo que trajo la búsqueda, si se buscó
}

// RespuestaBot es lo que decidió.
type RespuestaBot struct {
	Texto string
	// Derivar: se pasa a una persona y el bot se calla.
	Derivar bool
	// Buscar: hace falta el catálogo con esta consulta antes de contestar.
	Buscar   string
	Rubro    string
	Estado   EstadoBot
	Entendio asistente.Intencion
}

const pieDerivar = "Escribile acá y seguís con una persona del mostrador:"

// Responder decide la respuesta a un texto. Si hace falta el catálogo,
// devuelve Buscar y hay que llamarla de nuevo con DatosBot.Productos lleno.
func Responder(texto string, est EstadoBot, d DatosBot, conBusqueda bool) RespuestaBot {
	consulta := asistente.ConContexto(texto, est.Consulta)
	e := asistente.Entender(consulta)
	r := RespuestaBot{Entendio: e.Intencion, Estado: EstadoBot{Consulta: est.Consulta}}
	sitio := strings.TrimRight(d.Sitio, "/")

	switch e.Intencion {
	case asistente.Saludo:
		r.Texto = "¡Hola! Soy el asistente de la Maderera Juan B. Justo. Contame qué buscás —«melamina blanca de 18», «4 de 600x400 en MDF con canto»— o preguntame horarios, envíos o formas de pago."
	case asistente.Gracias:
		r.Texto = "¡De nada! Cualquier cosa, escribime."
	case asistente.Horarios:
		var b strings.Builder
		b.WriteString("Estamos en:\n")
		for _, s := range Sucursales {
			fmt.Fprintf(&b, "\n*%s*\n%s\n%s\n", s.Nombre, s.Direccion, s.Horario)
		}
		r.Texto = strings.TrimSpace(b.String())
	case asistente.Envios:
		r.Texto = "Entregamos en Mar del Plata y la zona."
		if len(d.Envios) > 0 {
			r.Texto += "\n\n" + strings.Join(d.Envios, "\n")
		}
	case asistente.Pagos:
		r.Texto = "Se puede pagar con:\n• Efectivo\n• Transferencia\n• Débito y crédito\n• Cuenta corriente, si sos cliente profesional aprobado"
	case asistente.Cortes:
		r.Texto = "Sí, cortamos placas a medida en el aserradero. Pasame el despiece acá —por ejemplo «4 de 600x400 en melamina blanca con canto»— o armalo vos en " + sitio + "/corte"
	case asistente.ArmarCorte:
		dp := e.Despiece
		n := 0
		for _, p := range dp.Piezas {
			n += p.Cantidad
		}
		material := ""
		if dp.Material != "" {
			material = " en " + dp.Material
		}
		r.Texto = fmt.Sprintf("Te armé el corte: %d %s%s. Abrilo para ver cómo entra en la placa, elegí la sucursal y mandalo:\n%s%s",
			n, plural(n, "pieza", "piezas"), material, sitio, asistente.EnlaceDelDespiece(*dp))
	case asistente.Cuenta:
		r.Texto = "Si trabajás del rubro —carpintería, construcción, arquitectura— pedí la cuenta profesional: lista propia, cuenta corriente y descuentos por cantidad.\n" + sitio + "/profesionales"
	case asistente.Moldava:
		r.Texto = "Moldava es nuestra línea propia: molduras y listonería en pino finger joint, sin nudos, en piezas de 3,05 m.\n" + sitio + "/moldava"
	case asistente.Documentacion:
		r.Texto = "Las fichas técnicas y tablas de carga están acá:\n" + sitio + "/documentacion"
	case asistente.Eventos:
		r.Texto = "Las capacitaciones y charlas están en la agenda:\n" + sitio + "/eventos"
	case asistente.Factura:
		r.Texto = "Facturamos A o B según tu condición frente al IVA. Para la A, pasanos el CUIT cuando compres."
	case asistente.Devoluciones:
		r.Texto = "Los cambios y devoluciones se hacen en la sucursal donde compraste, con el comprobante. Las condiciones:\n" + sitio + "/cambios-y-devoluciones"
	case asistente.Calcular:
		r.Texto = "Te hago la cuenta: si son placas, pasame las piezas («4 de 600x400 en melamina») y te armo el corte. Para techos, pisos o decks, contame los metros y lo que querés usar."
	case asistente.Persona, asistente.Acopio:
		return derivar(r, d, texto)
	case asistente.Precio:
		return derivar(r, d, texto)
	default: // buscar, stock, sin_idea
		if e.Consulta == "" && e.Rubro == "" {
			return noEntendio(r, est, d, texto)
		}
		if !conBusqueda {
			r.Buscar, r.Rubro = e.Consulta, e.Rubro
			return r
		}
		ps := filtrarPorEspesor(d.Productos, e.Medida.EspesorMm)
		if len(ps) == 0 {
			return noEntendio(r, est, d, texto)
		}
		r.Estado = EstadoBot{Consulta: e.Consulta}
		r.Texto = listarProductos(ps, sitio, d.StockVisible)
		if preguntaPrecio(texto) {
			r.Texto += "\n\nEl precio te lo pasa una persona del mostrador. " + pieDerivar + "\n" + enlaceHumano(d.NumeroHumano, texto)
			r.Derivar = d.NumeroHumano != ""
		}
		return r
	}
	return r
}

var rePrecio = regexp.MustCompile(`\b(precio|cuanto sale|cuanto vale|cuanto cuesta|cuanto esta)\b`)

func preguntaPrecio(texto string) bool { return rePrecio.MatchString(asistente.Normalizar(texto)) }

func noEntendio(r RespuestaBot, est EstadoBot, d DatosBot, texto string) RespuestaBot {
	if est.Fallos >= 1 {
		return derivar(r, d, texto)
	}
	r.Estado = EstadoBot{Fallos: est.Fallos + 1, Consulta: est.Consulta}
	r.Texto = "No lo encontré. Probá con el nombre del producto y la medida —«fenólico de 18», «machimbre de pino»— o escribí *persona* y te paso con el mostrador."
	return r
}

func derivar(r RespuestaBot, d DatosBot, texto string) RespuestaBot {
	if d.NumeroHumano == "" {
		r.Texto = "Te va a contestar una persona del mostrador por acá, en el horario de atención."
		r.Derivar = true
		return r
	}
	r.Texto = "Te paso con una persona. " + pieDerivar + "\n" + enlaceHumano(d.NumeroHumano, texto)
	r.Derivar = true
	return r
}

// enlaceHumano es el wa.me al número humano con la consulta ya escrita, así el
// cliente no tiene que contar todo de nuevo.
func enlaceHumano(numero, texto string) string {
	msg := "Hola, vengo del WhatsApp automático. " + strings.TrimSpace(texto)
	return "https://wa.me/" + numero + "?text=" + url.QueryEscape(msg)
}

func filtrarPorEspesor(ps []ProductoBot, mm int) []ProductoBot {
	if mm == 0 {
		return ps
	}
	re := regexp.MustCompile(fmt.Sprintf(`(^|[^\d])%d\s*mm`, mm))
	var quedan []ProductoBot
	for _, p := range ps {
		var ms []string
		for _, m := range p.Medidas {
			if re.MatchString(m) {
				ms = append(ms, m)
			}
		}
		if len(ms) > 0 {
			p.Medidas = ms
			quedan = append(quedan, p)
		}
	}
	return quedan
}

func listarProductos(ps []ProductoBot, sitio string, stock bool) string {
	if len(ps) > 4 {
		ps = ps[:4]
	}
	var b strings.Builder
	b.WriteString("Esto tenemos:\n")
	for _, p := range ps {
		fmt.Fprintf(&b, "\n*%s*", p.Nombre)
		if len(p.Medidas) > 0 {
			ms := p.Medidas
			if len(ms) > 3 {
				ms = append(ms[:3:3], fmt.Sprintf("y %d más", len(p.Medidas)-3))
			}
			b.WriteString("\n" + strings.Join(ms, " · "))
		}
		if stock {
			switch {
			case p.Central && p.Aserr:
				b.WriteString("\nHay en las dos sucursales")
			case p.Central:
				b.WriteString("\nHay en Casa Central")
			case p.Aserr:
				b.WriteString("\nHay en el Aserradero")
			}
		}
		b.WriteString("\n" + sitio + "/catalogo/" + p.Slug + "\n")
	}
	return strings.TrimSpace(b.String())
}

func plural(n int, uno, varios string) string {
	if n == 1 {
		return uno
	}
	return varios
}

// --- lo que lee y escribe ---

type ajustesBot struct {
	encendido    bool
	numeroHumano string
	stockVisible bool
}

func (s *Servicio) ajustesBot(ctx context.Context) (ajustesBot, error) {
	var a ajustesBot
	filas, err := s.pool.Query(ctx, `select clave, valor from site_settings where clave in ('whatsapp_bot', 'whatsapp_numero_humano', 'stock_visible')`)
	if err != nil {
		return a, err
	}
	defer filas.Close()
	for filas.Next() {
		var k, v string
		if err := filas.Scan(&k, &v); err != nil {
			return a, err
		}
		switch k {
		case "whatsapp_bot":
			a.encendido = v == "si"
		case "whatsapp_numero_humano":
			a.numeroHumano = soloDigitos(v)
		case "stock_visible":
			a.stockVisible = v == "si"
		}
	}
	return a, filas.Err()
}

var reNoDigito = regexp.MustCompile(`\D`)

func soloDigitos(s string) string { return reNoDigito.ReplaceAllString(s, "") }

func (s *Servicio) enviosParaBot(ctx context.Context) []string {
	filas, err := s.pool.Query(ctx, `select nombre, demora_estimada from shipping_zones where activa order by orden, nombre`)
	if err != nil {
		return nil
	}
	defer filas.Close()
	var out []string
	for filas.Next() {
		var nombre string
		var demora *string
		if filas.Scan(&nombre, &demora) != nil {
			return nil
		}
		linea := "• " + nombre
		if demora != nil && *demora != "" {
			linea += " — " + *demora
		}
		out = append(out, linea)
	}
	return out
}

// atenderConBot contesta un entrante si el bot está encendido y la
// conversación no está en manos de una persona.
func (s *Servicio) atenderConBot(ctx context.Context, convID, waJid, texto string) error {
	texto = trimJS(texto)
	if texto == "" || EsPedidoDeBaja(texto) || EsPedidoDeAlta(texto) {
		return nil
	}
	aj, err := s.ajustesBot(ctx)
	if err != nil || !aj.encendido {
		return err
	}
	var estado string
	var fallos int
	var consulta *string
	var humanoReciente bool
	err = s.pool.QueryRow(ctx, `
		select c.bot_estado, c.bot_fallos, c.bot_consulta,
			exists (select 1 from whatsapp_mensajes m where m.conversacion_id = c.id and m.direccion = 'saliente'
				and coalesce(m.origen, '') in ('panel', 'telefono') and m.ocurrido_at > now() - interval '12 hours')
		  from whatsapp_conversaciones c where c.id = $1`, convID).Scan(&estado, &fallos, &consulta, &humanoReciente)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// Si una persona está contestando, el bot no se mete.
	if estado != "activo" || humanoReciente {
		return nil
	}
	est := EstadoBot{Fallos: fallos}
	if consulta != nil {
		est.Consulta = *consulta
	}
	d := DatosBot{Sitio: s.cfg.URLBase, NumeroHumano: aj.numeroHumano, StockVisible: aj.stockVisible}
	r := Responder(texto, est, d, false)
	if r.Entendio == asistente.Envios {
		d.Envios = s.enviosParaBot(ctx)
		r = Responder(texto, est, d, false)
	}
	if r.Buscar != "" || r.Rubro != "" {
		if s.buscar != nil {
			ps, err := s.buscar(ctx, r.Buscar, r.Rubro)
			if err != nil {
				s.log.Warn("el bot no pudo buscar en el catálogo", "error", err)
			}
			d.Productos = ps
		}
		r = Responder(texto, est, d, true)
	}

	if r.Derivar {
		_, err = s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_estado = 'derivada', bot_derivada_at = now(), bot_fallos = 0 where id = $1`, convID)
	} else {
		var c *string
		if r.Estado.Consulta != "" {
			c = &r.Estado.Consulta
		}
		_, err = s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_fallos = $2, bot_consulta = $3 where id = $1`, convID, r.Estado.Fallos, c)
	}
	if err != nil {
		return err
	}
	if _, err := s.EnviarYRegistrar(ctx, Envio{ConversacionID: convID, WaJid: waJid, Mensaje: Saliente{Tipo: "texto", Cuerpo: r.Texto},
		Registro: Registro{Cuerpo: r.Texto}, Origen: "bot"}); err != nil {
		return err
	}
	if r.Derivar {
		s.avisar(ctx, push.Aviso{Titulo: "WhatsApp: pasa a una persona", Cuerpo: cortarJS(texto, 140),
			URL: "/admin/whatsapp?chat=" + convID, Etiqueta: "whatsapp-" + convID, Pantalla: "/admin/whatsapp"})
	}
	return nil
}

// ReactivarBot le devuelve la conversación al bot.
func (s *Servicio) ReactivarBot(ctx context.Context, convID string) error {
	_, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_estado = 'activo', bot_fallos = 0, bot_derivada_at = null where id = $1`, convID)
	return err
}
