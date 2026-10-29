// @ts-nocheck: copiado tal cual de git 9a17128, ver ../../README.md.
import "server-only";

import { configCloud, urlGraph, usaSimulador, type ConfigCloud } from "./config";
import { explicarError } from "./errores";
import { esBsuid } from "./numeros";
import type { ComponenteMeta } from "./plantillas";
import type {
  Diagnostico,
  ErrorDeEnvio,
  EstadoConexion,
  MensajeSaliente,
  PlantillaRemota,
  ProveedorWhatsapp,
  PuntoDeDiagnostico,
  ResultadoEnvio,
} from "./tipos";

/**
 * Proveedor WhatsApp Cloud API (Meta).
 *
 * Habla con la Graph API por `fetch`, sin SDK. No hay socket ni QR: la
 * «conexión» es tener las credenciales cargadas. Los mensajes entrantes llegan
 * por el webhook; acá salen mensajes, se suben y bajan archivos, se leen las
 * plantillas y se diagnostica la configuración.
 *
 * Dos reglas de las que depende que la bandeja no se rompa: **nunca lanza**
 * —todo error vuelve como valor para que la pantalla lo muestre— y **todo
 * llamado tiene timeout**, porque una Graph API que no responde no puede colgar
 * una Server Action ni un trabajo de la cola.
 */

const TIMEOUT_MS = 15_000;
const TIMEOUT_MEDIA_MS = 60_000;

function log(evento: string, detalle?: string) {
  console.info(JSON.stringify({ scope: "whatsapp.cloud", evento, detalle }));
}

interface RespuestaGraph<T> {
  ok: boolean;
  status: number;
  datos: T | null;
  error: { codigo: number | null; mensaje: string; detalle: string | null } | null;
}

/** Un pedido a la Graph API. Nunca lanza. */
async function graph<T>(
  config: ConfigCloud,
  ruta: string,
  opciones: { method?: "GET" | "POST" | "DELETE"; json?: unknown; form?: FormData; timeout?: number } = {},
): Promise<RespuestaGraph<T>> {
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), opciones.timeout ?? TIMEOUT_MS);

  try {
    const res = await fetch(urlGraph(config, ruta), {
      method: opciones.method ?? (opciones.json || opciones.form ? "POST" : "GET"),
      signal: controlador.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        ...(opciones.json ? { "content-type": "application/json" } : {}),
      },
      body: opciones.form ?? (opciones.json ? JSON.stringify(opciones.json) : undefined),
    });

    let cuerpo: unknown = null;
    try {
      cuerpo = await res.json();
    } catch {
      cuerpo = null;
    }

    if (!res.ok) {
      const err = (cuerpo as { error?: { code?: number; message?: string; error_data?: { details?: string } } } | null)
        ?.error;
      return {
        ok: false,
        status: res.status,
        datos: null,
        error: {
          codigo: typeof err?.code === "number" ? err.code : null,
          mensaje: err?.message ?? `HTTP ${res.status}`,
          detalle: err?.error_data?.details ?? err?.message ?? null,
        },
      };
    }

    return { ok: true, status: res.status, datos: cuerpo as T, error: null };
  } catch (error) {
    const corte = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: 0,
      datos: null,
      error: {
        codigo: null,
        mensaje: corte ? "Meta no respondió a tiempo." : "No se pudo conectar con Meta.",
        detalle: error instanceof Error ? error.message : null,
      },
    };
  } finally {
    clearTimeout(reloj);
  }
}

function errorDeEnvio(error: RespuestaGraph<unknown>["error"]): ErrorDeEnvio {
  if (!error) return { codigo: null, texto: "No se pudo enviar.", accion: "reintentar", detalle: null };
  if (error.codigo === null && /responder|conectar/.test(error.mensaje)) {
    return {
      codigo: null,
      texto: "WhatsApp no respondió. El mensaje quedó guardado: volvé a probar en un momento.",
      accion: "reintentar",
      detalle: error.detalle ?? error.mensaje,
    };
  }
  const explicado = explicarError(error.codigo, error.detalle);
  return { ...explicado, detalle: error.detalle ?? error.mensaje };
}

function sinCredenciales(): ErrorDeEnvio {
  return {
    codigo: null,
    texto: "WhatsApp todavía no está conectado. Avisale a quien mantiene el sistema.",
    accion: "sistema",
    detalle: null,
  };
}

