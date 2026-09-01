/**
 * Etiquetas de los eventos de aviso.
 *
 * Va en su propio módulo, sin `server-only`, porque la pantalla de
 * configuración es un componente de cliente y necesita los mismos textos que
 * usa la siembra del lado del servidor.
 */

export const TITULOS_EVENTO: Record<
  string,
  { titulo: string; cuando: string }
> = {
  pedido_recibido: {
    titulo: "Cuando entra un pedido",
    cuando:
      "La confirmación con el detalle y el número. Es el correo que reemplaza al llamado de «¿me llegó el pedido?».",
  },
  pago_acreditado: {
    titulo: "Cuando se acredita un pago",
    cuando:
      "Sale al aprobarse en Mercado Pago o al conciliar una transferencia.",
  },
  preparando: {
    titulo: "Cuando se empieza a preparar",
    cuando: "Apenas alguien mueve el pedido a Preparando.",
  },
  listo: {
    titulo: "Cuando queda listo",
    cuando: "El que más consultas evita: el cliente sabe cuándo venir.",
  },
  "en-camino": {
    titulo: "Cuando sale el flete",
    cuando: "Solo en pedidos con envío.",
  },
  entregado: {
    titulo: "Cuando se entrega",
    cuando: "Cierra el círculo.",
  },
  factura_emitida: {
    titulo: "Cuando se emite un comprobante",
    cuando: "Va con el PDF adjunto. Lo pide la cláusula 1.6 del contrato.",
  },
  presupuesto_listo: {
    titulo: "Cuando se manda un presupuesto",
    cuando: "Con el detalle y el link para aceptarlo desde el portal.",
  },
  remito_firmado: {
    titulo: "Cuando se firma un remito",
    cuando: "La constancia de lo que se retiró y lo que queda en acopio.",
  },
  remito_para_firmar: {
    titulo: "Cuando se prepara un remito",
    cuando: "El link para firmar desde el celular, antes de venir a retirar.",
  },
  presupuesto_recibido: {
    titulo: "Cuando entra un pedido de presupuesto",
    cuando:
      "El acuse. Es lo que evita el llamado de «¿les llegó lo que mandé?».",
  },
  solicitud_profesional: {
    titulo: "Cuando alguien pide acceso profesional",
    cuando: "El acuse, con el plazo de respuesta de 24 horas hábiles.",
  },
  profesional_aprobado: {
    titulo: "Cuando se aprueba el acceso profesional",
    cuando: "La bienvenida, con la lista de precios y el límite asignados.",
  },
  profesional_rechazado: {
    titulo: "Cuando se rechaza el acceso profesional",
    cuando: "Con el motivo que se escribió al rechazarla.",
  },
  inscripcion_evento: {
    titulo: "Cuando alguien se anota a un evento",
    cuando: "Con la fecha, el lugar y el costo.",
  },
  recordatorio_evento: {
    titulo: "El día antes de un evento",
    cuando:
      "En una capacitación gratuita, es la diferencia entre media sala y una sala.",
  },
};

/**
 * Orden en que se muestran los avisos: el del ciclo de vida de un pedido.
 *
 * Alfabético dejaba "cuando sale el flete" arriba de todo y "cuando entra un
 * pedido" en el medio, que es exactamente al revés de cómo pasan las cosas.
 */
export const ORDEN_EVENTOS = [
  "presupuesto_recibido",
  "presupuesto_listo",
  "pedido_recibido",
  "pago_acreditado",
  "preparando",
  "listo",
  "remito_para_firmar",
  "en-camino",
  "entregado",
  "remito_firmado",
  "factura_emitida",
  "solicitud_profesional",
  "profesional_aprobado",
  "profesional_rechazado",
  "inscripcion_evento",
  "recordatorio_evento",
];

export function posicionDelEvento(evento: string): number {
  const i = ORDEN_EVENTOS.indexOf(evento);
  return i === -1 ? ORDEN_EVENTOS.length : i;
}
