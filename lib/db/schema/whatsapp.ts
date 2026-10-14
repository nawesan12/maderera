import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { branches } from "./inventory";
import { customers } from "./customers";
import { orders } from "./sales";

/**
 * Bandeja de WhatsApp.
 *
 * La maderera ya atiende por WhatsApp: el número está en la web, en el footer y
 * en el botón flotante. Lo que no hay es registro de esas conversaciones, así
 * que cada consulta vive en el teléfono de quien la atendió y no se puede
 * retomar desde otro puesto ni ver junto al pedido del que habla.
 *
 * El modelo separa la conversación (una por número) de los mensajes, igual que
 * lo hace WhatsApp, y cuelga la conversación del cliente y —cuando aplica— del
 * pedido concreto: eso es lo que permite contestar con la cuenta corriente y el
 * estado del pedido a la vista.
 */

export const estadoConversacion = pgEnum("estado_conversacion", [
  "abierta",
  "cerrada",
]);

export const direccionMensaje = pgEnum("direccion_mensaje", [
  "entrante",
  "saliente",
]);

/**
 * Estado de entrega de un mensaje que sale.
 *
 * Meta los informa por el mismo webhook que trae los entrantes, en `statuses[]`.
 * Importa mostrarlos: "lo mandé" y "le llegó" no son lo mismo cuando el cliente
 * dice que nunca le avisaron.
 */
export const estadoMensaje = pgEnum("estado_mensaje", [
  "pendiente",
  "enviado",
  "entregado",
  "leido",
  "fallido",
]);

export const tipoMedia = pgEnum("tipo_media", [
  "image",
  "document",
  "video",
  "audio",
  "sticker",
]);

export const conversaciones = pgTable(
  "whatsapp_conversaciones",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Número en formato de WhatsApp: "5492235550000@s.whatsapp.net". */
    waJid: text().notNull(),
    /**
     * El identificador de la persona para este negocio (BSUID, `AR.…`).
     *
     * Meta lo manda desde abril de 2026 porque WhatsApp admite nombres de
     * usuario: quien usa uno y no habló con la maderera en los últimos 30 días
     * llega **sin número**, solo con esto. En ese caso `waJid` guarda
     * `bsuid:<id>` y los envíos van por `recipient` en vez de `to`.
     */
    usuarioMetaId: text(),
    /** Cómo se llama la persona según su perfil de WhatsApp. */
    displayName: text(),
    /** Ficha del cliente, si se pudo identificar por el teléfono. */
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    /** Pedido del que se está hablando, cuando la charla es por uno concreto. */
    orderId: uuid().references(() => orders.id, { onDelete: "set null" }),
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),
    estado: estadoConversacion().notNull().default("abierta"),
    /** Quién la está atendiendo. Evita que dos personas contesten lo mismo. */
    asignadoAUserId: text().references(() => user.id, { onDelete: "set null" }),
    ultimoMensajeAt: timestamp({ withTimezone: true }),
    ultimoMensajePreview: text(),
    /**
     * Cuándo escribió el cliente por última vez.
     *
     * Es el dato que decide si se puede contestar con texto libre: Meta solo lo
     * permite dentro de las 24 h del último mensaje del cliente. Pasado ese
     * plazo hay que usar una plantilla aprobada. Guardarlo acá evita recorrer
     * los mensajes para saberlo en cada render de la bandeja.
     */
    ultimoEntranteAt: timestamp({ withTimezone: true }),
    noLeidos: integer().notNull().default(0),
    notas: text(),
    /**
     * Cuándo pidió que no le escriban más («BAJA»).
     *
     * Va en la conversación y no en la ficha porque el consentimiento es del
     * número: un cliente con dos teléfonos puede querer los avisos en uno solo,
     * y alguien que todavía no es cliente también puede pedir la baja. Con
     * esto puesto no sale ningún aviso automático ni campaña a ese número; las
     * respuestas a lo que él pregunte, sí.
     */
    bajaAt: timestamp({ withTimezone: true }),
    /** Lo que escribió para pedirla, o quién la cargó desde el panel. */
    bajaDetalle: text(),
    /** Quién la marcó como resuelta, para la lista de «lo que atendí hoy». */
    resueltaPorUserId: text().references(() => user.id, { onDelete: "set null" }),
    resueltaAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("whatsapp_conversaciones_jid_idx").on(t.waJid),
    index("whatsapp_conversaciones_asignado_idx").on(t.asignadoAUserId),
    index("whatsapp_conversaciones_usuario_meta_idx").on(t.usuarioMetaId),
    index("whatsapp_conversaciones_ultimo_idx").on(t.ultimoMensajeAt),
    index("whatsapp_conversaciones_customer_idx").on(t.customerId),
    index("whatsapp_conversaciones_estado_idx").on(t.estado),
  ],
);

