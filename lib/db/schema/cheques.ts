import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { orderPayments } from "./sales";
import { user } from "./auth";

/**
 * La cartera de cheques.
 *
 * La clienta pidió "mejor manejo de cheques, 30/60/90 días", y en una maderera
 * el cheque corre en los dos sentidos: los clientes grandes pagan con cheques
 * a fecha, y esos mismos cheques —o los propios— se les entregan a los
 * proveedores. Hasta ahora "cheque" era una palabra en el medio de pago y
 * nadie sabía qué había en el cajón ni qué vencía esta semana.
 *
 * **La fecha de pago es el dato que ordena todo**: un cheque a 60 días es
 * plata que existe recién en dos meses, y la pantalla de cartera vive
 * ordenada por eso.
 */

export const sentidoCheque = pgEnum("sentido_cheque", [
  /** Nos lo dieron: entró por una venta o un pago de cuenta corriente. */
  "recibido",
  /** Lo emitimos o lo endosamos: salió hacia un proveedor. */
  "entregado",
]);

export const tipoCheque = pgEnum("tipo_cheque", ["fisico", "echeq"]);

export const estadoCheque = pgEnum("estado_cheque", [
  /** En el cajón (o en la cuenta, si es echeq), esperando. */
  "cartera",
  /** Endosado o emitido a un proveedor: ya no es nuestro. */
  "entregado",
  /** Depositado, esperando que el banco lo acredite. */
  "depositado",
  /** La plata entró. Acá termina bien. */
  "acreditado",
  /** El banco lo rebotó. Acá empieza otro problema. */
  "rechazado",
  "anulado",
]);

export const cheques = pgTable(
  "cheques",
  {
    id: uuid().primaryKey().defaultRandom(),
    sentido: sentidoCheque().notNull(),
    tipo: tipoCheque().notNull().default("fisico"),
    numero: text().notNull(),
    banco: text(),
    /** Quién lo firmó, si no es de la casa: el librador responde por él. */
    librador: text(),
    emision: timestamp({ withTimezone: true }),
    /** Cuándo se puede cobrar. Es el 30/60/90 y lo que ordena la cartera. */
    fechaPago: timestamp({ withTimezone: true }).notNull(),
    importe: numeric({ precision: 12, scale: 2 }).notNull(),
    estado: estadoCheque().notNull().default("cartera"),
    /** De qué cliente vino, si fue recibido. */
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    /** El pago de mostrador que lo trajo, si vino por ahí. */
    orderPaymentId: uuid().references(() => orderPayments.id, {
      onDelete: "set null",
    }),
    notas: text(),
    createdByUserId: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cheques_estado_idx").on(t.estado, t.fechaPago),
    index("cheques_fecha_pago_idx").on(t.fechaPago),
    index("cheques_customer_idx").on(t.customerId),
  ],
);

export type Cheque = typeof cheques.$inferSelect;