/** El cuerpo de `POST /{phone-number-id}/messages` para cada tipo de mensaje. */
export function cuerpoDelMensaje(destino: string, mensaje: MensajeSaliente): Record<string, unknown> {
  // A quien llegó sin número (solo BSUID) se le escribe por `recipient`.
  const base = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...(esBsuid(destino) ? { recipient: destino } : { to: destino }),
  };

  switch (mensaje.tipo) {
    case "texto":
      return {
        ...base,
        ...(mensaje.citado ? { context: { message_id: mensaje.citado } } : {}),
        type: "text",
        // La vista previa de enlaces la arma WhatsApp si el texto tiene una
        // URL: el seguimiento del pedido se ve como tarjeta y no como texto.
        text: { body: mensaje.cuerpo, preview_url: /https?:\/\//.test(mensaje.cuerpo) },
      };

    case "media": {
      const objeto: Record<string, unknown> = { ...mensaje.media };
      // El audio no admite epígrafe; los demás sí.
      if (mensaje.epigrafe?.trim() && mensaje.clase !== "audio") objeto.caption = mensaje.epigrafe.trim();
      if (mensaje.clase === "document" && mensaje.nombreArchivo) objeto.filename = mensaje.nombreArchivo;
      return {
        ...base,
        ...(mensaje.citado ? { context: { message_id: mensaje.citado } } : {}),
        type: mensaje.clase,
        [mensaje.clase]: objeto,
      };
    }

    case "plantilla":
      return {
        ...base,
        type: "template",
        template: {
          name: mensaje.nombre,
          language: { code: mensaje.idioma },
          ...(mensaje.componentes.length > 0 ? { components: mensaje.componentes } : {}),
        },
      };

    case "reaccion":
      return {
        ...base,
        type: "reaction",
        reaction: { message_id: mensaje.aMensaje, emoji: mensaje.emoji },
      };
  }
}

interface PlantillaMeta {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  parameter_format?: string;
  rejected_reason?: string;
  components?: ComponenteMeta[];
}

interface NumeroMeta {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  platform_type?: string;
  /**
   * El límite de destinatarios por día. Desde octubre de 2025 es del
   * portafolio comercial y no del número, y `messaging_limit_tier` quedó
   * deprecado: se lee este.
   */
  whatsapp_business_manager_messaging_limit?: string;
  throughput?: { level?: string };
  status?: string;
}

/**
 * Cómo se dice cada límite de mensajes de Meta. Es la cantidad de personas
 * distintas a las que la maderera puede escribirle primero (con plantilla) en
 * 24 horas; contestar a quien escribió no cuenta. Arranca en 250 y sube a
 * 2.000 al verificar el negocio.
 */
const LIMITES: Record<string, string> = {
  TIER_250: "250 personas por día",
  TIER_1K: "1.000 personas por día",
  TIER_2K: "2.000 personas por día",
  TIER_10K: "10.000 personas por día",
  TIER_100K: "100.000 personas por día",
  TIER_UNLIMITED: "sin límite",
};

