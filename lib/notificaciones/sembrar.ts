import "server-only";

import { db } from "@/lib/db";
import { avisosEmail } from "@/lib/db/schema";

/**
 * Avisos por correo que el sistema conoce.
 *
 * Se siembran la primera vez que se abre `/admin/avisos`, igual que hace
 * `sembrarAvisos()` con los de WhatsApp. Nacen **encendidos**, al revés que los
 * de WhatsApp: un correo no cuesta plata por mensaje, y el cliente que compró y
 * no recibe ni una confirmación llama por teléfono, que es justo lo que el
 * sistema viene a evitar.
 *
 * El asunto es editable desde el panel porque es lo que se ve en la bandeja
 * antes de abrir, y el negocio va a querer ajustarlo sin pedir un deploy.
 */
const POR_DEFECTO: {
  evento: string;
  asunto: string;
  encabezado: string | null;
}[] = [
  {
    evento: "pedido_recibido",
    asunto: "Recibimos tu pedido",
    encabezado: null,
  },
  {
    evento: "pago_acreditado",
    asunto: "Recibimos tu pago",
    encabezado: null,
  },
  {
    evento: "preparando",
    asunto: "Estamos preparando tu pedido",
    encabezado: "Estamos preparando tu pedido",
  },
  {
    evento: "listo",
    asunto: "Tu pedido está listo para retirar",
    encabezado: "Tu pedido está listo",
  },
  {
    evento: "en-camino",
    asunto: "Tu pedido salió para la entrega",
    encabezado: "Tu pedido salió para la entrega",
  },
  {
    evento: "entregado",
    asunto: "Tu pedido fue entregado",
    encabezado: "Tu pedido fue entregado",
  },
  {
    evento: "factura_emitida",
    asunto: "Tu comprobante",
    encabezado: null,
  },
  {
    evento: "presupuesto_listo",
    asunto: "Tu presupuesto está listo",
    encabezado: null,
  },
  {
    evento: "remito_firmado",
    asunto: "Constancia de entrega",
    encabezado: null,
  },
  {
    evento: "remito_para_firmar",
    asunto: "Firmá el remito de tu retiro",
    encabezado: null,
  },
  {
    evento: "presupuesto_recibido",
    asunto: "Recibimos tu pedido de presupuesto",
    encabezado: null,
  },
  {
    evento: "solicitud_profesional",
    asunto: "Recibimos tu solicitud de acceso profesional",
    encabezado: null,
  },
  {
    evento: "profesional_aprobado",
    asunto: "Tu acceso profesional está activo",
    encabezado: null,
  },
  {
    evento: "profesional_rechazado",
    asunto: "Sobre tu solicitud de acceso profesional",
    encabezado: null,
  },
  {
    evento: "inscripcion_evento",
    asunto: "Quedaste anotado",
    encabezado: null,
  },
  {
    evento: "recordatorio_evento",
    asunto: "Mañana te esperamos",
    encabezado: null,
  },
];

/**
 * Siembra los avisos que falten.
 *
 * Inserta con `onConflictDoNothing` y no con un "si hay alguno, no hago nada":
 * cada vez que el sistema aprende a mandar un aviso nuevo, ese aviso tiene que
 * aparecer en la pantalla de configuración de una instalación que ya venía
 * funcionando. Con el corte de todo-o-nada, los eventos nuevos quedaban
 * invisibles para siempre.
 *
 * Los que ya existen no se tocan: si alguien apagó uno o le cambió el asunto,
 * esa decisión manda.
 */
export async function sembrarAvisosEmail(): Promise<void> {
  await db
    .insert(avisosEmail)
    .values(POR_DEFECTO.map((aviso) => ({ ...aviso, activo: true })))
    .onConflictDoNothing({ target: avisosEmail.evento });
}