export const mensajes = pgTable(
  "whatsapp_mensajes",
  {
    id: uuid().primaryKey().defaultRandom(),
    conversacionId: uuid()
      .notNull()
      .references(() => conversaciones.id, { onDelete: "cascade" }),
    direccion: direccionMensaje().notNull(),
    /**
     * Id que le puso WhatsApp.
     *
     * Único: el webhook de Meta reintenta cuando no contestás rápido, y sin
     * esta restricción el mismo mensaje entraría dos o tres veces en la
     * bandeja.
     */
    waMessageId: text(),
    /**
     * El tipo de mensaje de WhatsApp: `text`, `image`, `location`,
     * `interactive`… (ver `lib/whatsapp/payload.ts`). Texto y no enum: Meta
     * agrega tipos, y uno nuevo tiene que poder guardarse sin migrar.
     */
    tipo: text().notNull().default("text"),
    cuerpo: text().notNull().default(""),
    /**
     * Dónde quedó guardado el adjunto, **nunca una URL pública**: son fotos y
     * documentos de conversaciones privadas. La bandeja lo pide por
     * `/api/whatsapp/medios/<id del mensaje>`, que exige sesión de la bandeja.
     * Los mensajes viejos pueden tener `/subidas/…`, que la ruta también lee.
     */
    mediaUrl: text(),
    mediaTipo: tipoMedia(),
    mediaMime: text(),
    mediaNombre: text(),
    /**
     * El id del adjunto en Meta. La URL de descarga vence a los minutos, pero
     * con el id se pide otra: es lo que permite reintentar una descarga que
     * falló sin perder lo que mandó el cliente.
     */
    mediaId: text(),
    /** `listo`, `pendiente` (se está bajando) o `fallido` (se puede reintentar). */
    mediaEstado: text(),
    mediaBytes: integer(),
    /** Si cita a otro mensaje (responder a…), el id de WhatsApp de ese. */
    citadoWaMessageId: text(),
    /** Ubicación, contactos, botón tocado, anuncio de origen. */
    datos: jsonb().$type<Record<string, unknown>>(),
    /** El emoji que le puso el cliente a este mensaje. */
    reaccionCliente: text(),
    /** El emoji que le pusimos nosotros. */
    reaccionNuestra: text(),
    estado: estadoMensaje().notNull().default("enviado"),
    estadoAt: timestamp({ withTimezone: true }),
    /**
     * Por qué no salió, con el código de Meta (131047 fuera de la ventana,
     * 190 token vencido…). El mensaje fallido se guarda igual: el texto que
     * escribió quien atiende no se pierde y se puede reintentar.
     */
    errorCodigo: integer(),
    errorDetalle: text(),
    /**
     * Lo que Meta dice que cobra por este mensaje (`pricing` del estado):
     * categoría y si es facturable. Con esto la configuración muestra cuánto
     * se gastó en el mes sin esperar la factura de Meta.
     */
    cobroCategoria: text(),
    cobrable: boolean(),
    /**
     * De dónde salió un saliente: `panel` (alguien de la bandeja), `aviso`
     * (automático), `telefono` (escrito desde la app con el número en
     * coexistencia) o `sistema` (la confirmación de una baja).
     */
    origen: text(),
    /** Si salió como plantilla aprobada, cuál. */
    plantilla: text(),
    /** Quién lo mandó desde el panel. Null si lo generó un aviso automático. */
    enviadoPorUserId: text().references(() => user.id, { onDelete: "set null" }),
    /** Momento del mensaje según WhatsApp, que puede no ser el de llegada. */
    ocurridoAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("whatsapp_mensajes_conversacion_idx").on(t.conversacionId, t.ocurridoAt),
    uniqueIndex("whatsapp_mensajes_wa_id_idx").on(t.waMessageId),
    // Para el gasto del mes: se cuenta por fecha y solo lo facturable.
    index("whatsapp_mensajes_cobro_idx").on(t.cobrable, t.createdAt),
  ],
);

/**
 * Estado de la conexión con WhatsApp. Una sola fila.
 *
 * Con la Cloud API no hay sesión que se caiga ni QR que escanear: "conectado"
 * significa que las credenciales de Meta están cargadas. La fila existe igual
 * para que la pantalla lea siempre de la misma fuente, y para poder mostrar
 * desde cuándo no entra un mensaje.
 */
