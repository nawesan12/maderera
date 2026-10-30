package notificaciones

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/avisos"
	"mjbj/internal/email"
	"mjbj/internal/entregas"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/pdf"
	"mjbj/internal/push"
	"mjbj/internal/whatsapp"
)

// Los avisos de pedidos, pagos, presupuestos y entregas
// (lib/notificaciones/{avisos,presupuestos,entregas}.ts). Los encola Go en
// la misma transacción que confirma (la compra, el avance del pedido, el
// pago acreditado, el presupuesto pedido o enviado, el remito preparado o firmado) y
// los atiende el worker: lo que antes hacía Next en el after() de la acción.

// medios son los nombres de MEDIOS de lib/notificaciones/avisos.ts (el
// débito no estaba: sale «A coordinar», como en el TS).
var medios = map[string]string{
	"mercado_pago":     "Mercado Pago",
	"transferencia":    "Transferencia bancaria",
	"efectivo":         "Efectivo",
	"cuenta_corriente": "Cuenta corriente",
	"cheque":           "Cheque",
}

func vacio(p *string) bool { return p == nil || *p == "" }

func (s *Servicio) alPanel(ctx context.Context, a push.Aviso) {
	if s.panel != nil {
		s.panel.Avisar(ctx, a)
	}
}

// PedidoRecibido es notificarPedidoRecibido: el aviso al panel (sale
// aunque el comprador no haya dejado correo), el WhatsApp y el acuse por
// correo con el detalle.
func (s *Servicio) PedidoRecibido(ctx context.Context, id string) error {
	var numero, token, nombre, total, tipoEntrega string
	var correo, zona, medio *string
	err := s.pool.QueryRow(ctx, `SELECT numero, public_token::text, contacto_nombre, contacto_email, total::text, tipo_entrega::text,
		zona_envio, medio_pago::text FROM orders WHERE id = $1`, id).
		Scan(&numero, &token, &nombre, &correo, &total, &tipoEntrega, &zona, &medio)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// Primero al negocio: es el que tiene que salir a preparar el pedido.
	cuerpo := nombre + " · " + formato.MonedaEntera(jsmath.Numero(total)) + " · retira"
	if tipoEntrega == "envio" {
		cuerpo = nombre + " · " + formato.MonedaEntera(jsmath.Numero(total)) + " · con envío"
	}
	s.alPanel(ctx, push.Aviso{Titulo: "Venta nueva · " + numero, Cuerpo: cuerpo, URL: "/admin/pedidos/" + id, Etiqueta: "venta_ecommerce"})
	s.wa.AvisarCambioDePedido(ctx, id, "pedido_recibido")
	if vacio(correo) {
		return nil
	}
	filas, err := s.pool.Query(ctx, `SELECT descripcion, cantidad::text, unidad, subtotal::text FROM order_items WHERE order_id = $1 ORDER BY orden`, id)
	if err != nil {
		return err
	}
	var lineas []email.LineaCorreo
	for filas.Next() {
		var desc, cant, unidad, sub string
		if err := filas.Scan(&desc, &cant, &unidad, &sub); err != nil {
			filas.Close()
			return err
		}
		lineas = append(lineas, avisos.LineaDeCorreo(desc, jsmath.Numero(cant), &unidad, &sub))
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return err
	}
	entrega := "Envío"
	if tipoEntrega == "retiro" {
		entrega = "Retiro en sucursal"
	} else if !vacio(zona) {
		entrega += " · " + *zona
	}
	medioPago := "A coordinar"
	if medio != nil {
		if m, ok := medios[*medio]; ok {
			medioPago = m
		}
	}
	s.correo.Despachar(ctx, avisos.Despacho{
		Evento: "pedido_recibido", Para: *correo, EntidadTipo: "order", EntidadID: id,
		Correo: avisos.PedidoRecibido(s.sitio, primerNombre(nombre), numero, token, jsmath.Numero(total), entrega, medioPago, lineas),
	})
	return nil
}

