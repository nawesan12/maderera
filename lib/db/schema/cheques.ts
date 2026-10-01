import { sql } from "drizzle-orm";
import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { orderPayments } from "./sales";
import { user } from "./auth";
import { circuito } from "./circuito";

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
  /**
   * El cliente dice que lo mandó y todavía no lo tenemos en mano.
   *
   * Nace cuando un cliente paga su cuenta corriente desde Mi cuenta (30/9/2026:
   * «que el usuario pueda pagar su cuenta corriente con cheques»). No mueve la
   * cuenta: recién al **aceptarlo** se emite el recibo y baja la deuda. Un
   * cheque que nadie vio no es un pago.
   */
  "informado",
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
    /**
     * Por qué circuito va el cheque. Ver `circuito.ts`.
     *
     * Un cheque es plata que entra o sale, así que le corresponde igual que al
     * pago: si no, la cartera suma los dos circuitos en un solo total y deja de
     * contestar "cuánto tengo que cubrir esta semana" para cada uno.
     */
    circuito: circuito().notNull().default("blanco"),
    /**
     * El recibo que lo trajo, si fue un cobro.
     *
     * Sin FK a propósito: `receipts` ya apunta a `cheques` por sus partes, y
     * la referencia en los dos sentidos ataría los dos módulos en un ciclo.
     */
    receiptId: uuid(),
    /** Por qué se rechazó, cuando se rechaza: lo lee el cliente en Mi cuenta. */
    motivoRechazo: text(),
    notas: text(),
    createdByUserId: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cheques_estado_idx").on(t.estado, t.fechaPago),
    index("cheques_fecha_pago_idx").on(t.fechaPago),
    index("cheques_customer_idx").on(t.customerId),
    index("cheques_circuito_idx").on(t.circuito, t.fechaPago),
    /*
     * El mismo cheque no se carga dos veces.
     *
     * De la clienta: «cargar número de cheque para que la gente sepa cuál
     * cheque es en el banco». El número solo identifica junto con el banco, y
     * solo entre los vivos: uno rechazado o anulado puede volver a cargarse
     * corregido. Sin esto, el mismo cheque informado por el cliente y cargado
     * en el mostrador bajaba la deuda dos veces.
     */
    uniqueIndex("cheques_recibido_unico_idx")
      .on(sql`lower(coalesce(${t.banco}, ''))`, t.numero)
      .where(sql`${t.sentido} = 'recibido' and ${t.estado} not in ('anulado', 'rechazado')`),
  ],
);

export type Cheque = typeof cheques.$inferSelect;