export const sesionWhatsapp = pgTable("whatsapp_sesion", {
  id: uuid().primaryKey().defaultRandom(),
  proveedor: text().notNull().default("demo"),
  conectado: boolean().notNull().default(false),
  telefono: text(),
  ultimaSenal: timestamp({ withTimezone: true }),
  detalle: text(),
  /** Último POST de Meta con firma válida: si no llega nada, el webhook no está suscripto. */
  ultimoWebhookAt: timestamp({ withTimezone: true }),
  /** Calidad del número según Meta (GREEN, YELLOW, RED) y el último cambio de límite. */
  calidad: text(),
  limiteMensajes: text(),
  /** El último chequeo de la configuración, para no repetirlo en cada visita. */
  diagnostico: jsonb().$type<Record<string, unknown>>(),
  diagnosticoAt: timestamp({ withTimezone: true }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Las plantillas del WABA, copiadas de Meta.
 *
 * Se sincronizan (botón de la configuración, tarea diaria y el webhook
 * `message_template_status_update`) en vez de pedirlas en cada render: la
 * bandeja las necesita para decidir qué ofrecer fuera de la ventana de 24 h, y
 * la Graph API no puede estar en el camino de abrir una conversación.
 *
 * Una fila por nombre **e idioma**, que es como las identifica Meta.
 */
export const plantillasWhatsapp = pgTable(
  "whatsapp_plantillas",
  {
    id: uuid().primaryKey().defaultRandom(),
    metaId: text(),
    nombre: text().notNull(),
    idioma: text().notNull(),
    /** MARKETING, UTILITY o AUTHENTICATION: decide cuánto cuesta cada envío. */
    categoria: text(),
    /** APPROVED, PENDING, REJECTED, PAUSED, DISABLED… Solo APPROVED se ofrece. */
    estado: text().notNull(),
    motivoRechazo: text(),
    /** POSITIONAL ({{1}}) o NAMED ({{nombre}}). */
    formatoParametros: text().notNull().default("POSITIONAL"),
    /** Los componentes tal como los devuelve Meta (HEADER, BODY, FOOTER, BUTTONS). */
    componentes: jsonb().$type<unknown[]>().notNull(),
    sincronizadaAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("whatsapp_plantillas_nombre_idioma_idx").on(t.nombre, t.idioma)],
);

/**
 * Avisos automáticos al cambiar el estado de un pedido.
 *
 * Cada fila dice: "cuando un pedido pase a `listo`, mandale al cliente la
 * plantilla `pedido_listo`". Se configuran desde el panel y no en el código
 * porque el texto lo aprueba Meta y el negocio va a querer cambiar cuáles
 * dispara sin tocar el sistema.
 *
 * Cada envío es una conversación facturada por Meta, así que el interruptor por
 * estado no es un lujo: es control de gasto.
 */
export const avisosWhatsapp = pgTable(
  "whatsapp_avisos",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Estado de pedido que lo dispara (`estado_pedido`, como texto). */
    evento: text().notNull(),
    /** Plantilla aprobada del WABA que se envía. */
    plantilla: text().notNull(),
    idioma: text().notNull().default("es_AR"),
    /**
     * Texto que se manda si la conversación está abierta (dentro de las 24 h).
     * Ahí no hace falta plantilla y el mensaje sale sin costo de plantilla.
     */
    textoLibre: text(),
    activo: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("whatsapp_avisos_evento_idx").on(t.evento)],
);

export const conversacionesRelations = relations(
  conversaciones,
  ({ one, many }) => ({
    customer: one(customers, {
      fields: [conversaciones.customerId],
      references: [customers.id],
    }),
    order: one(orders, {
      fields: [conversaciones.orderId],
      references: [orders.id],
    }),
    branch: one(branches, {
      fields: [conversaciones.branchId],
      references: [branches.id],
    }),
    mensajes: many(mensajes),
  }),
);

export const mensajesRelations = relations(mensajes, ({ one }) => ({
  conversacion: one(conversaciones, {
    fields: [mensajes.conversacionId],
    references: [conversaciones.id],
  }),
}));

export type Conversacion = typeof conversaciones.$inferSelect;
export type MensajeWhatsapp = typeof mensajes.$inferSelect;
export type AvisoWhatsapp = typeof avisosWhatsapp.$inferSelect;
export type PlantillaWhatsapp = typeof plantillasWhatsapp.$inferSelect;
