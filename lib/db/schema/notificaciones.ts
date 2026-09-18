import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Avisos automáticos por email.
 *
 * Tabla aparte de `whatsapp_avisos` y no una columna `canal` sobre aquella
 * porque los dos canales no se configuran igual: WhatsApp necesita el nombre de
 * una plantilla aprobada por Meta y un idioma, y el email necesita un asunto.
 * Meterlos en la misma fila dejaría la mitad de las columnas en null según el
 * canal. La pantalla de `/admin/avisos` los muestra juntos igual.
 *
 * La otra diferencia importante: un email no cuesta plata por mensaje, así que
 * estos sí nacen encendidos.
 */
export const avisosEmail = pgTable(
  "email_avisos",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Nombre del evento: un estado de pedido, o `pago_acreditado`, `factura_emitida`… */
    evento: text().notNull(),
    asunto: text().notNull(),
    /** Texto de encabezado del cuerpo. El resto lo arma la plantilla. */
    encabezado: text(),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("email_avisos_evento_idx").on(t.evento)],
);

export const canalNotificacion = pgEnum("canal_notificacion", [
  "email",
  "whatsapp",
  "push",
]);

/**
 * Los dispositivos que reciben avisos del panel.
 *
 * **Por qué por dispositivo y no por persona.** El permiso de notificaciones lo
 * da el navegador, no el sistema: la misma persona que dijo que sí en el
 * teléfono no dijo nada en la computadora del escritorio, y cada uno tiene su
 * propia suscripción. Por eso la fila lleva `userId` **y** su endpoint: una
 * persona puede tener tres.
 *
 * Lo pidió la clienta después de ver Tiendanube: que el panel avise en el
 * teléfono cuando entra una venta por el sitio, sin tener que mirar el correo.
 *
 * `p256dh` y `auth` son las claves con las que el navegador descifra el mensaje:
 * el servidor de push del navegador **no puede leer el contenido**, solo
 * entregarlo. Son de ese dispositivo y no sirven en ningún otro lado.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text().notNull(),
    /** La dirección que da el navegador. Identifica al dispositivo. */
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    /** Para poder decir cuál es cuál en la pantalla: "Chrome en Android". */
    descripcion: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Última vez que el servidor de push la aceptó. */
    ultimaVezAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId),
  ],
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export const estadoNotificacion = pgEnum("estado_notificacion", [
  "enviada",
  "simulada",
  "fallida",
  "omitida",
]);

/**
 * Bitácora de avisos.
 *
 * "¿Le avisamos al cliente?" es una pregunta que aparece sola cuando alguien
 * dice que nunca le llegó nada. Sin registro, la respuesta depende de la
 * memoria de quien atendió.
 *
 * `simulada` es el estado del proveedor de demostración: el aviso se armó
 * entero y no se mandó porque no hay credenciales cargadas. Se distingue de
 * `enviada` para que nadie lea el log y crea que el correo salió.
 */
export const notificationsLog = pgTable(
  "notifications_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    canal: canalNotificacion().notNull(),
    evento: text().notNull(),
    destinatario: text().notNull(),
    asunto: text(),
    /** Entidad que lo originó, para poder listar los avisos de un pedido. */
    entidadTipo: text(),
    entidadId: uuid(),
    estado: estadoNotificacion().notNull(),
    proveedorMensajeId: text(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_log_entidad_idx").on(t.entidadTipo, t.entidadId),
    index("notifications_log_created_idx").on(t.createdAt),
    index("notifications_log_canal_idx").on(t.canal),
  ],
);

export type AvisoEmail = typeof avisosEmail.$inferSelect;
export type NotificationLog = typeof notificationsLog.$inferSelect;
