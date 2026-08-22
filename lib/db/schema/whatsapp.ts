import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
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
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("whatsapp_conversaciones_jid_idx").on(t.waJid),
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
    cuerpo: text().notNull().default(""),
    mediaUrl: text(),
    mediaTipo: tipoMedia(),
    mediaMime: text(),
    mediaNombre: text(),
    estado: estadoMensaje().notNull().default("enviado"),
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
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

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
