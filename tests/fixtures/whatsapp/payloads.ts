/**
 * Payloads del webhook de la WhatsApp Cloud API, con la forma exacta de la
 * documentación de Meta («Webhooks › messages», ejemplos de cada tipo).
 *
 * Los usan los tests (`tests/whatsapp-payload.test.ts`) y el script que se los
 * manda firmados a la aplicación en desarrollo (`scripts/whatsapp-webhook.ts`):
 * lo que se prueba en uno es lo que se ve en el otro.
 *
 * Solo cambian los valores: el número del negocio, el del cliente, los ids y la
 * hora. La estructura —anidamiento, nombres de campo, timestamps como texto en
 * segundos— es la de Meta, que es lo que importa reproducir.
 */

export interface Base {
  phoneNumberId?: string;
  telefonoNegocio?: string;
  wabaId?: string;
}

export interface DeCliente extends Base {
  /** `null` para el caso en que Meta no comparte el teléfono (solo el BSUID). */
  de?: string | null;
  /** El BSUID (`from_user_id`), que Meta manda desde abril de 2026. */
  usuario?: string;
  nombre?: string;
  id?: string;
  /** Segundos Unix. */
  ts?: number;
  /** Id del mensaje que cita (responder a…). */
  citado?: string;
}

const PHONE_NUMBER_ID = "106540352242922";
const TELEFONO_NEGOCIO = "5492235903118";
const WABA_ID = "102290129340398";

let contador = 0;
/** Ids con la forma de los de Meta («wamid.» + base64). */
export function wamid(): string {
  contador++;
  const crudo = `HBgNNTQ5MjIzNTU1MDEyMxUCABIYFjNFQjA${Date.now().toString(36)}${contador}`;
  return `wamid.${crudo}`;
}

function ahora(): number {
  return Math.floor(Date.now() / 1000);
}

function envolver(base: Base, campo: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: base.wabaId ?? WABA_ID,
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: base.telefonoNegocio ?? TELEFONO_NEGOCIO,
                phone_number_id: base.phoneNumberId ?? PHONE_NUMBER_ID,
              },
              ...value,
            },
            field: campo,
          },
        ],
      },
    ],
  };
}

/** Un BSUID de ejemplo: código de país, punto y hasta 128 alfanuméricos. */
export function bsuid(de: string | null | undefined): string {
  return `AR.${Buffer.from(de ?? "sin-numero").toString("hex").toUpperCase().slice(0, 24)}`;
}

function mensaje(o: DeCliente, tipo: string, contenido: Record<string, unknown>) {
  const de = o.de === null ? null : (o.de ?? "5492235550123");
  const usuario = o.usuario ?? bsuid(de);
  return envolver(o, "messages", {
    contacts: [{ profile: { name: o.nombre ?? "Marta Gómez" }, ...(de ? { wa_id: de } : {}), user_id: usuario }],
    messages: [
      {
        ...(o.citado ? { context: { from: o.telefonoNegocio ?? TELEFONO_NEGOCIO, id: o.citado } } : {}),
        ...(de ? { from: de } : {}),
        from_user_id: usuario,
        id: o.id ?? wamid(),
        timestamp: String(o.ts ?? ahora()),
        type: tipo,
        ...contenido,
      },
    ],
  });
}

export function texto(o: DeCliente & { cuerpo?: string } = {}) {
  return mensaje(o, "text", { text: { body: o.cuerpo ?? "Hola, ¿tienen fenólico de 18 mm?" } });
}

export function imagen(o: DeCliente & { mediaId?: string; caption?: string } = {}) {
  return mensaje(o, "image", {
    image: {
      caption: o.caption ?? "Así quedó la pared, ¿cuántas placas necesito?",
      mime_type: "image/jpeg",
      sha256: "Dq3lTZ0w8nFqUmXmJ2c3sAvXcLq6KjVd2t3oFpPpJfE=",
      id: o.mediaId ?? "1037543291543636",
    },
  });
}

export function documento(o: DeCliente & { mediaId?: string; nombreArchivo?: string } = {}) {
  return mensaje(o, "document", {
    document: {
      caption: "Plano de la cocina",
      filename: o.nombreArchivo ?? "plano-cocina.pdf",
      mime_type: "application/pdf",
      sha256: "kTqXr0E6bV0OZ2y3kP9kq7v0p8Sx4YkY8N3C4d2gIuM=",
      id: o.mediaId ?? "1541542463268411",
    },
  });
}

export function audio(o: DeCliente & { mediaId?: string } = {}) {
  return mensaje(o, "audio", {
    audio: {
      mime_type: "audio/ogg; codecs=opus",
      sha256: "nW3m0wVxwN6p7Zp3uXyWcY3Pp8Mlq5k2zKcB2nJbS1E=",
      id: o.mediaId ?? "1218543282730410",
      voice: true,
    },
  });
}

