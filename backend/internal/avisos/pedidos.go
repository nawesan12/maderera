package avisos

import (
	"time"

	"mjbj/internal/email"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/pdf"
)

// LineaDeCorreo es un renglón de la base listo para el correo: la cantidad
// como la escribe JS (`${Number(cantidad)}`) y el importe, la tira de la
// columna numeric (nil: sin importe, el remito).
func LineaDeCorreo(descripcion string, cantidad float64, unidad, importe *string) email.LineaCorreo {
	l := email.LineaCorreo{Descripcion: descripcion, Cantidad: jsmath.Texto(cantidad)}
	if unidad != nil {
		l.Unidad = *unidad
	}
	if importe != nil {
		v := jsmath.Numero(*importe)
		l.Importe = &v
	}
	return l
}

// Las plantillas de los avisos de pedidos, pagos, presupuestos y entregas
// (lib/email/plantillas.ts: pedidoRecibido, pedidoCambioDeEstado,
// pagoAcreditado, pedidoParaFirmar, remitoFirmado, y el acuse del
// presupuesto de lib/notificaciones/presupuestos.ts), comparadas con el TS en
// el golden de avisos (testdata/golden/avisos/pedidos.json).

// encodeURIComponent de JS (el mismo de internal/pagos, que no se puede
// importar desde acá: pagos depende de avisos).
func encodeURIComponent(s string) string {
	const hex = "0123456789ABCDEF"
	var b []byte
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9',
			c == '-', c == '_', c == '.', c == '!', c == '~', c == '*', c == '\'', c == '(', c == ')':
			b = append(b, c)
		default:
			b = append(b, '%', hex[c>>4], hex[c&15])
		}
	}
	return string(b)
}

// URLDelPedido es el enlace de seguimiento absoluto (urlAbsolutaDelPedido):
// en un correo no sirve uno relativo. El token es lo que autoriza.
func URLDelPedido(sitio, numero, token string) string {
	return base(sitio) + "/pedido/" + encodeURIComponent(numero) + "?t=" + token
}

// PedidoRecibido es el acuse de una compra del sitio.
func PedidoRecibido(sitio, nombre, numero, token string, total float64, entrega, medioPago string, lineas []email.LineaCorreo) Correo {
	return armar(sitio, "Pedido "+numero+" recibido", email.Opciones{
		Titulo:   "Recibimos tu pedido " + numero,
		Adelanto: "Tu pedido " + numero + " quedó registrado.",
		Saludo:   nombre,
		Parrafos: []string{"Ya lo tenemos. Lo estamos preparando y te vamos a ir avisando en cada paso."},
		Datos: []email.Bloque{{Etiqueta: "Número de pedido", Valor: numero}, {Etiqueta: "Entrega", Valor: entrega},
			{Etiqueta: "Medio de pago", Valor: medioPago}},
		Lineas: lineas,
		Total:  &total,
		CTA:    &email.Enlace{Texto: "Ver el pedido", URL: URLDelPedido(sitio, numero, token)},
		Cierre: "Si algo no coincide, contestá este correo o escribinos por WhatsApp y lo corregimos antes de preparar la mercadería.",
	})
}

type tituloDeEstado struct{ titulo, texto string }

var titulosDeEstado = map[string]tituloDeEstado{
	"preparando": {"Estamos preparando tu pedido", "Ya lo estamos armando en el depósito."},
	"listo":      {"Tu pedido está listo", "Podés pasar a retirarlo en el horario de atención: lunes a viernes de 8 a 16, sábados de 8 a 12."},
	"en-camino":  {"Tu pedido salió para la entrega", "Va en camino a la dirección que nos diste."},
	"entregado":  {"Tu pedido fue entregado", "Gracias por comprar en Maderera Juan B. Justo."},
	"cancelado":  {"Tu pedido fue cancelado", "Si esto no era lo que esperabas, escribinos y lo revisamos: puede haber sido un error nuestro."},
}

// PedidoCambioDeEstado es el aviso de un pedido que avanzó. El asunto y el
// encabezado editados en /admin/avisos mandan (vacío: el de siempre).
func PedidoCambioDeEstado(sitio, nombre, numero, token, estado, asuntoPersonalizado, encabezadoPersonalizado string) Correo {
	b, ok := titulosDeEstado[estado]
	if !ok {
		b = tituloDeEstado{"Novedades de tu pedido " + numero, "Tu pedido pasó a estado " + estado + "."}
	}
	titulo := encabezadoPersonalizado
	if titulo == "" {
		titulo = b.titulo
	}
	asunto := asuntoPersonalizado
	if asunto == "" {
		asunto = b.titulo + " · " + numero
	}
	return armar(sitio, asunto, email.Opciones{
		Titulo:   titulo,
		Adelanto: b.texto,
		Saludo:   nombre,
		Parrafos: []string{b.texto},
		Datos:    []email.Bloque{{Etiqueta: "Número de pedido", Valor: numero}},
		CTA:      &email.Enlace{Texto: "Ver el pedido", URL: URLDelPedido(sitio, numero, token)},
	})
}

