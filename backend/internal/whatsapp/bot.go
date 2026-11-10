package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/asistente"
	"mjbj/internal/numeracion"
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

// VarianteBot es una medida de un producto, con el precio de la lista
// general: va al presupuesto que revisa una persona, nunca al cliente.
type VarianteBot struct {
	ID        string
	Label     string
	EspesorMm int
	LargoMm   int
	AnchoMm   int
	Precio    string // vacío: sin precio cargado
}

// FichaBot es lo que el bot necesita para presupuestar un producto.
type FichaBot struct {
	Nombre    string
	Unidad    string
	Variantes []VarianteBot
}

// Ficheador trae las medidas de un producto por su slug.
type Ficheador func(ctx context.Context, slug string) (*FichaBot, error)

// ConBuscador conecta el catálogo: la búsqueda y la ficha de cada producto.
func (s *Servicio) ConBuscador(b Buscador, f Ficheador) *Servicio {
	s.buscar, s.ficha = b, f
	return s
}

// Corteador guarda un despiece como consulta de corte (la misma que manda el
// cortador del sitio) y devuelve el token, la placa elegida por el material y,
// si no se pudo, por qué —«hay una pieza que no entra»— o vacío si no se
// reconoció la placa.
type Corteador func(ctx context.Context, d asistente.Despiece) (token, placa, motivo string, err error)

// ConCortes conecta las consultas de corte.
func (s *Servicio) ConCortes(c Corteador) *Servicio { s.cortar = c; return s }

// Presupuestar es el pedido de presupuesto que sacó el bot de la charla.
type Presupuestar struct {
	Slug     string           `json:"slug"`
	Medida   asistente.Medida `json:"medida"`
	Cantidad float64          `json:"cantidad"`
	Texto    string           `json:"texto"`
}

// EstadoBot es lo que el bot recuerda de una conversación.
type EstadoBot struct {
	Fallos   int
	Consulta string
	// Pendiente: el presupuesto que espera la medida.
	Pendiente *Presupuestar
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
	// Presupuestar: hay un producto elegido y pidieron precio. Lo arma
	// atenderConBot con la ficha, en revisión.
	Presupuestar *Presupuestar
	// Cortar: escribieron un despiece; atenderConBot intenta guardarlo como
	// consulta de corte. Texto ya trae el link al cortador por si no se puede.
	Cortar *asistente.Despiece
}

const pieDerivar = "Escribile acá y seguís con una persona del mostrador:"

// Responder decide la respuesta a un texto. Si hace falta el catálogo,
// devuelve Buscar y hay que llamarla de nuevo con DatosBot.Productos lleno.
func Responder(texto string, est EstadoBot, d DatosBot, conBusqueda bool) RespuestaBot {
	// Si estaba esperando la medida de un presupuesto y la medida llegó, se
	// completa; si escribieron otra cosa, el pendiente se olvida.
	if p := est.Pendiente; p != nil {
		if m := medidaSuelta(texto); m.EspesorMm != 0 || m.LargoMm != 0 {
			q := *p
			q.Medida = m
			if c := cantidadPedida(texto, asistente.Entender(texto)); c != 1 {
				q.Cantidad = c
			}
			return RespuestaBot{Entendio: asistente.Precio, Presupuestar: &q, Estado: EstadoBot{Consulta: est.Consulta}}
		}
	}
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
		r.Cortar = dp
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
		if preguntaPrecio(texto) {
			if len(ps) == 1 {
				// Un producto: se arma el presupuesto y lo revisa una persona.
				r.Presupuestar = &Presupuestar{Slug: ps[0].Slug, Medida: e.Medida, Cantidad: cantidadPedida(texto, e), Texto: texto}
				return r
			}
			r.Texto = listarProductos(ps, sitio, d.StockVisible) + "\n\n¿De cuál te paso el presupuesto? Decime el nombre y la medida."
			return r
		}
		r.Texto = listarProductos(ps, sitio, d.StockVisible)
		return r
	}
	return r
}