const CALIDADES: Record<string, string> = {
  GREEN: "buena",
  YELLOW: "media: hay clientes que marcan los mensajes como no deseados",
  RED: "baja: Meta puede bajar el límite de mensajes",
  UNKNOWN: "todavía sin calificar",
  NA: "todavía sin calificar",
};

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
      detalle: usaSimulador(config) ? "Conectado al simulador de Meta: los mensajes no salen a WhatsApp." : null,
    };
  },

  async enviar(waId, mensaje): Promise<ResultadoEnvio> {
    const config = configCloud();
    if (!config) return { error: sinCredenciales() };

    const res = await graph<{ messages?: { id?: string }[] }>(config, `${config.phoneNumberId}/messages`, {
      json: cuerpoDelMensaje(waId, mensaje),
    });

    if (!res.ok) {
      log("error_envio", `code=${res.error?.codigo} ${res.error?.mensaje}`);
      return { error: errorDeEnvio(res.error) };
    }

    const id = res.datos?.messages?.[0]?.id;
    if (!id) return { error: errorDeEnvio({ codigo: null, mensaje: "Meta no devolvió el id del mensaje.", detalle: null }) };
    return { waMessageId: id };
  },

  async subirMedia(contenido, mime, nombre) {
    const config = configCloud();
    if (!config) return { error: sinCredenciales() };

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mime);
    form.append("file", new Blob([new Uint8Array(contenido)], { type: mime }), nombre);

    const res = await graph<{ id?: string }>(config, `${config.phoneNumberId}/media`, {
      form,
      timeout: TIMEOUT_MEDIA_MS,
    });

    if (!res.ok || !res.datos?.id) {
      log("error_subida", `code=${res.error?.codigo} ${res.error?.mensaje}`);
      return { error: errorDeEnvio(res.error) };
    }
    return { id: res.datos.id };
  },

  async bajarMedia(mediaId) {
    const config = configCloud();
    if (!config) return { error: "Faltan las credenciales de Meta." };

    // Dos pasos: el id da una URL que vive unos minutos, y la URL se baja con
    // el mismo token. Por eso se guarda el archivo y no el enlace.
    const info = await graph<{ url?: string; mime_type?: string; file_size?: number }>(config, mediaId);
    if (!info.ok || !info.datos?.url) {
      return { error: info.error?.mensaje ?? "Meta no devolvió la dirección del archivo." };
    }

    const controlador = new AbortController();
    const reloj = setTimeout(() => controlador.abort(), TIMEOUT_MEDIA_MS);
    try {
      const res = await fetch(info.datos.url, {
        signal: controlador.signal,
        cache: "no-store",
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!res.ok) return { error: `La descarga devolvió HTTP ${res.status}.` };
      const contenido = new Uint8Array(await res.arrayBuffer());
      if (contenido.byteLength === 0) return { error: "El archivo llegó vacío." };
      return { contenido, mime: info.datos.mime_type ?? res.headers.get("content-type") ?? "application/octet-stream" };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "No se pudo bajar el archivo." };
    } finally {
      clearTimeout(reloj);
    }
  },

  async marcarLeido(waMessageId) {
    const config = configCloud();
    if (!config) return;
    const res = await graph(config, `${config.phoneNumberId}/messages`, {
      json: { messaging_product: "whatsapp", status: "read", message_id: waMessageId },
    });
    if (!res.ok) log("error_leido", `code=${res.error?.codigo} ${res.error?.mensaje}`);
  },

  async listarPlantillas() {
    const config = configCloud();
    if (!config) return { error: "Faltan las credenciales de Meta." };
    if (!config.wabaId) return { error: "Falta WHATSAPP_BUSINESS_ACCOUNT_ID para leer las plantillas." };

    const plantillas: PlantillaRemota[] = [];
    let ruta: string | null =
      `${config.wabaId}/message_templates?limit=100&fields=id,name,language,status,category,parameter_format,rejected_reason,components`;

    // Meta pagina de a cien; diez páginas son mil plantillas, más que de sobra.
    for (let pagina = 0; ruta && pagina < 10; pagina++) {
      const res: RespuestaGraph<{ data?: PlantillaMeta[]; paging?: { cursors?: { after?: string }; next?: string } }> =
        await graph(config, ruta);
      if (!res.ok) return { error: res.error?.mensaje ?? "Meta no devolvió las plantillas." };

      for (const p of res.datos?.data ?? []) {
        if (!p.name || !p.language) continue;
        plantillas.push({
          metaId: p.id ?? null,
          nombre: p.name,
          idioma: p.language,
          categoria: p.category ?? null,
          estado: p.status ?? "UNKNOWN",
          motivoRechazo: p.rejected_reason && p.rejected_reason !== "NONE" ? p.rejected_reason : null,
          formatoParametros: p.parameter_format === "NAMED" ? "NAMED" : "POSITIONAL",
          componentes: p.components ?? [],
        });
      }

      const despues = res.datos?.paging?.next ? res.datos?.paging?.cursors?.after : null;
      ruta = despues
        ? `${config.wabaId}/message_templates?limit=100&after=${encodeURIComponent(despues)}&fields=id,name,language,status,category,parameter_format,rejected_reason,components`
        : null;
    }

    return { plantillas };
  },

  async diagnosticar(): Promise<Diagnostico> {
    const config = configCloud();
    const puntos: PuntoDeDiagnostico[] = [];

    if (!config) {
      return {
        puntos: [
          {
            clave: "credenciales",
            titulo: "Credenciales",
            estado: "error",
            detalle: "Faltan WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN en el servidor.",
          },
        ],
        numero: null,
      };
    }

    if (usaSimulador(config)) {
      puntos.push({
        clave: "simulador",
        titulo: "Simulador",
        estado: "aviso",
        detalle: `Se está hablando con ${config.graphUrl}, no con Meta. Sirve para probar; nada sale a WhatsApp.`,
      });
    }

    // 1. El token: si `/me` no contesta, nada de lo demás va a andar.
    const yo = await graph<{ id?: string; name?: string }>(config, "me?fields=id,name");
    if (!yo.ok) {
      puntos.push({
        clave: "token",
        titulo: "Token de acceso",
        estado: "error",
        detalle:
          yo.error?.codigo === 190
            ? "Meta dice que el token venció o lo revocaron. Hay que generar uno permanente del usuario del sistema."
            : `Meta no aceptó el token: ${yo.error?.mensaje ?? "sin respuesta"}.`,
      });
      return { puntos, numero: null };
    }
    puntos.push({
      clave: "token",
      titulo: "Token de acceso",
      estado: "ok",
      detalle: `Válido, del usuario «${yo.datos?.name ?? yo.datos?.id}».`,
    });

    // 2. El número.
    const numero = await graph<NumeroMeta>(
      config,
      `${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,whatsapp_business_manager_messaging_limit,throughput,status`,
    );

    let datosNumero: Diagnostico["numero"] = null;
    if (!numero.ok) {
      puntos.push({
        clave: "numero",
        titulo: "Número de teléfono",
        estado: "error",
        detalle: `El WHATSAPP_PHONE_NUMBER_ID no corresponde a un número que este token pueda usar (${numero.error?.mensaje}).`,
      });
    } else {
      const n = numero.datos ?? {};
      datosNumero = {
        telefono: n.display_phone_number ?? null,
        nombreVerificado: n.verified_name ?? null,
        calidad: n.quality_rating ?? null,
        limite: n.whatsapp_business_manager_messaging_limit ?? null,
        estadoNombre: n.name_status ?? null,
        plataforma: n.platform_type ?? null,
      };
      puntos.push({
        clave: "numero",
        titulo: "Número de teléfono",
        estado: n.platform_type && n.platform_type !== "CLOUD_API" ? "error" : "ok",
        detalle:
          n.platform_type && n.platform_type !== "CLOUD_API"
            ? `${n.display_phone_number} está registrado en ${n.platform_type}, no en la Cloud API.`
            : `${n.display_phone_number ?? "?"} — ${n.verified_name ?? "sin nombre verificado"}.`,
      });

      if (n.name_status && n.name_status !== "APPROVED" && n.name_status !== "AVAILABLE_WITHOUT_REVIEW") {
        puntos.push({
          clave: "nombre",
          titulo: "Nombre visible",
          estado: "aviso",
          detalle: `Meta todavía no aprobó el nombre que ven los clientes (estado ${n.name_status}).`,
        });
      }

      const calidad = n.quality_rating ?? "UNKNOWN";
      puntos.push({
        clave: "calidad",
        titulo: "Calidad del número",
        estado: calidad === "RED" ? "error" : calidad === "YELLOW" ? "aviso" : "ok",
        detalle: `La calidad es ${CALIDADES[calidad] ?? calidad}.${
          n.whatsapp_business_manager_messaging_limit
            ? ` Límite: ${LIMITES[n.whatsapp_business_manager_messaging_limit] ?? n.whatsapp_business_manager_messaging_limit} con mensajes iniciados por la maderera.`
            : ""
        }`,
      });
    }

    // 3. La cuenta (WABA): que exista, que el número sea suyo y que la app
    // esté suscripta, que es lo que hace que Meta mande el webhook.
    if (!config.wabaId) {
      puntos.push({
        clave: "waba",
        titulo: "Cuenta de WhatsApp Business",
        estado: "error",
        detalle: "Falta WHATSAPP_BUSINESS_ACCOUNT_ID: sin eso no se leen las plantillas ni se verifica el webhook.",
      });
    } else {
      const numeros = await graph<{ data?: { id?: string }[] }>(config, `${config.wabaId}/phone_numbers?fields=id`);
      if (!numeros.ok) {
        puntos.push({
          clave: "waba",
          titulo: "Cuenta de WhatsApp Business",
          estado: "error",
          detalle: `El WHATSAPP_BUSINESS_ACCOUNT_ID no es accesible con este token (${numeros.error?.mensaje}).`,
        });
      } else {
        const esDeLaCuenta = (numeros.datos?.data ?? []).some((n) => n.id === config.phoneNumberId);
        puntos.push({
          clave: "waba",
          titulo: "Cuenta de WhatsApp Business",
          estado: esDeLaCuenta ? "ok" : "error",
          detalle: esDeLaCuenta
            ? "El número pertenece a la cuenta configurada."
            : "El número no pertenece a esa cuenta: el WHATSAPP_PHONE_NUMBER_ID o el WHATSAPP_BUSINESS_ACCOUNT_ID está mal.",
        });
      }

      const apps = await graph<{ data?: { whatsapp_business_api_data?: { name?: string; id?: string } }[] }>(
        config,
        `${config.wabaId}/subscribed_apps`,
      );
      const suscriptas = apps.datos?.data ?? [];
      puntos.push({
        clave: "webhook",
        titulo: "Webhook suscripto",
        estado: apps.ok && suscriptas.length > 0 ? "ok" : "error",
        detalle: !apps.ok
          ? `No se pudo consultar (${apps.error?.mensaje}).`
          : suscriptas.length > 0
            ? `Meta manda los avisos a: ${suscriptas.map((a) => a.whatsapp_business_api_data?.name ?? a.whatsapp_business_api_data?.id).join(", ")}.`
            : "Ninguna app está suscripta a la cuenta: los mensajes de los clientes no van a llegar. Hay que hacer el POST a subscribed_apps (ver docs/WHATSAPP.md).",
      });
    }

    if (!config.appSecret) {
      puntos.push({
        clave: "firma",
        titulo: "Firma del webhook",
        estado: "error",
        detalle: "Falta WHATSAPP_APP_SECRET: sin él se rechaza todo lo que llega por el webhook.",
      });
    }

    return { puntos, numero: datosNumero };
  },
};

export { LIMITES, CALIDADES };
