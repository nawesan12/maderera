// @ts-nocheck: copiado tal cual de git 9a17128, ver ../../README.md.
/**
 * El webhook de Meta, traducido a eventos propios.
 *
 * Puro: ni base ni red ni `server-only`. Recibe el JSON tal como lo manda Meta
 * y devuelve una lista de eventos que la ingesta sabe guardar. Así cada forma
 * de payload se prueba con el ejemplo literal de la documentación
 * (`tests/fixtures/whatsapp/`), sin levantar nada.
 *
 * **Nada de lo que llega se considera confiable.** Todo campo se lee como
 * opcional y con su tipo verificado: un payload con una forma nueva, o uno
 * inventado por quien consiguió la URL, tiene que terminar en un evento
 * «desconocido» o en nada, nunca en una excepción que trabe la cola.
 *
 * Los tipos de mensaje de la Cloud API y lo que se hace con cada uno:
 *
 * - `text`, `image`, `document`, `audio`, `video`, `sticker`: lo de siempre;
 *   el adjunto llega como un id de Meta que hay que descargar.
 * - `location`, `contacts`: se guardan con sus datos y un texto legible.
 * - `interactive` (respuesta a botones o a una lista) y `button` (el botón de
 *   respuesta rápida de una plantilla): el texto del botón tocado.
 * - `reaction`: no es un mensaje nuevo, es un emoji sobre uno existente.
 * - `order`, `system`, `unsupported` y cualquier tipo que Meta agregue: entran
 *   con un texto que dice qué fue, para que nadie crea que el cliente no
 *   escribió.
 *
 * Y los campos de la **coexistencia** (el mismo número en la app del teléfono
 * y en la plataforma), con la forma de la referencia de webhooks de Meta
 * (`smb_message_echoes`, `history`, `smb_app_state_sync`, revisada el
 * 14/10/2026):
 *
 * - `smb_message_echoes`: lo que el personal manda desde la app. Cada ítem de
 *   `message_echoes[]` es un mensaje con `from` (el negocio), `to` (el
 *   cliente), `id`, `timestamp` y el contenido según `type`; también llegan
 *   `edit` y `revoke` sobre uno anterior. No traen `pricing`: no se cobran.
 * - `history`: los chats de los últimos seis meses, en partes. `history[]`
 *   trae `metadata` (`phase` 0, 1 o 2: hasta un día, hasta 90 y hasta 180;
 *   `chunk_order`; `progress` de 0 a 100) y `threads[]`, uno por cliente
 *   (`id` es su número) con sus `messages[]`. Quién escribió se sabe por
 *   `from`: el número del negocio o el del cliente. Los adjuntos llegan como
 *   `media_placeholder` y, si son de las últimas dos semanas, después llega
 *   otro `history` con `messages[]` y el adjunto de verdad, con el mismo id.
 *   Si el negocio no quiso compartir el historial, llega un error 2593109.
 * - `smb_app_state_sync`: los contactos de la agenda del teléfono
 *   (`state_sync[]` con `contact.full_name`, `contact.phone_number` y
 *   `action` `add` o `remove`).
 */

export type TipoMensaje =
  | "text"
  | "image"
  | "document"
  | "audio"
  | "video"
  | "sticker"
  | "location"
  | "contacts"
  | "interactive"
  | "button"
  | "reaction"
  | "order"
  | "system"
  | "template"
  /** Del historial: un adjunto que todavía no llegó (viene aparte, si llega). */
  | "media_placeholder"
  | "unsupported";

export type TipoMediaMeta = "image" | "document" | "audio" | "video" | "sticker";

export interface MediaDeMeta {
  /** El id con que se pide a la Graph API. La URL de descarga dura minutos. */
  id: string;
  tipo: TipoMediaMeta;
  mime: string | null;
  nombre: string | null;
  sha256: string | null;
  /** Nota de voz grabada en el momento, y no un archivo de audio. */
  voz: boolean;
  animado: boolean;
}