var rePrecio = regexp.MustCompile(`\b(precio|precios|cuanto sale|cuanto salen|cuanto vale|cuanto valen|cuanto cuesta|cuanto cuestan|cuanto esta|cuanto estan|presupuesto|cotizacion|cotizame|pasame)\b`)

// reCantidad es «10 placas», «5 u», «3 tirantes»: un número chico seguido de
// una unidad. No lee el «18» de un espesor ni el «600» de una medida.
var reCantidad = regexp.MustCompile(`\b(\d{1,3})\s*(?:u|un|unid|unidades|placas?|tirantes?|tablas?|piezas?|rollos?|bolsas?|chapas?|barras?|listones?|varillas?|cajas?|latas?)\b`)

var reNumeroSolo = regexp.MustCompile(`^(\d{1,2})\s*(mm)?$`)

// medidaSuelta lee la medida de una respuesta corta: «18», «de 18», «18mm»,
// «1830x2600».
func medidaSuelta(texto string) asistente.Medida {
	t := asistente.Normalizar(texto)
	if g := reNumeroSolo.FindStringSubmatch(t); g != nil {
		var n int
		fmt.Sscan(g[1], &n)
		if n >= 3 && n <= 50 {
			return asistente.Medida{EspesorMm: n}
		}
	}
	return asistente.Entender(t).Medida
}

// cantidadPedida es cuánto piden: los metros si los dijeron, si no las
// unidades, y si no una.
func cantidadPedida(texto string, e asistente.Entendido) float64 {
	if e.Cantidad != nil && e.Cantidad.Valor > 0 {
		return e.Cantidad.Valor
	}
	if g := reCantidad.FindStringSubmatch(asistente.Normalizar(texto)); g != nil {
		var n float64
		fmt.Sscan(g[1], &n)
		if n > 0 {
			return n
		}
	}
	return 1
}

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
	var pendiente *string
	var humanoReciente bool
	err = s.pool.QueryRow(ctx, `
		select c.bot_estado, c.bot_fallos, c.bot_consulta, c.bot_pendiente::text,
			exists (select 1 from whatsapp_mensajes m where m.conversacion_id = c.id and m.direccion = 'saliente'
				and coalesce(m.origen, '') in ('panel', 'telefono') and m.ocurrido_at > now() - interval '12 hours')
		  from whatsapp_conversaciones c where c.id = $1`, convID).Scan(&estado, &fallos, &consulta, &pendiente, &humanoReciente)
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
	if pendiente != nil {
		var p Presupuestar
		if json.Unmarshal([]byte(*pendiente), &p) == nil && p.Slug != "" {
			est.Pendiente = &p
		}
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

	var avisoPresupuesto *push.Aviso
	if r.Cortar != nil && s.cortar != nil {
		texto, aviso, err := s.consultaDeCorte(ctx, convID, *r.Cortar, d.Sitio, r.Texto)
		if err != nil {
			s.log.Warn("el bot no pudo guardar el corte", "error", err)
		} else {
			r.Texto, avisoPresupuesto = texto, aviso
		}
	}
	if r.Presupuestar != nil {
		texto, consulta, aviso, err := s.presupuestar(ctx, convID, waJid, *r.Presupuestar)
		if err != nil {
			return err
		}
		switch {
		case aviso != nil:
			r.Texto, avisoPresupuesto = texto, aviso
		case texto != "":
			// Falta la medida: queda pendiente hasta la respuesta.
			r.Texto, r.Estado.Consulta, r.Estado.Pendiente = texto, consulta, r.Presupuestar
		default:
			// Sin precio cargado o sin ficha: lo resuelve una persona.
			r = derivar(r, d, r.Presupuestar.Texto)
		}
	}

	if r.Derivar {
		_, err = s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_estado = 'derivada', bot_derivada_at = now(), bot_fallos = 0, bot_pendiente = null where id = $1`, convID)
	} else {
		var c *string
		if r.Estado.Consulta != "" {
			c = &r.Estado.Consulta
		}
		var p *string
		if r.Estado.Pendiente != nil {
			b, _ := json.Marshal(r.Estado.Pendiente)
			j := string(b)
			p = &j
		}
		_, err = s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_fallos = $2, bot_consulta = $3, bot_pendiente = $4::jsonb where id = $1`, convID, r.Estado.Fallos, c, p)
	}
	if err != nil {
		return err
	}
	if _, err := s.EnviarYRegistrar(ctx, Envio{ConversacionID: convID, WaJid: waJid, Mensaje: Saliente{Tipo: "texto", Cuerpo: r.Texto},
		Registro: Registro{Cuerpo: r.Texto}, Origen: "bot"}); err != nil {
		return err
	}
	if avisoPresupuesto != nil {
		s.avisar(ctx, *avisoPresupuesto)
	}
	if r.Derivar {
		s.avisar(ctx, push.Aviso{Titulo: "WhatsApp: pasa a una persona", Cuerpo: cortarJS(texto, 140),
			URL: "/admin/whatsapp?chat=" + convID, Etiqueta: "whatsapp-" + convID, Pantalla: "/admin/whatsapp"})
	}
	return nil
}