export function video(o: DeCliente & { mediaId?: string } = {}) {
  return mensaje(o, "video", {
    video: {
      caption: "Mirá cómo hace ruido la puerta",
      mime_type: "video/mp4",
      sha256: "fQ3b4p3hJ0X8rS9nKk2Qm7o4l1sZ8tYx2Wn6cP0dRqU=",
      id: o.mediaId ?? "1166846181421424",
    },
  });
}

export function sticker(o: DeCliente & { mediaId?: string } = {}) {
  return mensaje(o, "sticker", {
    sticker: {
      mime_type: "image/webp",
      sha256: "Zg8u0Zq3pP2kK1oV9yWm5nC3xL7sR4tQ6dF8hJ2bN0E=",
      id: o.mediaId ?? "1228061178226478",
      animated: false,
    },
  });
}

export function ubicacion(o: DeCliente = {}) {
  return mensaje(o, "location", {
    location: {
      address: "Av. Juan B. Justo 4153, Mar del Plata",
      latitude: -38.0204,
      longitude: -57.5714,
      name: "Obra Juan B. Justo",
      url: "https://maps.app.goo.gl/ejemplo",
    },
  });
}

export function contactos(o: DeCliente = {}) {
  return mensaje(o, "contacts", {
    contacts: [
      {
        name: { formatted_name: "Carlos Pereyra", first_name: "Carlos", last_name: "Pereyra" },
        phones: [{ phone: "+54 9 223 555-0199", wa_id: "5492235550199", type: "CELL" }],
        org: { company: "Pereyra Construcciones" },
      },
    ],
  });
}

export function respuestaBoton(o: DeCliente & { idBoton?: string; titulo?: string } = {}) {
  return mensaje(o, "interactive", {
    interactive: {
      type: "button_reply",
      button_reply: { id: o.idBoton ?? "confirmar_retiro", title: o.titulo ?? "Paso mañana" },
    },
  });
}

export function respuestaLista(o: DeCliente = {}) {
  return mensaje(o, "interactive", {
    interactive: {
      type: "list_reply",
      list_reply: {
        id: "sucursal_jbj",
        title: "Juan B. Justo",
        description: "Av. Juan B. Justo 4153",
      },
    },
  });
}

/** El botón de respuesta rápida de una plantilla. */
export function botonPlantilla(o: DeCliente & { texto?: string } = {}) {
  return mensaje(o, "button", {
    button: { payload: "QUIERO_LLAMADO", text: o.texto ?? "Quiero que me llamen" },
  });
}

export function reaccion(o: DeCliente & { aMensaje: string; emoji?: string }) {
  return mensaje(o, "reaction", {
    reaction: { message_id: o.aMensaje, emoji: o.emoji ?? "👍" },
  });
}

/** Un tipo que la Cloud API no entrega (por ejemplo, un mensaje de «ver una vez»). */
export function noSoportado(o: DeCliente = {}) {
  return mensaje(o, "unsupported", {
    errors: [
      {
        code: 131051,
        title: "Message type unknown",
        message: "Message type unknown",
        error_data: { details: "Message type is currently not supported." },
      },
    ],
  });
}

export function sistema(o: DeCliente = {}) {
  return mensaje(o, "system", {
    system: {
      body: "Marta cambió su número de teléfono a 5492235550999",
      wa_id: "5492235550999",
      type: "user_changed_number",
    },
  });
}

export type EstadoMeta = "sent" | "delivered" | "read" | "failed";

/**
 * Un aviso de estado de un mensaje que mandamos.
 *
 * Desde julio de 2025 `pricing` informa el cobro por mensaje
 * (`pricing_model: "PMP"`), con la categoría y si se factura. Desde el
 * 1/10/2026 el servicio también se cobra: viene `billable: true, type:
 * "regular"`, y es lo que se manda por omisión. Lo que Meta no cobra (lo que
 * llega desde un anuncio, por ejemplo) se prueba con `cobrable: false`.
 */