export interface MensajeDeMeta {
  /**
   * El `from` de Meta, sin tocar: la ingesta lo lleva a la forma canónica.
   * Vacío cuando Meta no comparte el teléfono (ver `usuarioMeta`).
   */
  de: string;
  /**
   * El identificador de usuario de WhatsApp para este negocio (BSUID,
   * `AR.…`), en `from_user_id`. Meta lo manda desde abril de 2026 porque la
   * gente puede usar un nombre de usuario en vez del número: en ese caso, si
   * no hubo contacto en los últimos 30 días, **`from` no viene** y esto es lo
   * único que identifica a quien escribe.
   */
  usuarioMeta: string | null;
  nombrePerfil: string | null;
  waMessageId: string;
  /** Epoch ms según WhatsApp. */
  ocurrido: number | null;
  tipo: TipoMensaje;
  /** El tipo tal como vino, aunque no lo conozcamos. */
  tipoOriginal: string;
  texto: string;
  media: MediaDeMeta | null;
  /** Si responde a otro mensaje (lo citó), el id de ese mensaje. */
  citado: string | null;
  /** Para `reaction`: a qué mensaje y con qué emoji (vacío = la sacó). */
  reaccion: { aMensaje: string; emoji: string } | null;
  /** Lo estructurado: ubicación, contactos, botón tocado, anuncio de origen. */
  datos: Record<string, unknown> | null;
}

/** `played` es el de las notas de voz escuchadas: para la bandeja vale como leído. */
export type EstadoEntregaMeta = "sent" | "delivered" | "read" | "played" | "failed";

export interface ErrorDeMeta {
  codigo: number | null;
  titulo: string;
  detalle: string | null;
}

export interface EstadoDeMeta {
  waMessageId: string;
  estado: EstadoEntregaMeta;
  ocurrido: number | null;
  destinatario: string | null;
  error: ErrorDeMeta | null;
  /** Lo que informa Meta sobre el cobro de ese mensaje. */
  cobro: { categoria: string | null; cobrable: boolean | null; tipo: string | null } | null;
}

export type EventoWebhook =
  | { tipo: "mensaje"; phoneNumberId: string | null; mensaje: MensajeDeMeta }
  | { tipo: "estado"; phoneNumberId: string | null; estado: EstadoDeMeta }
  /**
   * Un mensaje que el negocio mandó desde la app del teléfono con el número en
   * coexistencia (campo `smb_message_echoes`): hay que guardarlo como saliente,
   * o la bandeja mostraría al cliente hablando solo.
   */
  | { tipo: "eco"; phoneNumberId: string | null; mensaje: EcoDeMeta }
  /** Desde la app se editó o se borró un mensaje que ya había salido. */
  | {
      tipo: "eco-cambio";
      phoneNumberId: string | null;
      cambio: "editado" | "eliminado";
      original: string;
      texto: string | null;
    }
  /** Una parte del historial de chats de la app, al conectar en coexistencia. */
  | { tipo: "historial"; phoneNumberId: string | null; parte: ParteDeHistorial }
  /** Los adjuntos del historial, que llegan después y aparte. */
  | { tipo: "historial-medios"; phoneNumberId: string | null; mensajes: MensajeDeMeta[] }
  /** El negocio no compartió el historial (2593109) u otro error del historial. */
  | { tipo: "historial-error"; phoneNumberId: string | null; codigo: number | null; detalle: string }
  /** Contactos de la agenda de la app del teléfono. */
  | { tipo: "contactos"; phoneNumberId: string | null; contactos: ContactoDeLaApp[] }
  /** Cambios de la cuenta: sobre todo, que Meta cortó la coexistencia. */
  | { tipo: "cuenta"; evento: string; motivo: string | null }
  | {
      tipo: "plantilla";
      nombre: string;
      idioma: string | null;
      estado: string;
      motivo: string | null;
      metaId: string | null;
    }
  | {
      tipo: "calidad";
      telefono: string | null;
      evento: string | null;
      limite: string | null;
    }
  | { tipo: "otro"; campo: string };

