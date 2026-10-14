import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversaciones, mensajes } from "@/lib/db/schema";
import { proveedorWhatsapp } from "./index";
import { limpiar, resumen } from "./ingesta";
import { destinoDeJid } from "./numeros";
import type { ErrorDeEnvio, MensajeSaliente } from "./tipos";

/**
 * **La única puerta de salida de un mensaje.**
 *
 * La bandeja, los avisos automáticos, el envío de un PDF desde la pantalla de
 * un remito y la confirmación de una baja pasan todos por acá. Igual que
 * `acreditarPago` con la plata: un segundo camino para mandar mensajes
 * terminaría guardándolos distinto, y la bandeja mostraría una conversación que
 * no es la que leyó el cliente.
 *
 * El orden es el que hace que **nunca se pierda lo que se escribió**:
 *
 * 1. Se guarda el mensaje como `pendiente`, con su texto y su adjunto.
 * 2. Se manda.
 * 3. Si salió, queda `enviado` con el id de Meta; si no, queda `fallido` con el
 *    código y la explicación, y se puede reintentar desde la bandeja.
 *
 * Antes era al revés —mandar y recién guardar si salía—, y un mensaje que Meta
 * rechazaba por la ventana o por un token vencido desaparecía: quien lo había
 * escrito tenía que volver a tipearlo, si se acordaba.
 */

export interface RegistroSaliente {
  /** Lo que se muestra en la burbuja: el texto, el epígrafe o la plantilla completada. */
  cuerpo: string;
  tipo?: string;
  media?: {
    referencia: string;
    tipo: "image" | "document" | "audio" | "video";
    mime: string;
    nombre?: string | null;
    bytes?: number | null;
    mediaId?: string | null;
  } | null;
  plantilla?: string | null;
  citado?: string | null;
  /** Para saber de qué documento de la plataforma salió (presupuesto, remito…). */
  datos?: Record<string, unknown> | null;
}

export interface ResultadoSaliente {
  mensajeId: string;
  waMessageId?: string;
  error?: ErrorDeEnvio;
}

export async function enviarYRegistrar(opciones: {
  conversacionId: string;
  waJid: string;
  mensaje: MensajeSaliente;
  registro: RegistroSaliente;
  origen: "panel" | "aviso" | "sistema";
  enviadoPorUserId?: string | null;
  /** Reintento de un mensaje fallido: se actualiza esa fila en vez de crear otra. */
  reintentoDe?: string | null;
}): Promise<ResultadoSaliente> {
  const ahora = new Date();
  const cuerpo = limpiar(opciones.registro.cuerpo);

  let mensajeId = opciones.reintentoDe ?? null;

  if (mensajeId) {
    await db
      .update(mensajes)
      .set({ estado: "pendiente", errorCodigo: null, errorDetalle: null, estadoAt: ahora, ocurridoAt: ahora })
      .where(eq(mensajes.id, mensajeId));
  } else {
    const media = opciones.registro.media;
    const [fila] = await db
      .insert(mensajes)
      .values({
        conversacionId: opciones.conversacionId,
        direccion: "saliente",
        tipo: opciones.registro.tipo ?? (media ? media.tipo : opciones.mensaje.tipo === "plantilla" ? "template" : "text"),
        cuerpo,
        mediaUrl: media?.referencia ?? null,
        mediaTipo: media?.tipo ?? null,
        mediaMime: media?.mime ?? null,
        mediaNombre: media?.nombre ?? null,
        mediaBytes: media?.bytes ?? null,
        mediaId: media?.mediaId ?? null,
        mediaEstado: media ? "listo" : null,
        plantilla: opciones.registro.plantilla ?? null,
        citadoWaMessageId: opciones.registro.citado ?? null,
        // Lo que se le pidió a Meta, tal cual: reintentar un fallido es
        // volver a mandar esto, sin reconstruirlo de la burbuja.
        datos: { ...(opciones.registro.datos ?? {}), envio: opciones.mensaje },
        enviadoPorUserId: opciones.enviadoPorUserId ?? null,
        estado: "pendiente",
        estadoAt: ahora,
        origen: opciones.origen,
        ocurridoAt: ahora,
      })
      .returning({ id: mensajes.id });
    mensajeId = fila.id;

    await db
      .update(conversaciones)
      .set({
        ultimoMensajeAt: ahora,
        ultimoMensajePreview: resumen(cuerpo, media?.tipo ?? "text"),
        updatedAt: ahora,
      })
      .where(eq(conversaciones.id, opciones.conversacionId));
  }

  const resultado = await proveedorWhatsapp().enviar(destinoDeJid(opciones.waJid), opciones.mensaje);

  if (resultado.error || !resultado.waMessageId) {
    const error = resultado.error ?? {
      codigo: null,
      texto: "No se pudo enviar.",
      accion: "reintentar" as const,
      detalle: null,
    };
    await db
      .update(mensajes)
      .set({
        estado: "fallido",
        estadoAt: new Date(),
        errorCodigo: error.codigo,
        errorDetalle: error.texto.slice(0, 500),
      })
      .where(eq(mensajes.id, mensajeId));
    return { mensajeId, error };
  }

  await db
    .update(mensajes)
    .set({ waMessageId: resultado.waMessageId, estado: "enviado", estadoAt: new Date() })
    .where(eq(mensajes.id, mensajeId));

  return { mensajeId, waMessageId: resultado.waMessageId };
}