export function estado(
  o: Base & {
    id: string;
    estado: EstadoMeta;
    para?: string;
    ts?: number;
    categoria?: "service" | "utility" | "marketing" | "authentication";
    /** Si Meta lo factura. Por omisión, sí: desde el 1/10/2026 se cobra todo. */
    cobrable?: boolean;
    error?: { code: number; title: string; message?: string; details?: string };
  },
) {
  const categoria = o.categoria ?? "service";
  const facturable = o.cobrable ?? true;
  return envolver(o, "messages", {
    statuses: [
      {
        id: o.id,
        status: o.estado,
        timestamp: String(o.ts ?? ahora()),
        recipient_id: o.para ?? "5492235550123",
        recipient_user_id: bsuid(o.para ?? "5492235550123"),
        ...(o.estado === "failed"
          ? {
              errors: [
                {
                  code: o.error?.code ?? 131047,
                  title: o.error?.title ?? "Re-engagement message",
                  message: o.error?.message ?? o.error?.title ?? "Re-engagement message",
                  error_data: {
                    details:
                      o.error?.details ??
                      "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
                  },
                  href: "https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/",
                },
              ],
            }
          : {
              // `conversation` ya no viene desde la v24.0 (salvo en la ventana
              // de los anuncios): con el cobro por mensaje no tiene sentido.
              pricing: {
                billable: facturable,
                pricing_model: "PMP",
                category: categoria,
                type: facturable ? "regular" : "free_customer_service",
              },
            }),
      },
    ],
  });
}

export function plantillaAprobada(o: Base & { nombre: string; idioma?: string; evento?: string; motivo?: string }) {
  return envolver(o, "message_template_status_update", {
    event: o.evento ?? "APPROVED",
    message_template_id: 594425479261596,
    message_template_name: o.nombre,
    message_template_language: o.idioma ?? "es_AR",
    reason: o.motivo ?? "NONE",
  });
}

