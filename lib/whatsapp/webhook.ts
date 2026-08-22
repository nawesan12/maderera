import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { guardarAdjunto } from "@/lib/almacenamiento";
import { aTelefono, configCloud, urlGraph } from "./config";
import { actualizarEstadoMensaje, ingresarEntrante } from "./ingesta";
import type { MediaEntrante, TipoMedia } from "./tipos";

/**
 * Procesamiento del webhook de la WhatsApp Cloud API.
 *
 * El route handler verifica la firma y delega acá: normalizar el payload de
 * Meta a algo propio y pasárselo a la ingesta. Nada de lo que llega se
 * considera confiable; la validación real vive en `ingesta.ts`.
 */

/**
 * Valida `X-Hub-Signature-256: sha256=<hmac>` contra el app secret.
 *
 * Sin app secret configurado devuelve false: si no se puede verificar quién
 * manda, no se procesa. Este endpoint es público y escribe en la base; sin la
 * firma, cualquiera podría inventar mensajes de cualquier cliente.
 *
 * La comparación es de tiempo constante a propósito: comparar con `===`
 * termina apenas encuentra un byte distinto, y esa diferencia de tiempo alcanza
 * para ir adivinando la firma correcta.
 */
export function firmaValida(
  cuerpoCrudo: string,
  cabecera: string | null,
): boolean {
  const config = configCloud();
  if (!config?.appSecret || !cabecera) return false;

  const esperada =
    "sha256=" +
    createHmac("sha256", config.appSecret)
      .update(cuerpoCrudo, "utf8")
      .digest("hex");

  const recibida = Buffer.from(cabecera);
  const calculada = Buffer.from(esperada);

  if (recibida.length !== calculada.length) return false;
  return timingSafeEqual(recibida, calculada);
}

/* -------------------------------------------------------------------------- */
/* Forma del payload de Meta (solo lo que se usa)                              */
/* -------------------------------------------------------------------------- */

interface MediaMeta {
  id?: string;
  mime_type?: string;
  filename?: string;
  caption?: string;
}

interface MensajeMeta {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: MediaMeta;
  document?: MediaMeta;
  video?: MediaMeta;
  audio?: MediaMeta;
  sticker?: MediaMeta;
}

interface EstadoMeta {
  id?: string;
  status?: string;
}

interface ValorMeta {
  metadata?: { phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: MensajeMeta[];
  statuses?: EstadoMeta[];
}

export interface PayloadWebhook {
  object?: string;
  entry?: { changes?: { value?: ValorMeta }[] }[];
}

const TIPOS_MEDIA: TipoMedia[] = [
  "image",
  "document",
  "video",
  "audio",
  "sticker",
];

function extraerMedia(
  mensaje: MensajeMeta,
): { tipo: TipoMedia; obj: MediaMeta } | null {
  for (const tipo of TIPOS_MEDIA) {
    const obj = mensaje[tipo];
    if (obj?.id) return { tipo, obj };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Descarga de adjuntos                                                        */
/* -------------------------------------------------------------------------- */

const TIMEOUT_MS = 20_000;
/** 16 MB: el tope de WhatsApp para documentos y video. */
const MAX_BYTES = 16 * 1024 * 1024;

/**
 * Trae un adjunto de Meta y lo guarda en el almacenamiento propio.
 *
 * Son dos pasos: primero se pide la URL temporal por el media id, después se
 * descarga el binario con el token. Hay que guardarlo porque esa URL vive unos
 * minutos: si solo se anotara el link, el adjunto que mandó el cliente
 * desaparecería de la conversación al rato.
 */
async function bajarMedia(
  mediaId: string,
  tipo: TipoMedia,
  nombre?: string | null,
): Promise<MediaEntrante | null> {
  const config = configCloud();
  if (!config) return null;

  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const meta = await fetch(urlGraph(config, mediaId), {
      signal: controlador.signal,
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });

    if (!meta.ok) return null;

    const info = (await meta.json()) as {
      url?: string;
      mime_type?: string;
      file_size?: number;
    };

    if (!info.url) return null;
    if (info.file_size && info.file_size > MAX_BYTES) {
      console.warn(
        JSON.stringify({
          scope: "whatsapp.webhook",
          evento: "media_muy_grande",
          detalle: `${info.file_size} bytes`,
        }),
      );
      return null;
    }

    const binario = await fetch(info.url, {
      signal: controlador.signal,
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });

    if (!binario.ok) return null;

    const bytes = new Uint8Array(await binario.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return null;

    const mime = info.mime_type ?? "application/octet-stream";
    const guardado = await guardarAdjunto(bytes, mime);

    if (!guardado.url) return null;

    return {
      url: guardado.url,
      tipo,
      mime,
      nombre: nombre ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/* -------------------------------------------------------------------------- */
/* Entrada principal                                                           */
/* -------------------------------------------------------------------------- */

/** Estados de entrega de Meta, traducidos a los del sistema. */
const ESTADOS: Record<string, "enviado" | "entregado" | "leido" | "fallido"> = {
  sent: "enviado",
  delivered: "entregado",
  read: "leido",
  failed: "fallido",
};

/**
 * Procesa un payload ya verificado.
 *
 * Corre después de haberle contestado 200 a Meta: si esto tarda, Meta reintenta
 * y llegan mensajes repetidos. La ingesta corta los repetidos igual, pero la
 * regla es contestar primero y trabajar después.
 */
export async function procesarPayload(payload: PayloadWebhook): Promise<void> {
  const config = configCloud();

  for (const entrada of payload.entry ?? []) {
    for (const cambio of entrada.changes ?? []) {
      const valor = cambio.value;
      if (!valor) continue;

      // El número tiene que ser el nuestro. Un webhook mal configurado en Meta
      // puede mandar eventos de otro número del mismo portafolio.
      const phoneNumberId = valor.metadata?.phone_number_id;
      if (config && phoneNumberId && phoneNumberId !== config.phoneNumberId) {
        continue;
      }

      // Callbacks de entrega de lo que mandamos nosotros.
      for (const estado of valor.statuses ?? []) {
        const traducido = estado.status ? ESTADOS[estado.status] : undefined;
        if (estado.id && traducido) {
          await actualizarEstadoMensaje(estado.id, traducido);
        }
      }

      const nombrePorWaId = new Map<string, string>();
      for (const contacto of valor.contacts ?? []) {
        if (contacto.wa_id && contacto.profile?.name) {
          nombrePorWaId.set(contacto.wa_id, contacto.profile.name);
        }
      }

      for (const mensaje of valor.messages ?? []) {
        if (!mensaje.from) continue;

        const media = extraerMedia(mensaje);
        const adjunto = media
          ? await bajarMedia(media.obj.id!, media.tipo, media.obj.filename)
          : null;

        const cuerpo =
          mensaje.text?.body ??
          media?.obj.caption ??
          (media && !adjunto ? "(no pudimos descargar el archivo)" : "");

        await ingresarEntrante({
          waJid: `${aTelefono(mensaje.from)}@s.whatsapp.net`,
          displayName: nombrePorWaId.get(mensaje.from) ?? null,
          cuerpo,
          waMessageId: mensaje.id ?? null,
          timestamp: mensaje.timestamp
            ? Number(mensaje.timestamp) * 1000
            : null,
          media: adjunto,
        });
      }
    }
  }
}
