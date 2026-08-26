"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { notificationsLog } from "@/lib/db/schema";
import { proveedorEmail } from "@/lib/email";
import { envolver, escapar } from "@/lib/email/plantillas";

/**
 * La consulta del formulario de contacto.
 *
 * Antes esto no existía: el botón ponía "Mensaje enviado correctamente" y no
 * mandaba nada a ningún lado. Los campos ni siquiera tenían `name`.
 *
 * La regla que gobierna todo el archivo: **solo se confirma lo que salió**. Si
 * el correo no está conectado —hoy no lo está, falta la casilla con dominio
 * verificado— la acción lo dice y ofrece WhatsApp, que sí funciona. Decirle a
 * alguien que su consulta llegó cuando se perdió es peor que no tener
 * formulario.
 */

export interface EstadoConsulta {
  error?: string;
  ok?: string;
  /** Verdadero cuando el envío no está conectado todavía. */
  usarWhatsapp?: boolean;
}

const MOTIVOS = {
  presupuesto: "Pedido de presupuesto",
  stock: "Consulta de stock",
  envio: "Envíos y entregas",
  corte: "Servicio de corte",
  profesional: "Cuenta de profesional",
  otro: "Otra consulta",
} as const;

const esquema = z.object({
  nombre: z.string().trim().min(3, "Escribí tu nombre.").max(120),
  email: z.string().trim().email("Revisá el correo: es por donde te contestamos."),
  telefono: z.string().trim().max(40).optional(),
  motivo: z.enum(
    Object.keys(MOTIVOS) as [keyof typeof MOTIVOS, ...(keyof typeof MOTIVOS)[]],
  ),
  mensaje: z
    .string()
    .trim()
    .min(10, "Contanos un poco más para poder ayudarte.")
    .max(2000),
});

/** A dónde llega la consulta. */
const CASILLA = process.env.EMAIL_CONTACTO ?? "info@mjbj.com.ar";

export async function enviarConsulta(
  _previo: EstadoConsulta,
  datos: FormData,
): Promise<EstadoConsulta> {
  const leido = esquema.safeParse({
    nombre: datos.get("nombre"),
    email: datos.get("email"),
    telefono: datos.get("telefono") || undefined,
    motivo: datos.get("motivo"),
    mensaje: datos.get("mensaje"),
  });

  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const consulta = leido.data;
  const asunto = `${MOTIVOS[consulta.motivo]} — ${consulta.nombre}`;

  const { html, texto } = envolver({
    titulo: "Consulta desde el sitio",
    adelanto: `${consulta.nombre}: ${consulta.mensaje.slice(0, 90)}`,
    saludo: MOTIVOS[consulta.motivo],
    // El mensaje lo escribe cualquiera: se escapa antes de que entre al HTML
    // del correo, y recién ahí se respetan los saltos de línea.
    parrafos: [escapar(consulta.mensaje).replace(/\n/g, "<br>")],
    datos: [
      { etiqueta: "Nombre", valor: consulta.nombre },
      { etiqueta: "Correo", valor: consulta.email },
      ...(consulta.telefono
        ? [{ etiqueta: "Teléfono", valor: consulta.telefono }]
        : []),
    ],
  });

  const resultado = await proveedorEmail().enviar({
    para: CASILLA,
    asunto,
    html,
    texto,
    // Responder al correo lleva directo a quien consultó, sin copiar y pegar
    // la dirección. Es la diferencia entre contestar en el momento o después.
    responderA: consulta.email,
  });

  await db.insert(notificationsLog).values({
    canal: "email",
    evento: "consulta_web",
    destinatario: CASILLA,
    asunto,
    // `simulado` se pregunta primero: el proveedor de demostración devuelve
    // `enviado: false` porque efectivamente no mandó nada, pero eso no es una
    // falla —es que no hay credenciales—, y confundirlas llenaría la bitácora
    // de errores que no existen.
    estado: resultado.simulado
      ? "simulada"
      : resultado.enviado
        ? "enviada"
        : "fallida",
    proveedorMensajeId: resultado.id,
    error: resultado.error,
  });

  if (resultado.simulado) {
    return {
      usarWhatsapp: true,
      error:
        "Todavía no tenemos conectado el envío de correo, así que este mensaje no llegaría. Escribinos por WhatsApp y te contestamos ahora.",
    };
  }

  if (!resultado.enviado) {
    return {
      usarWhatsapp: true,
      error:
        "No pudimos enviar la consulta. Probá por WhatsApp o llamanos y lo resolvemos al toque.",
    };
  }

  return {
    ok: "Recibimos tu consulta. Te contestamos al correo que dejaste.",
  };
}