// ReactivarBot le devuelve la conversación al bot.
func (s *Servicio) ReactivarBot(ctx context.Context, convID string) error {
	_, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_estado = 'activo', bot_fallos = 0, bot_derivada_at = null, bot_pendiente = null where id = $1`, convID)
	return err
}

// presupuestar elige la medida y arma el presupuesto en revisión. Devuelve:
//   - el texto y el aviso, si lo armó;
//   - solo el texto (y la consulta para seguir) si falta saber la medida;
//   - nada, si no se puede: sin ficha o sin precio, lo ve una persona.
func (s *Servicio) presupuestar(ctx context.Context, convID, waJid string, p Presupuestar) (string, string, *push.Aviso, error) {
	if s.ficha == nil {
		return "", "", nil, nil
	}
	f, err := s.ficha(ctx, p.Slug)
	if err != nil || f == nil {
		return "", "", nil, err
	}
	vs := elegirVariantes(f.Variantes, p.Medida)
	if len(vs) == 0 {
		vs = f.Variantes
	}
	if len(vs) > 1 {
		var ms []string
		for _, v := range vs {
			if len(ms) == 6 {
				break
			}
			ms = append(ms, "• "+v.Label)
		}
		return fmt.Sprintf("¿En qué medida querés el *%s*?\n%s", f.Nombre, strings.Join(ms, "\n")), asistente.ConsultaLimpia(f.Nombre), nil, nil
	}
	if len(vs) == 0 || vs[0].Precio == "" {
		return "", "", nil, nil
	}
	v := vs[0]

	var nombre, telefono string
	var clienteID, sucursalID *string
	if err := s.pool.QueryRow(ctx, `
		select coalesce(cu.nombre, c.display_name, 'Cliente de WhatsApp'), c.customer_id, c.branch_id
		  from whatsapp_conversaciones c left join customers cu on cu.id = c.customer_id where c.id = $1`, convID).Scan(&nombre, &clienteID, &sucursalID); err != nil {
		return "", "", nil, err
	}
	telefono = "+" + soloDigitos(waJid)
	var variante *string
	if v.ID != "" {
		variante = &v.ID
	}
	descripcion := strings.TrimSpace(f.Nombre + " " + v.Label)
	ahora := s.ahora()
	var id, numero string
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", "", nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if numero, err = numeracion.Presupuesto(ctx, tx, ahora.In(argentina)); err != nil {
		return "", "", nil, err
	}
	if err := tx.QueryRow(ctx, `
		insert into quotes (numero, customer_id, contacto_nombre, contacto_telefono, branch_id, estado, origen,
		                    subtotal, total, notas, asesor, valido_hasta)
		values ($1, $2, $3, $4, $5, 'revision', 'whatsapp', round($6::numeric * $7::numeric, 2), round($6::numeric * $7::numeric, 2),
		        $8, 'Bot de WhatsApp', $9)
		returning id`, numero, clienteID, nombre, telefono, sucursalID, v.Precio, p.Cantidad,
		"Pedido por WhatsApp: «"+cortarJS(trimJS(p.Texto), 300)+"»", ahora.UTC().AddDate(0, 0, 7)).Scan(&id); err != nil {
		return "", "", nil, err
	}
	if _, err := tx.Exec(ctx, `
		insert into quote_items (quote_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, orden)
		values ($1, $2, $3, $4, $5::numeric, $6::numeric, round($5::numeric * $6::numeric, 2), 0)`,
		id, variante, descripcion, f.Unidad, p.Cantidad, v.Precio); err != nil {
		return "", "", nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", nil, err
	}
	cant := strconv.FormatFloat(p.Cantidad, 'f', -1, 64)
	texto := fmt.Sprintf("Listo: te armo el presupuesto de *%s × %s*. Una persona lo revisa y te lo manda por acá en un rato.", cant, descripcion)
	aviso := &push.Aviso{Titulo: "Presupuesto " + numero + " por WhatsApp", Cuerpo: nombre + ": " + cant + " × " + descripcion + ". Revisalo y mandalo.",
		URL: "/admin/presupuestos/" + id, Etiqueta: "presupuesto-" + id, Pantalla: "/admin/presupuestos"}
	return texto, "", aviso, nil
}

// elegirVariantes deja las medidas que coinciden con lo que dijeron.
func elegirVariantes(vs []VarianteBot, m asistente.Medida) []VarianteBot {
	if m.EspesorMm == 0 && m.LargoMm == 0 {
		return vs
	}
	var quedan []VarianteBot
	for _, v := range vs {
		if m.EspesorMm != 0 && v.EspesorMm != m.EspesorMm {
			continue
		}
		if m.LargoMm != 0 && !((v.LargoMm == m.LargoMm && v.AnchoMm == m.AnchoMm) || (v.LargoMm == m.AnchoMm && v.AnchoMm == m.LargoMm)) {
			continue
		}
		quedan = append(quedan, v)
	}
	return quedan
}

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// consultaDeCorte guarda el despiece como consulta de corte. Si no reconoce la
// placa, deja el texto con el link al cortador; si una pieza no entra, lo dice.
func (s *Servicio) consultaDeCorte(ctx context.Context, convID string, d asistente.Despiece, sitio, textoSinConsulta string) (string, *push.Aviso, error) {
	token, placa, motivo, err := s.cortar(ctx, d)
	if err != nil {
		return "", nil, err
	}
	sitio = strings.TrimRight(sitio, "/")
	if motivo != "" {
		return motivo + "\n\nPodés corregirlo en el cortador:\n" + sitio + asistente.EnlaceDelDespiece(d), nil, nil
	}
	if token == "" {
		return textoSinConsulta, nil, nil
	}
	n := 0
	for _, p := range d.Piezas {
		n += p.Cantidad
	}
	enlace := sitio + "/corte/c/" + token
	texto := fmt.Sprintf("Te armé el corte: %d %s en *%s*. Ya lo tiene el aserradero: te confirmamos precio y entrega por acá.\n\nEl plano:\n%s",
		n, plural(n, "pieza", "piezas"), placa, enlace)
	var nombre string
	_ = s.pool.QueryRow(ctx, `select coalesce(cu.nombre, c.display_name, 'Cliente de WhatsApp') from whatsapp_conversaciones c
		left join customers cu on cu.id = c.customer_id where c.id = $1`, convID).Scan(&nombre)
	aviso := &push.Aviso{Titulo: "Corte por WhatsApp", Cuerpo: fmt.Sprintf("%s: %d %s en %s. Confirmale precio y entrega.", nombre, n, plural(n, "pieza", "piezas"), placa),
		URL: "/corte/c/" + token, Etiqueta: "corte-" + token, Pantalla: "/admin/cortes"}
	return texto, aviso, nil
}
