import "server-only";

import { aTelefono, configCloud, urlGraph, type ConfigCloud } from "./config";
import type {
  EstadoConexion,
  MediaSaliente,
  PlantillaAprobada,
  PlantillaSaliente,
  ProveedorWhatsapp,
  ResultadoEnvio,
} from "./tipos";

/**
 * Proveedor WhatsApp Cloud API (Meta).
 *
 * Habla con la Graph API por `fetch`, sin SDK. No hay socket ni QR: la
 * "conexión" es tener las credenciales cargadas. Los mensajes entrantes llegan
 * por el webhook; acá solo salen mensajes y se reporta el estado.
 *
 * Dos reglas de las que depende que la bandeja no se rompa: nunca lanza —todo
 * error vuelve como `{ error }` para que la pantalla lo muestre— y todo llamado
 * tiene timeout, porque una Graph API que no responde no puede colgar una
 * Server Action.
 */

const TIMEOUT_MS = 15_000;

/**
 * Códigos con los que Meta dice "pasaron más de 24 h desde que te escribió".
 * Fuera de esa ventana solo se puede mandar una plantilla aprobada.
 */
const CODIGOS_FUERA_DE_VENTANA = new Set([131047, 131051, 470]);

function log(evento: string, detalle?: string) {
  console.info(JSON.stringify({ scope: "whatsapp.cloud", evento, detalle }));
}

interface ErrorMeta {
  message?: string;
  code?: number;
  error_data?: { details?: string };
}

async function leerError(res: Response): Promise<{
  code?: number;
  message: string;
}> {
  try {
    const json = (await res.json()) as { error?: ErrorMeta };
    const err = json.error;
    return {
      code: err?.code,
      message: err?.error_data?.details || err?.message || `HTTP ${res.status}`,
    };
  } catch {
    return { message: `HTTP ${res.status}` };
  }
}

/** POST a /{phoneNumberId}/messages. Devuelve el id del mensaje o un error. */
async function enviar(
  config: ConfigCloud,
  payload: Record<string, unknown>,
): Promise<ResultadoEnvio> {
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      urlGraph(config, `${config.phoneNumberId}/messages`),
      {
        method: "POST",
        signal: controlador.signal,
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      },
    );

    if (!res.ok) {
      const err = await leerError(res);
      log("error_envio", `code=${err.code} ${err.message}`);

      if (err.code && CODIGOS_FUERA_DE_VENTANA.has(err.code)) {
        return {
          fueraDeVentana: true,
          error:
            "Pasaron más de 24 horas desde su último mensaje. Para retomar la conversación hay que usar uno de los mensajes aprobados.",
        };
      }
      return { error: "No se pudo enviar el mensaje por WhatsApp." };
    }

    const json = (await res.json()) as { messages?: { id?: string }[] };
    return { waMessageId: json.messages?.[0]?.id };
  } catch {
    return { error: "WhatsApp no respondió. Probá de nuevo en un momento." };
  } finally {
    clearTimeout(reloj);
  }
}

/** El adjunto va por link: Meta lo descarga de la URL pública. */
function payloadMedia(to: string, cuerpo: string, media: MediaSaliente) {
  const caption = cuerpo.trim() || undefined;

  switch (media.tipo) {
    case "image":
      return { to, type: "image", image: { link: media.url, caption } };
    case "video":
      return { to, type: "video", video: { link: media.url, caption } };
    case "audio":
      return { to, type: "audio", audio: { link: media.url } };
    case "document":
      return {
        to,
        type: "document",
        document: {
          link: media.url,
          caption,
          filename: media.nombre ?? undefined,
        },
      };
  }
}

interface PlantillaMeta {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: { type?: string; text?: string }[];
}

export const proveedorCloud: ProveedorWhatsapp = {
  id: "cloud",

  async estado(): Promise<EstadoConexion> {
    const config = configCloud();

    if (!config) {
      return {
        conectado: false,
        proveedor: "cloud",
        telefono: null,
        ultimaSenal: null,
        detalle: "Faltan las credenciales de Meta en el servidor.",
      };
    }

    return {
      conectado: true,
      proveedor: "cloud",
      telefono: config.telefono,
      ultimaSenal: Date.now(),
      detalle: null,
    };
  },

  async enviarTexto(waJid, cuerpo, media) {
    const config = configCloud();
    if (!config) {
      return { error: "WhatsApp no está configurado en el servidor." };
    }

    const to = aTelefono(waJid);
    const payload = media
      ? payloadMedia(to, cuerpo, media)
      : { to, type: "text", text: { body: cuerpo, preview_url: true } };

    return enviar(config, payload);
  },

  async enviarPlantilla(waJid, plantilla: PlantillaSaliente) {
    const config = configCloud();
    if (!config) {
      return { error: "WhatsApp no está configurado en el servidor." };
    }

    const componentes =
      plantilla.variables.length > 0
        ? [
            {
              type: "body",
              parameters: plantilla.variables.map((text) => ({
                type: "text",
                text,
              })),
            },
          ]
        : undefined;

    return enviar(config, {
      to: aTelefono(waJid),
      type: "template",
      template: {
        name: plantilla.nombre,
        language: { code: plantilla.idioma },
        ...(componentes ? { components: componentes } : {}),
      },
    });
  },

  async listarPlantillas(): Promise<PlantillaAprobada[]> {
    const config = configCloud();
    if (!config?.wabaId) return [];

    const controlador = new AbortController();
    const reloj = setTimeout(() => controlador.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(
        urlGraph(
          config,
          `${config.wabaId}/message_templates?limit=100&fields=name,language,status,category,components`,
        ),
        {
          signal: controlador.signal,
          headers: { Authorization: `Bearer ${config.accessToken}` },
          // Las plantillas cambian cuando alguien las edita en Meta, no en cada
          // request: una hora de caché evita pegarle a la Graph API cada vez
          // que se abre la bandeja.
          next: { revalidate: 3600 },
        },
      );

      if (!res.ok) {
        log("error_plantillas", `HTTP ${res.status}`);
        return [];
      }

      const json = (await res.json()) as { data?: PlantillaMeta[] };

      return (json.data ?? [])
        .filter((p) => p.status === "APPROVED" && p.name)
        .map((p) => {
          const cuerpo =
            p.components?.find((c) => c.type === "BODY")?.text ?? "";

          return {
            nombre: p.name!,
            idioma: p.language ?? "es",
            cuerpo,
            variables: contarVariables(cuerpo),
            categoria: p.category ?? null,
          };
        });
    } catch {
      log("error_plantillas", "sin respuesta");
      return [];
    } finally {
      clearTimeout(reloj);
    }
  },
};

/** Cuántos {{n}} distintos tiene el cuerpo de una plantilla. */
export function contarVariables(cuerpo: string): number {
  const encontrados = new Set(
    [...cuerpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]),
  );
  return encontrados.size;
}
