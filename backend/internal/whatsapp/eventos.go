package whatsapp

// EventoAviso es un aviso automático que existe, con su plantilla y su texto
// para dentro de la ventana (EVENTOS_WHATSAPP de lib/whatsapp/avisos.ts).
type EventoAviso struct {
	Evento     string `json:"evento"`
	Titulo     string `json:"titulo"`
	Cuando     string `json:"cuando"`
	Plantilla  string `json:"plantilla"`
	TextoLibre string `json:"textoLibre"`
}

// EventosWhatsapp son los avisos automáticos. Nacen apagados: cada uno se cobra.
var EventosWhatsapp = []EventoAviso{
	{"pedido_recibido", "Cuando entra un pedido por la web", "Confirma que lo recibimos. El correo ya lo dice; esto es para quien no lo lee.", "pedido_recibido", "Hola {{nombre}}, recibimos tu pedido {{pedido}}. Te avisamos por acá cuando esté listo."},
	{"preparando", "Cuando se empieza a preparar", "Apenas alguien mueve el pedido a Preparando.", "pedido_preparando", "Hola {{nombre}}, ya estamos preparando tu pedido {{pedido}}. Te avisamos apenas esté listo."},
	{"listo", "Cuando queda listo", "El aviso que más consultas evita: el cliente sabe cuándo venir.", "pedido_listo", "Hola {{nombre}}, tu pedido {{pedido}} ya está listo para retirar en {{sucursal}}."},
	{"en-camino", "Cuando sale el flete", "Solo en pedidos con envío.", "pedido_en_camino", "Hola {{nombre}}, tu pedido {{pedido}} salió para la dirección de entrega."},
	{"entregado", "Cuando se entrega", "Cierra el círculo y deja la conversación abierta por si hay algo.", "pedido_entregado", "Hola {{nombre}}, entregamos tu pedido {{pedido}}. Gracias por elegirnos."},
	{"presupuesto_listo", "Cuando se manda un presupuesto", "Sale con el PDF del presupuesto pegado.", "presupuesto_enviado", "Hola {{nombre}}, te mandamos el presupuesto {{presupuesto}} por {{total}}. Vale hasta el {{vence}}."},
	{"recibo_emitido", "Cuando se registra un pago", "Sale con el PDF del recibo y el saldo que le queda.", "recibo_emitido", "Hola {{nombre}}, registramos tu pago de {{importe}}. Te mandamos el recibo {{recibo}}; tu saldo quedó en {{saldo}}."},
	{"cheque_rechazado", "Cuando se rechaza un cheque", "No se tomó o lo rechazó el banco: el importe vuelve a la cuenta.", "cheque_rechazado", "Hola {{nombre}}, el cheque {{cheque}} por {{importe}} no se pudo acreditar ({{motivo}}). El importe volvió a tu cuenta corriente."},
}

// EventoDeAviso es uno por nombre, o nil.
func EventoDeAviso(evento string) *EventoAviso {
	for i := range EventosWhatsapp {
		if EventosWhatsapp[i].Evento == evento {
			return &EventosWhatsapp[i]
		}
	}
	return nil
}