/** Un eco: el mensaje y a quién se lo mandó el negocio. */
export interface EcoDeMeta extends MensajeDeMeta {
  /** El número del cliente (`to`). */
  para: string | null;
  /** El BSUID del cliente, si Meta lo manda en vez del número. */
  paraUsuario: string | null;
}

export interface MensajeDeHistorial extends MensajeDeMeta {
  /** Lo escribió el negocio (desde la app), no el cliente. */
  delNegocio: boolean;
  /** `history_context.status`: SENT, DELIVERED, READ, PLAYED, PENDING, ERROR. */
  estadoHistorial: string | null;
}

export interface ParteDeHistorial {
  /** 0: el último día; 1: hasta 90 días; 2: hasta 180. */
  fase: number | null;
  orden: number | null;
  /** De 0 a 100; 100 es que terminó. */
  progreso: number | null;
  hilos: { waId: string; mensajes: MensajeDeHistorial[] }[];
}

export interface ContactoDeLaApp {
  telefono: string;
  nombre: string | null;
  accion: string;
}

/* -------------------------------------------------------------------------- */
/* Lectura defensiva                                                           */
/* -------------------------------------------------------------------------- */

type Obj = Record<string, unknown>;

function obj(valor: unknown): Obj | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Obj)
    : null;
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function texto(valor: unknown): string | null {
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return null;
}

function numero(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && /^-?\d+(\.\d+)?$/.test(valor)) return Number(valor);
  return null;
}

/** Los timestamps de Meta son segundos Unix, como texto. */
function epochMs(valor: unknown): number | null {
  const n = numero(valor);
  return n && n > 0 ? n * 1000 : null;
}

const TIPOS_MEDIA: TipoMediaMeta[] = ["image", "document", "audio", "video", "sticker"];

const TIPOS_CONOCIDOS = new Set<string>([
  "text",
  "image",
  "document",
  "audio",
  "video",
  "sticker",
  "location",
  "contacts",
  "interactive",
  "button",
  "reaction",
  "order",
  "system",
  "media_placeholder",
  "unsupported",
]);

/* -------------------------------------------------------------------------- */
/* Mensajes                                                                    */
/* -------------------------------------------------------------------------- */

function leerMedia(m: Obj, tipo: string): MediaDeMeta | null {
  if (!TIPOS_MEDIA.includes(tipo as TipoMediaMeta)) return null;
  const media = obj(m[tipo]);
  const id = texto(media?.id);
  if (!media || !id) return null;
  return {
    id,
    tipo: tipo as TipoMediaMeta,
    mime: texto(media.mime_type),
    nombre: texto(media.filename),
    sha256: texto(media.sha256),
    voz: media.voice === true,
    animado: media.animated === true,
  };
}

function textoDeUbicacion(u: Obj): { texto: string; datos: Obj } {
  const lat = numero(u.latitude);
  const lng = numero(u.longitude);
  const nombre = texto(u.name);
  const direccion = texto(u.address);
  const partes = [nombre, direccion].filter(Boolean);
  return {
    texto: `Ubicación${partes.length ? `: ${partes.join(" — ")}` : ""}`,
    datos: {
      ubicacion: {
        lat,
        lng,
        nombre,
        direccion,
        url: texto(u.url),
        // Para abrirla en el mapa desde la bandeja.
        mapa:
          lat !== null && lng !== null
            ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
            : null,
      },
    },
  };
}