// CambioDeEstado es avisarCambioDePedido + notificarCambioDeEstado: el
// WhatsApp y el correo de un pedido que avanzó. El evento es el estado.
func (s *Servicio) CambioDeEstado(ctx context.Context, id, estado string) error {
	s.wa.AvisarCambioDePedido(ctx, id, estado)
	var numero, token, nombre string
	var correo *string
	err := s.pool.QueryRow(ctx, `SELECT numero, public_token::text, contacto_nombre, contacto_email FROM orders WHERE id = $1`, id).
		Scan(&numero, &token, &nombre, &correo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if vacio(correo) {
		return nil
	}
	var asunto string
	var encabezado *string
	err = s.pool.QueryRow(ctx, `SELECT asunto, encabezado FROM email_avisos WHERE evento = $1 LIMIT 1`, estado).Scan(&asunto, &encabezado)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	enc := ""
	if encabezado != nil {
		enc = *encabezado
	}
	s.correo.Despachar(ctx, avisos.Despacho{
		Evento: estado, Para: *correo, EntidadTipo: "order", EntidadID: id,
		Correo: avisos.PedidoCambioDeEstado(s.sitio, primerNombre(nombre), numero, token, estado, asunto, enc),
	})
	return nil
}

// CargaResultadoDePago es lo que encola pagos al acreditar.
type CargaResultadoDePago struct {
	OrderID    *string `json:"orderId"`
	CustomerID *string `json:"customerId"`
	Tipo       string  `json:"tipo"`
	Detalle    string  `json:"detalle"`
	ReceiptID  *string `json:"receiptId"`
}

// pagoDe es el cobro que se muestra en el correo. El TS tomaba cualquiera
// (`limit 1` sin orden): con un intento rechazado antes del aprobado, o con
// varios pagos de la cuenta, el importe y el medio podían ser de otro. Va el
// aprobado más reciente.
func (s *Servicio) pagoDe(ctx context.Context, columna, id string) (medio, monto *string, err error) {
	err = s.pool.QueryRow(ctx, `SELECT medio, monto::text FROM payments WHERE `+columna+` = $1
		ORDER BY (estado = 'aprobado') DESC, acreditado_at DESC NULLS LAST, created_at DESC LIMIT 1`, id).Scan(&medio, &monto)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	return medio, monto, err
}

// ResultadoDePago es notificarResultadoDePago: el aviso de un pago
// acreditado. Una inscripción tiene su propio correo (con la fecha y el
// lugar); un pedido avisa al panel y al cliente; un pago de deuda manda el
// recibo.
func (s *Servicio) ResultadoDePago(ctx context.Context, c CargaResultadoDePago) error {
	if c.Detalle != "aprobado" {
		return nil
	}
	if c.Tipo == "inscripcion" {
		if c.CustomerID != nil && s.eventos != nil {
			s.eventos.AvisarInscripcionPorPago(ctx, *c.CustomerID)
		}
		return nil
	}
	if c.OrderID != nil {
		id := *c.OrderID
		var numero, token, nombre, total string
		var correo *string
		err := s.pool.QueryRow(ctx, `SELECT numero, public_token::text, contacto_nombre, contacto_email, total::text FROM orders WHERE id = $1`, id).
			Scan(&numero, &token, &nombre, &correo, &total)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		// Una cosa es que entre el pedido y otra que la plata esté: es lo
		// que habilita a preparar y entregar.
		s.alPanel(ctx, push.Aviso{Titulo: "Pago acreditado · " + numero, Cuerpo: nombre + " · " + formato.MonedaEntera(jsmath.Numero(total)),
			URL: "/admin/pedidos/" + id, Etiqueta: "pago_acreditado"})
		if vacio(correo) {
			return nil
		}
		medio, monto, err := s.pagoDe(ctx, "order_id", id)
		if err != nil {
			return err
		}
		if monto == nil {
			monto = &total
		}
		m := ""
		if medio != nil {
			m = *medio
		}
		s.correo.Despachar(ctx, avisos.Despacho{
			Evento: "pago_acreditado", Para: *correo, EntidadTipo: "order", EntidadID: id,
			Correo: avisos.PagoAcreditado(s.sitio, primerNombre(nombre), jsmath.Numero(*monto), m, numero, token, false),
		})
		return nil
	}
	// Un pago de deuda con recibo manda el recibo: es el mismo aviso, con
	// el papel adjunto.
	if c.ReceiptID != nil {
		return s.Recibo(ctx, *c.ReceiptID)
	}
	if c.CustomerID == nil {
		return nil
	}
	cl, err := s.cliente(ctx, *c.CustomerID)
	if err != nil || cl == nil || vacio(cl.email) {
		return err
	}
	medio, monto, err := s.pagoDe(ctx, "customer_id", *c.CustomerID)
	if err != nil {
		return err
	}
	importe := 0.0
	if monto != nil {
		importe = jsmath.Numero(*monto)
	}
	m := ""
	if medio != nil {
		m = *medio
	}
	s.correo.Despachar(ctx, avisos.Despacho{
		Evento: "pago_acreditado", Para: *cl.email, EntidadTipo: "customer", EntidadID: *c.CustomerID,
		Correo: avisos.PagoAcreditado(s.sitio, primerNombre(cl.nombre), importe, m, "Cuenta corriente", "", true),
	})
	return nil
}

// PresupuestoRecibido es notificarPresupuestoRecibido: el acuse de un
// pedido de presupuesto del sitio.
func (s *Servicio) PresupuestoRecibido(ctx context.Context, id string) error {
	var numero, nombre, origen string
	var correo *string
	var responde *time.Time
	err := s.pool.QueryRow(ctx, `SELECT numero, contacto_nombre, contacto_email, origen::text, responde_hasta FROM quotes WHERE id = $1`, id).
		Scan(&numero, &nombre, &correo, &origen, &responde)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil || vacio(correo) {
		return err
	}
	s.correo.Despachar(ctx, avisos.Despacho{
		Evento: "presupuesto_recibido", Para: *correo, EntidadTipo: "quote", EntidadID: id,
		Correo: avisos.PresupuestoRecibido(s.sitio, primerNombre(nombre), numero, origen == "express", responde),
	})
	return nil
}

// PresupuestoEnviado es notificarPresupuestoEnviado (98a7443^), que nadie
// llamaba: el presupuesto armado, por WhatsApp con el PDF (el mismo que se
// descarga del panel) y por correo con el detalle. Uno no depende del otro:
// hay quien solo tiene teléfono. Si cuando lo atiende el worker el
// presupuesto ya no está «enviado» (lo volvieron atrás), no sale.
//
// El teléfono y el correo del presupuesto mandan; si no tiene, los de la
// ficha del cliente (el TS solo miraba los del presupuesto, y el del
// mostrador no guarda correo).
func (s *Servicio) PresupuestoEnviado(ctx context.Context, id string) error {
	p, err := s.pedidos.Presupuesto(ctx, id)
	if err != nil || p == nil || p.Estado != "enviado" {
		return err
	}
	var telCliente, correoCliente *string
	if p.CustomerID != nil {
		c, err := s.cliente(ctx, *p.CustomerID)
		if err != nil {
			return err
		}
		if c != nil {
			telCliente, correoCliente = c.telefono, c.email
		}
	}
	telefono := p.Telefono
	if vacio(telefono) {
		telefono = telCliente
	}
	total := jsmath.Numero(p.Total)
	vence := "consultar"
	if p.ValidoHasta != nil {
		vence = whatsapp.FechaCorta(*p.ValidoHasta)
	}
	aviso := whatsapp.OpcionesAviso{
		Evento: "presupuesto_listo", Telefono: telefono, Nombre: &p.Cliente,
		Valores:      map[string]string{"presupuesto": p.Numero, "total": whatsapp.Moneda(total), "vence": vence},
		Entidad:      &whatsapp.Entidad{Tipo: "quote", ID: id},
		ConDocumento: true,
	}
	// El PDF se arma solo si el WhatsApp va a salir (apagado, sin teléfono
	// o con la baja pedida, no hace falta): como el `documento: () => …`.
	if r := s.wa.AvisarPorWhatsapp(ctx, aviso); r.Estado == "falta-documento" {
		archivo, err := s.pedidos.PresupuestoPdf(ctx, p)
		if err != nil {
			return err
		}
		aviso.Documento = &whatsapp.Documento{Contenido: archivo, Nombre: p.Numero + ".pdf"}
		s.wa.AvisarPorWhatsapp(ctx, aviso)
	}

	correo := p.Email
	if vacio(correo) {
		correo = correoCliente
	}
	if vacio(correo) {
		return nil
	}
	var lineas []email.LineaCorreo
	for _, it := range p.Items {
		unidad, sub := it.Unidad, it.Subtotal
		lineas = append(lineas, avisos.LineaDeCorreo(it.Descripcion, jsmath.Numero(it.Cantidad), &unidad, &sub))
	}
	s.correo.Despachar(ctx, avisos.Despacho{
		Evento: "presupuesto_listo", Para: *correo, EntidadTipo: "quote", EntidadID: id,
		Correo: avisos.PresupuestoListo(s.sitio, primerNombre(p.Cliente), p.Numero, total, p.ValidoHasta, lineas),
	})
	return nil
}

// RemitoParaFirmar es notificarRemitoParaFirmar: el enlace para firmar
// desde el celular.
func (s *Servicio) RemitoParaFirmar(ctx context.Context, id string) error {
	d, err := s.entregas.DatosParaAvisar(ctx, id)
	if errors.Is(err, entregas.ErrNoEsta) {
		return nil
	}
	if err != nil || vacio(d.FirmaToken) || vacio(d.Email) {
		return err
	}
	s.correo.Despachar(ctx, avisos.Despacho{
		Evento: "remito_para_firmar", Para: *d.Email, EntidadTipo: "delivery", EntidadID: id,
		Correo: avisos.PedidoParaFirmar(s.sitio, primerNombre(d.Nombre), d.PedidoNumero, d.Numero, strings.TrimSuffix(s.sitio, "/")+"/firmar/"+*d.FirmaToken),
	})
	return nil
}

// RemitoFirmado es notificarRemitoFirmado: la constancia de lo que se
// retiró, con la fecha de la firma en hora argentina.
func (s *Servicio) RemitoFirmado(ctx context.Context, id string) error {
	r, err := s.entregas.RemitoCompleto(ctx, id)
	if errors.Is(err, entregas.ErrNoEsta) {
		return nil
	}
	if err != nil {
		return err
	}
	d, err := s.entregas.DatosParaAvisar(ctx, id)
	if errors.Is(err, entregas.ErrNoEsta) {
		return nil
	}
	if err != nil {
		return err
	}
	// `pedido.email ?? pedido.emailCliente`: el del pedido manda, aunque
	// esté vacío.
	correo := d.Email
	if correo == nil {
		correo = d.EmailCliente
	}
	if vacio(correo) {
		return nil
	}
	firmado := timeNow()
	if r.FirmadoAt != nil {
		firmado = *r.FirmadoAt
	}
	var lineas []email.LineaCorreo
	for _, l := range r.Lineas {
		unidad := l.Unidad
		lineas = append(lineas, avisos.LineaDeCorreo(l.Descripcion, l.Cantidad, &unidad, nil))
	}
	s.correo.Despachar(ctx, avisos.Despacho{
		Evento: "remito_firmado", Para: *correo, EntidadTipo: "delivery", EntidadID: id,
		Correo: avisos.RemitoFirmado(s.sitio, primerNombre(d.Nombre), r.Numero, r.PedidoNumero, pdf.FechaHora(firmado), lineas,
			d.EstadoPedido != "entregado"),
	})
	return nil
}
