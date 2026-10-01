import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { branches } from "./inventory";
import { cheques } from "./cheques";
import { payments } from "./pagos";
import { user } from "./auth";

/**
 * Recibos: el papel de cada cobro.
 *
 * De la clienta (30/9/2026): «también emitir los recibos de cada pago». Hasta
 * acá un cobro era una fila negativa en `account_movements` con un texto libre:
 * nadie podía darle al cliente un comprobante de lo que pagó, ni decir con qué
 * lo pagó —tres cheques y un poco de efectivo eran un número y nada más—.
 *
 * **Un recibo por cobro, con sus partes.** El cliente paga una vez y con
 * varios medios; el recibo es esa vez, y cada medio es una parte. El cheque de
 * una parte queda atado: así, cuando el banco lo rechaza, se sabe de qué
 * recibo era y a quién reclamárselo.
 *
 * **El recibo es la única forma de registrar un pago.** `emitirRecibo` en
 * `lib/cobros/recibo.ts` crea el recibo y su único movimiento de cuenta en la
 * misma transacción, y todos los caminos que cobran pasan por ahí —el panel,
 * el mostrador, la factura, la transferencia conciliada, Mercado Pago—.
 *
 * Como un comprobante fiscal, un recibo emitido no se edita ni se borra: se
 * anula, y la anulación deja su propio asiento que revierte el pago.
 */

export const estadoRecibo = pgEnum("estado_recibo", ["emitido", "anulado"]);

/** Por dónde entró el cobro. Sirve para filtrar y para explicar un recibo. */
export const origenRecibo = pgEnum("origen_recibo", [
  /** Cargado desde la ficha del cliente o la cartera de cheques. */
  "panel",
  "mostrador",
  /** Informado por el cliente desde Mi cuenta y aceptado por la casa. */
  "portal",
  "mercado_pago",
  /** El cobro de una factura. */
  "factura",
]);

/**
 * Con qué se pagó. Es el mismo vocabulario en todos lados: el recibo, el
 * mostrador y Mi cuenta dicen lo mismo de cada parte.
 */
export const medioDeCobro = pgEnum("medio_de_cobro", [
  "efectivo",
  "transferencia",
  /** En la cuenta del banco, por ventanilla: no es una transferencia. */
  "deposito",
  "cheque",
  "echeq",
  "tarjeta_debito",
  "tarjeta_credito",
  "mercado_pago",
  /** Una retención que nos practicó el cliente: cancela deuda sin plata. */
  "retencion",
]);

/*
 * El saldo a favor no es un medio de cobro, y no está en la lista a propósito.
 * La cuenta corriente es un solo libro: lo que el cliente tiene a favor ya
 * descuenta de lo que debe sin que nadie haga nada. Donde sí se usa es al
 * comprar —el checkout y el mostrador lo ofrecen—, y ahí la compra se carga a
 * la cuenta y el saldo la absorbe. Un recibo «pagado con saldo a favor» sería
 * un pago que no entró.
 */

export const receipts = pgTable(
  "receipts",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** `REC-0001`. Serie propia, con lock: ver `siguienteNumeroDeRecibo`. */
    numero: text().notNull(),
    /**
     * De quién. Nulo en el cobro de una factura a consumidor final, que no
     * tiene cuenta: el recibo existe igual y lleva el nombre en `recibidoDe`.
     */
    customerId: uuid().references(() => customers.id, { onDelete: "restrict" }),
    /** El nombre tal como se imprime, congelado como en una factura. */
    recibidoDe: text().notNull(),
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),
    total: numeric({ precision: 12, scale: 2 }).notNull(),
    estado: estadoRecibo().notNull().default("emitido"),
    origen: origenRecibo().notNull(),
    /** Qué se está pagando, en palabras: «Cobro de Factura B 0015-00001234». */
    concepto: text(),
    /** El movimiento de cuenta corriente que generó, si el cliente tiene cuenta. */
    accountMovementId: uuid(),
    /** El asiento que lo revirtió al anularlo. */
    anulacionMovementId: uuid(),
    motivoAnulacion: text(),
    anuladoAt: timestamp({ withTimezone: true }),
    anuladoPorUserId: text().references(() => user.id),
    createdByUserId: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("receipts_numero_idx").on(t.numero),
    index("receipts_customer_idx").on(t.customerId, t.createdAt),
    index("receipts_created_idx").on(t.createdAt),
  ],
);

export const receiptParts = pgTable(
  "receipt_parts",
  {
    id: uuid().primaryKey().defaultRandom(),
    receiptId: uuid()
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    medio: medioDeCobro().notNull(),
    importe: numeric({ precision: 12, scale: 2 }).notNull(),
    /** El cheque de esta parte, si fue con cheque o e-Cheq. */
    chequeId: uuid().references(() => cheques.id, { onDelete: "restrict" }),
    /** La transferencia o el pago online que se concilió, si vino por ahí. */
    paymentId: uuid().references(() => payments.id, { onDelete: "set null" }),
    /** Número de operación, de lote o de cupón: lo que se busca en el banco. */
    referencia: text(),
    orden: integer().notNull().default(0),
  },
  (t) => [
    index("receipt_parts_receipt_idx").on(t.receiptId),
    index("receipt_parts_cheque_idx").on(t.chequeId),
  ],
);

export type Receipt = typeof receipts.$inferSelect;
export type ReceiptPart = typeof receiptParts.$inferSelect;
export type MedioDeCobro = (typeof medioDeCobro.enumValues)[number];