// PagoAcreditado es el aviso de un pago de un pedido (o de una deuda sin
// recibo). medio vacío no se muestra; token vacío lleva a la cuenta.
func PagoAcreditado(sitio, nombre string, monto float64, medio, referencia, token string, esDeuda bool) Correo {
	parrafo := "Tu pedido queda confirmado y pasa a preparación."
	if esDeuda {
		parrafo = "Lo imputamos a tu cuenta corriente. El saldo ya está actualizado."
	}
	datos := []email.Bloque{{Etiqueta: "Importe", Valor: formato.Precio(monto)}}
	if medio != "" {
		datos = append(datos, email.Bloque{Etiqueta: "Medio", Valor: medio})
	}
	datos = append(datos, email.Bloque{Etiqueta: "Referencia", Valor: referencia})
	cta := &email.Enlace{Texto: "Ver mi cuenta", URL: base(sitio) + "/mi-cuenta/cuenta-corriente"}
	if !esDeuda && token != "" {
		cta = &email.Enlace{Texto: "Ver el pedido", URL: URLDelPedido(sitio, referencia, token)}
	}
	return armar(sitio, "Pago recibido · "+formato.Precio(monto), email.Opciones{
		Titulo:   "Recibimos tu pago",
		Adelanto: "Acreditamos " + formato.Precio(monto) + ".",
		Saludo:   nombre,
		Parrafos: []string{parrafo},
		Datos:    datos,
		CTA:      cta,
	})
}

// PresupuestoRecibido es el acuse de un pedido de presupuesto del sitio.
// La hora de respuesta va en hora argentina (el TS la daba en la zona del
// servidor, que en producción es UTC).
func PresupuestoRecibido(sitio, nombre, numero string, express bool, respondeHasta *time.Time) Correo {
	parrafo := "Lo estamos armando y te contestamos a la brevedad."
	if express {
		parrafo = "Como sos cliente profesional, entra por la cola express: te contestamos dentro de las 24 horas hábiles."
	}
	datos := []email.Bloque{{Etiqueta: "Número", Valor: numero}}
	if respondeHasta != nil {
		datos = append(datos, email.Bloque{Etiqueta: "Te contestamos antes de", Valor: pdf.FechaHora(*respondeHasta)})
	}
	return armar(sitio, "Pedido de presupuesto "+numero, email.Opciones{
		Titulo:   "Recibimos tu pedido de presupuesto",
		Adelanto: "Estamos armando el presupuesto " + numero + ".",
		Saludo:   nombre,
		Parrafos: []string{parrafo},
		Datos:    datos,
		Cierre:   "Si necesitás agregar o cambiar algo, contestá este correo y lo ajustamos antes de cotizarlo.",
	})
}

// PedidoParaFirmar le manda al cliente el enlace para firmar el remito
// desde el celular.
func PedidoParaFirmar(sitio, nombre, numero, remito, url string) Correo {
	return armar(sitio, "Remito "+remito+" para firmar", email.Opciones{
		Titulo:   "Firmá el remito " + remito,
		Adelanto: "Confirmá desde el celular lo que estás retirando.",
		Saludo:   nombre,
		Parrafos: []string{"Abrí este link desde el celular y firmá con el dedo. Reemplaza al remito en papel."},
		Datos:    []email.Bloque{{Etiqueta: "Remito", Valor: remito}, {Etiqueta: "Pedido", Valor: numero}},
		CTA:      &email.Enlace{Texto: "Firmar ahora", URL: url},
		Cierre:   "El link deja de servir una vez firmado.",
	})
}

// RemitoFirmado es la constancia de lo que se retiró. Las líneas van sin
// importe: un remito es constancia de entrega, no de venta.
func RemitoFirmado(sitio, nombre, remito, numero, fecha string, lineas []email.LineaCorreo, pendiente bool) Correo {
	segundo := "Con esto queda entregado el pedido completo."
	if pendiente {
		segundo = "Todavía te queda mercadería en acopio. La podés retirar cuando quieras."
	}
	return armar(sitio, "Entrega "+remito+" · pedido "+numero, email.Opciones{
		Titulo:   "Constancia de entrega " + remito,
		Adelanto: "Retiraste mercadería del pedido " + numero + ".",
		Saludo:   nombre,
		Parrafos: []string{"Esto es lo que salió, con tu firma registrada.", segundo},
		Datos: []email.Bloque{{Etiqueta: "Remito", Valor: remito}, {Etiqueta: "Pedido", Valor: numero},
			{Etiqueta: "Fecha", Valor: fecha}},
		Lineas: lineas,
		CTA:    &email.Enlace{Texto: "Ver el pedido", URL: base(sitio) + "/mi-cuenta/pedidos/" + numero},
	})
}