function textoDeContactos(contactos: unknown[]): { texto: string; datos: Obj } {
  const leidos = contactos.map((c) => {
    const o = obj(c) ?? {};
    const nombre = texto(obj(o.name)?.formatted_name) ?? texto(obj(o.name)?.first_name) ?? "Sin nombre";
    const telefonos = lista(o.phones)
      .map((p) => {
        const t = obj(p);
        return { numero: texto(t?.phone) ?? texto(t?.wa_id), waId: texto(t?.wa_id) };
      })
      .filter((t) => t.numero);
    return { nombre, telefonos };
  });

  const resumen = leidos
    .map((c) => `${c.nombre}${c.telefonos[0]?.numero ? ` (${c.telefonos[0].numero})` : ""}`)
    .join(", ");

  return {
    texto: `${leidos.length === 1 ? "Contacto" : "Contactos"}: ${resumen || "sin datos"}`,
    datos: { contactos: leidos },
  };
}

function leerContenido(
  m: Obj,
  tipo: string,
): { texto: string; datos: Obj | null; reaccion: MensajeDeMeta["reaccion"] } {
  switch (tipo) {
    case "text":
      return { texto: texto(obj(m.text)?.body) ?? "", datos: null, reaccion: null };

    case "image":
    case "video":
    case "document":
      return { texto: texto(obj(m[tipo])?.caption) ?? "", datos: null, reaccion: null };

    case "audio":
    case "sticker":
      return { texto: "", datos: null, reaccion: null };

    case "media_placeholder":
      return {
        texto: "(Un archivo del historial del teléfono. Si es de las últimas dos semanas, llega en un rato.)",
        datos: null,
        reaccion: null,
      };

    case "location": {
      const u = obj(m.location);
      if (!u) return { texto: "Ubicación", datos: null, reaccion: null };
      return { ...textoDeUbicacion(u), reaccion: null };
    }

    case "contacts":
      return { ...textoDeContactos(lista(m.contacts)), reaccion: null };

    case "interactive": {
      const i = obj(m.interactive);
      const boton = obj(i?.button_reply);
      const fila = obj(i?.list_reply);
      const nfm = obj(i?.nfm_reply);
      if (boton) {
        return {
          texto: texto(boton.title) ?? "",
          datos: { respuesta: { tipo: "boton", id: texto(boton.id), titulo: texto(boton.title) } },
          reaccion: null,
        };
      }
      if (fila) {
        const descripcion = texto(fila.description);
        return {
          texto: [texto(fila.title), descripcion].filter(Boolean).join(" — "),
          datos: { respuesta: { tipo: "lista", id: texto(fila.id), titulo: texto(fila.title), descripcion } },
          reaccion: null,
        };
      }
      if (nfm) {
        return {
          texto: "Respondió un formulario de WhatsApp",
          datos: { respuesta: { tipo: "formulario", cuerpo: texto(nfm.response_json) } },
          reaccion: null,
        };
      }
      return { texto: "Respuesta a un mensaje con opciones", datos: null, reaccion: null };
    }

    case "button": {
      // El botón de respuesta rápida de una plantilla («Sí, confirmo»).
      const b = obj(m.button);
      return {
        texto: texto(b?.text) ?? "",
        datos: { respuesta: { tipo: "boton_plantilla", id: texto(b?.payload), titulo: texto(b?.text) } },
        reaccion: null,
      };
    }

    case "reaction": {
      const r = obj(m.reaction);
      const aMensaje = texto(r?.message_id);
      return {
        texto: "",
        datos: null,
        // Sin emoji = el cliente sacó la reacción que había puesto.
        reaccion: aMensaje ? { aMensaje, emoji: texto(r?.emoji) ?? "" } : null,
      };
    }

    case "order": {
      const o = obj(m.order);
      const items = lista(o?.product_items);
      return {
        texto: `Armó un pedido desde el catálogo de WhatsApp (${items.length} ${items.length === 1 ? "artículo" : "artículos"})${texto(o?.text) ? `: ${texto(o?.text)}` : ""}`,
        datos: { pedido: o },
        reaccion: null,
      };
    }

    case "system": {
      const s = obj(m.system);
      return {
        texto: texto(s?.body) ?? "Aviso de WhatsApp sobre este número",
        datos: { sistema: { tipo: texto(s?.type), nuevoWaId: texto(s?.wa_id) ?? texto(s?.new_wa_id) } },
        reaccion: null,
      };
    }

    default: {
      // `unsupported` o un tipo que Meta agregó después de escribir esto. Meta
      // suele explicar en `errors[]` qué fue («Message type unknown»).
      const error = obj(lista(m.errors)[0]);
      const motivo = texto(error?.title) ?? texto(obj(error?.error_data)?.details);
      return {
        texto: `(Mandó un mensaje que WhatsApp no deja ver acá${motivo ? `: ${motivo}` : ""}. Hay que pedirle que lo reenvíe de otra forma.)`,
        datos: { tipoOriginal: tipo, error: error ?? null },
        reaccion: null,
      };
    }
  }
}

