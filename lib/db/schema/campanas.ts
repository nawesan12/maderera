import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";

/**
 * Campañas de correo a clientes.
 *
 * La clienta pidió el correo en el servidor (1/10/2026), y con él poder
 * mandarle a la cartera las novedades y promociones: una lista de precios
 * nueva, un evento, las cuotas del mes. Hasta ahora el sistema solo mandaba
 * avisos de una operación —tu pedido, tu recibo—, uno por vez.
 *
 * **El segmento se guarda como regla y los destinatarios como foto.** La regla
 * («profesionales del rubro carpintería») es lo que se edita; al enviar, se
 * resuelve una vez y cada dirección queda en `campana_envios`. Así lo que se
 * mandó no cambia si mañana alguien cambia de rubro, y el envío en tandas
 * sabe exactamente a quién le falta.
 */
export const estadoCampana = pgEnum("estado_campana", [
  "borrador",
  "programada",
  "enviando",
  "enviada",
  "cancelada",
]);

export interface SegmentoCampana {
  /** Particulares, profesionales o los dos. */
  tipo: "todos" | "particular" | "profesional";
  /** Rubros de `RUBROS_CLIENTE`; vacío = todos. */
  rubros: string[];
  /**
   * Por actividad: `compraron` en los últimos `meses`, o `sinComprar` hace
   * más de `meses` (para reactivar). `null` = sin filtro.
   */
  actividad: { tipo: "compraron" | "sinComprar"; meses: number } | null;
}

export const campanas = pgTable(
  "campanas",
  {
    id: uuid().primaryKey().defaultRandom(),
    asunto: text().notNull(),
    /** La línea que se ve en la bandeja antes de abrir. */
    adelanto: text(),
    /** Párrafos separados por una línea en blanco; `- ` arma una lista. */
    cuerpo: text().notNull(),
    imagenUrl: text(),
    botonTexto: text(),
    botonUrl: text(),
    segmento: jsonb().$type<SegmentoCampana>().notNull(),
    estado: estadoCampana().notNull().default("borrador"),
    programadaPara: timestamp({ withTimezone: true }),
    creadaPorUserId: text(),
    creadaPorNombre: text(),
    iniciadaAt: timestamp({ withTimezone: true }),
    terminadaAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campanas_estado_idx").on(t.estado, t.programadaPara)],
);

export const estadoEnvioCampana = pgEnum("estado_envio_campana", [
  "pendiente",
  "enviado",
  "fallido",
  /** Se dio de baja entre que se armó la lista y le tocó el turno. */
  "omitido",
]);

export const campanaEnvios = pgTable(
  "campana_envios",
  {
    id: uuid().primaryKey().defaultRandom(),
    campanaId: uuid()
      .notNull()
      .references(() => campanas.id, { onDelete: "cascade" }),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    email: text().notNull(),
    nombre: text(),
    estado: estadoEnvioCampana().notNull().default("pendiente"),
    error: text(),
    enviadoAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // La misma dirección no recibe dos veces la misma campaña, aunque la
    // tengan dos fichas de cliente.
    uniqueIndex("campana_envios_email_idx").on(t.campanaId, sql`lower(${t.email})`),
    index("campana_envios_pendientes_idx")
      .on(t.campanaId)
      .where(sql`${t.estado} = 'pendiente'`),
  ],
);

/**
 * Quién no quiere recibir campañas, por dirección y no por cliente.
 *
 * Por dirección porque la baja llega desde un enlace en el correo, y ese
 * correo pudo haber salido a una dirección que no es de ninguna cuenta. Y
 * porque es lo que pide la ley (25.326, art. 27): quien se da de baja no
 * vuelve a recibir publicidad, tenga o no ficha. **Los avisos de una operación
 * —el pedido, el recibo— siguen saliendo**: no son publicidad, son parte de lo
 * que el cliente compró.
 */
export const bajasDeCorreo = pgTable("bajas_de_correo", {
  /** Siempre en minúsculas. */
  email: text().primaryKey(),
  /** `enlace` (desde el correo), `cuenta` (Mi cuenta) o `panel`. */
  origen: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type Campana = typeof campanas.$inferSelect;
export type CampanaEnvio = typeof campanaEnvios.$inferSelect;