export function calidad(o: Base & { evento?: string; limite?: string } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: o.wabaId ?? WABA_ID,
        time: ahora(),
        changes: [
          {
            value: {
              display_phone_number: o.telefonoNegocio ?? TELEFONO_NEGOCIO,
              event: o.evento ?? "FLAGGED",
              current_limit: o.limite ?? "TIER_1K",
            },
            field: "phone_number_quality_update",
          },
        ],
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Coexistencia                                                                */
/* -------------------------------------------------------------------------- */

/*
 * La forma sale de la referencia de webhooks de Meta (revisada el 14/10/2026):
 * developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/
 * `smb_message_echoes`, `history` y `smb_app_state_sync`, y de la guía
 * «Onboarding WhatsApp Business app users» (coexistencia).
 */

/**
 * Lo que el negocio escribió desde la app del teléfono, con el número en
 * coexistencia (`smb_message_echoes`). `from` es el negocio y `to` el cliente;
 * no trae `pricing` porque no se cobra.
 */
export function ecoDelTelefono(
  o: Base & { para?: string; cuerpo?: string; id?: string; ts?: number; sinCampo?: "to" | "id" | "from" } = {},
) {
  const eco: Record<string, unknown> = {
    from: o.telefonoNegocio ?? TELEFONO_NEGOCIO,
    to: o.para ?? "5492235550123",
    id: o.id ?? wamid(),
    timestamp: String(o.ts ?? ahora()),
    type: "text",
    text: { body: o.cuerpo ?? "Sí, te lo dejamos separado hasta el sábado." },
  };
  // Para probar el camino que falla: un eco al que le falta un campo.
  if (o.sinCampo) delete eco[o.sinCampo];
  return envolver(o, "smb_message_echoes", { message_echoes: [eco] });
}

/** Un eco con una foto mandada desde el teléfono. */
export function ecoConImagen(o: Base & { para?: string; mediaId?: string } = {}) {
  return envolver(o, "smb_message_echoes", {
    message_echoes: [
      {
        from: o.telefonoNegocio ?? TELEFONO_NEGOCIO,
        to: o.para ?? "5492235550123",
        id: wamid(),
        timestamp: String(ahora()),
        type: "image",
        image: {
          caption: "Así lo tenemos en el depósito",
          mime_type: "image/jpeg",
          sha256: "Dq3lTZ0w8nFqUmXmJ2c3sAvXcLq6KjVd2t3oFpPpJfE=",
          id: o.mediaId ?? "1037543291543636",
        },
      },
    ],
  });
}

/** Desde la app se borró (`revoke`) o se editó (`edit`) un mensaje ya mandado. */
export function ecoCambio(o: Base & { original: string; cambio: "revoke" | "edit"; cuerpo?: string; para?: string }) {
  const base = {
    from: o.telefonoNegocio ?? TELEFONO_NEGOCIO,
    to: o.para ?? "5492235550123",
    id: wamid(),
    timestamp: String(ahora()),
    type: o.cambio,
  };
  return envolver(o, "smb_message_echoes", {
    message_echoes: [
      o.cambio === "revoke"
        ? { ...base, revoke: { original_message_id: o.original } }
        : {
            ...base,
            edit: {
              original_message_id: o.original,
              message: { type: "text", text: { body: o.cuerpo ?? "Mejor el lunes." } },
            },
          },
    ],
  });
}

export interface MensajeDeHistorialFixture {
  /** Si lo escribió el negocio (from = el negocio) o el cliente. */
  delNegocio?: boolean;
  id?: string;
  cuerpo?: string;
  ts?: number;
  tipo?: "text" | "media_placeholder";
  estado?: "SENT" | "DELIVERED" | "READ" | "PLAYED" | "PENDING" | "ERROR";
}

/**
 * Una parte del historial de chats (`history`), como la manda Meta al conectar
 * el número en coexistencia: hilos por cliente con sus mensajes.
 */
export function historial(
  o: Base & {
    hilos?: { cliente: string; mensajes: MensajeDeHistorialFixture[] }[];
    fase?: number;
    parte?: number;
    progreso?: number;
  } = {},
) {
  const negocio = o.telefonoNegocio ?? TELEFONO_NEGOCIO;
  const hilos = o.hilos ?? [
    {
      cliente: "5492235550123",
      mensajes: [
        { delNegocio: false, cuerpo: "Hola, ¿cuánto sale la placa de MDF de 18?", ts: ahora() - 86_400 * 3 },
        { delNegocio: true, cuerpo: "Hola Marta, $ 48.500 la entera.", ts: ahora() - 86_400 * 3 + 600, estado: "READ" },
        { delNegocio: true, tipo: "media_placeholder", ts: ahora() - 86_400 * 3 + 700, estado: "DELIVERED" },
      ],
    },
  ];
  return envolver(o, "history", {
    history: [
      {
        metadata: { phase: o.fase ?? 0, chunk_order: o.parte ?? 1, progress: o.progreso ?? 100 },
        threads: hilos.map((h) => ({
          id: h.cliente,
          messages: h.mensajes.map((m) => ({
            from: m.delNegocio ? negocio : h.cliente,
            id: m.id ?? wamid(),
            timestamp: String(m.ts ?? ahora()),
            type: m.tipo ?? "text",
            ...((m.tipo ?? "text") === "text" ? { text: { body: m.cuerpo ?? "Gracias" } } : {}),
            history_context: { status: m.estado ?? "READ" },
          })),
        })),
      },
    ],
  });
}

/** El adjunto de un `media_placeholder` del historial, que llega después y aparte. */
export function historialMedio(o: Base & { id: string; de?: string; mediaId?: string }) {
  return envolver(o, "history", {
    messages: [
      {
        from: o.de ?? o.telefonoNegocio ?? TELEFONO_NEGOCIO,
        id: o.id,
        timestamp: String(ahora()),
        type: "image",
        image: {
          caption: "La placa que te comenté",
          mime_type: "image/jpeg",
          sha256: "3f9d94d399fa61c191bc1d4ca71375a035cd9b9f5b1128e1f0963a415c16b0cc",
          id: o.mediaId ?? "1037543291543636",
        },
      },
    ],
  });
}

/** El negocio eligió no compartir el historial al conectar (error 2593109). */
export function historialRechazado(o: Base = {}) {
  return envolver(o, "history", {
    history: [
      {
        errors: [
          {
            code: 2593109,
            title: "History sync is turned off by the business from the WhatsApp Business App",
            message: "History sync is turned off by the business from the WhatsApp Business App",
            error_data: { details: "History sharing is turned off by the business" },
          },
        ],
      },
    ],
  });
}

/** Contactos de la agenda de la app (`smb_app_state_sync`). */
export function contactosDeLaApp(
  o: Base & { contactos?: { telefono: string; nombre?: string; accion?: "add" | "remove" }[] } = {},
) {
  const contactos = o.contactos ?? [{ telefono: "5492235550123", nombre: "Marta Gómez (obra Alem)" }];
  return envolver(o, "smb_app_state_sync", {
    state_sync: contactos.map((c) => ({
      type: "contact",
      contact:
        (c.accion ?? "add") === "remove"
          ? { phone_number: c.telefono }
          : { full_name: c.nombre ?? "Sin nombre", first_name: (c.nombre ?? "Sin").split(" ")[0], phone_number: c.telefono },
      action: c.accion ?? "add",
      metadata: { timestamp: String(ahora()) },
    })),
  });
}

/** Meta cortó la coexistencia porque el teléfono no abrió la app en ~14 días. */
export function coexistenciaCortada(o: Base = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: o.wabaId ?? WABA_ID,
        time: ahora(),
        changes: [
          {
            value: {
              event: "PARTNER_REMOVED",
              disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "SYSTEM" },
            },
            field: "account_update",
          },
        ],
      },
    ],
  };
}

export const CONSTANTES = { PHONE_NUMBER_ID, TELEFONO_NEGOCIO, WABA_ID };