function leerMensaje(m: Obj, nombres: Map<string, string>, sinRemitente = false): MensajeDeMeta | null {
  const de = texto(m.from) ?? "";
  const usuarioMeta = texto(m.from_user_id);
  const id = texto(m.id);
  if ((!de && !usuarioMeta && !sinRemitente) || !id) return null;

  const tipoOriginal = texto(m.type) ?? "unsupported";
  const tipo = (TIPOS_CONOCIDOS.has(tipoOriginal) ? tipoOriginal : "unsupported") as TipoMensaje;
  const contenido = leerContenido(m, tipoOriginal);
  const contexto = obj(m.context);

  let datos = contenido.datos;
  // Llegó tocando un anuncio de Facebook o Instagram que lleva a WhatsApp.
  const referral = obj(m.referral);
  if (referral) {
    datos = {
      ...(datos ?? {}),
      anuncio: {
        titulo: texto(referral.headline),
        cuerpo: texto(referral.body),
        url: texto(referral.source_url),
        tipo: texto(referral.source_type),
      },
    };
  }
  // «Reenviado» se muestra igual que en el teléfono.
  if (contexto?.forwarded === true || contexto?.frequently_forwarded === true) {
    datos = { ...(datos ?? {}), reenviado: contexto.frequently_forwarded === true ? "muchas" : "si" };
  }
  // Consulta por un producto del catálogo de WhatsApp.
  const productoCitado = texto(obj(contexto?.referred_product)?.product_retailer_id);
  if (productoCitado) datos = { ...(datos ?? {}), productoConsultado: productoCitado };

  return {
    de,
    usuarioMeta,
    nombrePerfil: nombres.get(de || usuarioMeta || "") ?? null,
    waMessageId: id,
    ocurrido: epochMs(m.timestamp),
    tipo,
    tipoOriginal,
    texto: contenido.texto,
    media: leerMedia(m, tipoOriginal),
    citado: texto(contexto?.id),
    reaccion: contenido.reaccion,
    datos,
  };
}

/* -------------------------------------------------------------------------- */
/* Estados                                                                     */
/* -------------------------------------------------------------------------- */

const ESTADOS_ENTREGA = new Set(["sent", "delivered", "read", "played", "failed"]);

function leerEstado(s: Obj): EstadoDeMeta | null {
  const id = texto(s.id);
  const estado = texto(s.status);
  if (!id || !estado || !ESTADOS_ENTREGA.has(estado)) return null;

  const error = obj(lista(s.errors)[0]);
  const pricing = obj(s.pricing);

  return {
    waMessageId: id,
    estado: estado as EstadoEntregaMeta,
    ocurrido: epochMs(s.timestamp),
    destinatario: texto(s.recipient_id),
    error: error
      ? {
          codigo: numero(error.code),
          titulo: texto(error.title) ?? texto(error.message) ?? "Error sin descripción",
          detalle: texto(obj(error.error_data)?.details) ?? texto(error.message),
        }
      : null,
    cobro: pricing
      ? {
          categoria: texto(pricing.category),
          cobrable: typeof pricing.billable === "boolean" ? pricing.billable : null,
          tipo: texto(pricing.type),
        }
      : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Entrada                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Todos los eventos de un payload, en el orden en que vinieron.
 *
 * Un mismo POST puede traer varias entradas y varios cambios: Meta agrupa
 * cuando hay mucho tráfico. Lo que no se reconoce se informa como `otro` para
 * que quede en el registro y nadie tenga que adivinar por qué no apareció.
 */
export function leerPayload(crudo: unknown): EventoWebhook[] {
  const raiz = obj(crudo);
  if (!raiz || raiz.object !== "whatsapp_business_account") return [];

  const eventos: EventoWebhook[] = [];

  for (const entrada of lista(raiz.entry)) {
    for (const cambioCrudo of lista(obj(entrada)?.changes)) {
      const cambio = obj(cambioCrudo);
      const campo = texto(cambio?.field) ?? "messages";
      const valor = obj(cambio?.value);
      if (!valor) continue;

      const phoneNumberId = texto(obj(valor.metadata)?.phone_number_id);

      if (campo === "messages") {
        const nombres = new Map<string, string>();
        for (const c of lista(valor.contacts)) {
          const contacto = obj(c);
          const nombre = texto(obj(contacto?.profile)?.name);
          if (!nombre) continue;
          const waId = texto(contacto?.wa_id);
          const usuario = texto(contacto?.user_id);
          if (waId) nombres.set(waId, nombre);
          if (usuario) nombres.set(usuario, nombre);
        }

        for (const s of lista(valor.statuses)) {
          const estado = obj(s) && leerEstado(obj(s)!);
          if (estado) eventos.push({ tipo: "estado", phoneNumberId, estado });
        }

        for (const m of lista(valor.messages)) {
          const mensaje = obj(m) && leerMensaje(obj(m)!, nombres);
          if (mensaje) eventos.push({ tipo: "mensaje", phoneNumberId, mensaje });
        }
        continue;
      }

      if (campo === "smb_message_echoes") {
        for (const m of lista(valor.message_echoes)) {
          const evento = leerEco(obj(m), phoneNumberId);
          if (evento) eventos.push(evento);
        }
        continue;
      }

      if (campo === "history") {
        eventos.push(...leerHistorial(valor, phoneNumberId));
        continue;
      }

      if (campo === "smb_app_state_sync") {
        const contactos: ContactoDeLaApp[] = [];
        for (const item of lista(valor.state_sync)) {
          const o = obj(item);
          const contacto = obj(o?.contact);
          const telefono = texto(contacto?.phone_number);
          if (!o || texto(o.type) !== "contact" || !telefono) continue;
          contactos.push({
            telefono,
            nombre: texto(contacto?.full_name) ?? texto(contacto?.first_name),
            accion: texto(o.action) ?? "add",
          });
        }
        if (contactos.length) eventos.push({ tipo: "contactos", phoneNumberId, contactos });
        continue;
      }

      if (campo === "account_update") {
        const evento = texto(valor.event);
        if (evento) {
          eventos.push({
            tipo: "cuenta",
            evento,
            motivo: texto(obj(valor.disconnection_info)?.reason) ?? texto(valor.reason),
          });
        }
        continue;
      }

      if (campo === "message_template_status_update") {
        const nombre = texto(valor.message_template_name);
        const estado = texto(valor.event);
        if (nombre && estado) {
          eventos.push({
            tipo: "plantilla",
            nombre,
            idioma: texto(valor.message_template_language),
            estado,
            motivo: texto(valor.reason) ?? texto(valor.other_info),
            metaId: texto(valor.message_template_id),
          });
        }
        continue;
      }

      if (campo === "phone_number_quality_update") {
        eventos.push({
          tipo: "calidad",
          telefono: texto(valor.display_phone_number),
          evento: texto(valor.event),
          limite: texto(valor.current_limit) ?? texto(valor.messaging_limit_tier),
        });
        continue;
      }

      eventos.push({ tipo: "otro", campo });
    }
  }

  return eventos;
}

/* -------------------------------------------------------------------------- */
/* Coexistencia                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Un eco de la app. Sin id o sin destinatario no hay nada que guardar: se
 * descarta. El `from` no hace falta (es el negocio), así que su falta no lo
 * tira.
 */
function leerEco(o: Obj | null, phoneNumberId: string | null): EventoWebhook | null {
  if (!o) return null;
  const tipo = texto(o.type);

  if (tipo === "revoke" || tipo === "edit") {
    const contenido = obj(o[tipo]);
    const original = texto(contenido?.original_message_id);
    if (!original) return null;
    let nuevo: string | null = null;
    if (tipo === "edit") {
      const mensaje = obj(contenido?.message);
      if (mensaje) nuevo = leerContenido(mensaje, texto(mensaje.type) ?? "text").texto;
    }
    return {
      tipo: "eco-cambio",
      phoneNumberId,
      cambio: tipo === "edit" ? "editado" : "eliminado",
      original,
      texto: nuevo,
    };
  }

  const para = texto(o.to);
  const paraUsuario = texto(o.to_user_id);
  if (!para && !paraUsuario) return null;
  const mensaje = leerMensaje(o, new Map(), true);
  if (!mensaje) return null;
  return { tipo: "eco", phoneNumberId, mensaje: { ...mensaje, para, paraUsuario } };
}

/** Los dígitos, para comparar el `from` con el número del negocio. */
function digitos(valor: string | null): string {
  return (valor ?? "").replace(/\D/g, "");
}

/** Si dos números son el mismo, con o sin el 9 de los celulares argentinos. */
function mismoTelefono(a: string, b: string): boolean {
  const x = digitos(a);
  const y = digitos(b);
  if (!x || !y) return false;
  const sinNueve = (d: string) => (d.startsWith("549") ? `54${d.slice(3)}` : d);
  return sinNueve(x) === sinNueve(y);
}

function leerHistorial(valor: Obj, phoneNumberId: string | null): EventoWebhook[] {
  const eventos: EventoWebhook[] = [];
  const negocio = texto(obj(valor.metadata)?.display_phone_number);

  // Los adjuntos que llegan después: `messages[]` suelto, sin hilos.
  const sueltos = lista(valor.messages)
    .map((m) => obj(m) && leerMensaje(obj(m)!, new Map()))
    .filter((m): m is MensajeDeMeta => Boolean(m && m.media));
  if (sueltos.length) eventos.push({ tipo: "historial-medios", phoneNumberId, mensajes: sueltos });

  for (const parteCruda of lista(valor.history)) {
    const parte = obj(parteCruda);
    if (!parte) continue;

    const error = obj(lista(parte.errors)[0]);
    if (error) {
      eventos.push({
        tipo: "historial-error",
        phoneNumberId,
        codigo: numero(error.code),
        detalle: texto(obj(error.error_data)?.details) ?? texto(error.title) ?? texto(error.message) ?? "Error del historial",
      });
      continue;
    }

    const meta = obj(parte.metadata);
    const hilos: ParteDeHistorial["hilos"] = [];
    for (const hiloCrudo of lista(parte.threads)) {
      const hilo = obj(hiloCrudo);
      const waId = texto(hilo?.id);
      if (!hilo || !waId) continue;
      const mensajes: MensajeDeHistorial[] = [];
      for (const m of lista(hilo.messages)) {
        const o = obj(m);
        const leido = o && leerMensaje(o, new Map());
        if (!leido) continue;
        mensajes.push({
          ...leido,
          // Si no se sabe el número del negocio, es del negocio lo que no vino del cliente.
          delNegocio: negocio ? mismoTelefono(leido.de, negocio) : !mismoTelefono(leido.de, waId),
          estadoHistorial: texto(obj(o.history_context)?.status),
        });
      }
      hilos.push({ waId, mensajes });
    }

    eventos.push({
      tipo: "historial",
      phoneNumberId,
      parte: { fase: numero(meta?.phase), orden: numero(meta?.chunk_order), progreso: numero(meta?.progress), hilos },
    });
  }

  return eventos;
}
