import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { customers } from "./customers";
import { purchaseInvoices, suppliers } from "./compras";
import { circuito } from "./circuito";
import { cheques } from "./cheques";

/**
 * Retenciones: las que practicamos y las que nos practican.
 *
 * **La confusión que este archivo existe para evitar:** una retención
 * practicada **no es un gasto, es parte del pago**. Se le pagan $100 de factura
 * con $95 de transferencia y $5 de retención, y la deuda queda saldada en $100.
 * Por eso va **un solo** movimiento de cuenta corriente por el total, con la
 * retención en el detalle del pago; anotar dos duplicaría la baja de deuda.
 * Contra el fisco es un pasivo, y eso aparece en el asiento, no en la cuenta
 * del proveedor.
 *
 * La sufrida es el espejo: el cliente pagó $95 y entregó un certificado por $5,
 * la cuenta se salda en $100 y contra el fisco queda un crédito.
 */

export const impuestoRetenido = pgEnum("impuesto_retenido", [
  "ganancias",
  "iva",
  "suss",
  "iibb",
]);

/**
 * Los regímenes con sus alícuotas y mínimos.
 *
 * **Son datos y no constantes del código.** ARCA los actualiza por resolución
 * varias veces al año, y que un cambio de mínimo no imponible exija un deploy
 * garantiza que en algún momento se retenga con los valores del año pasado.
 */
export const regimenesRetencion = pgTable(
  "regimenes_retencion",
  {
    id: uuid().primaryKey().defaultRandom(),

    /** El código que va impreso en el certificado. */
    codigo: text().notNull(),
    nombre: text().notNull(),
    impuesto: impuestoRetenido().notNull(),

    alicuota: numeric({ precision: 6, scale: 3 }).notNull(),
    alicuotaNoInscripto: numeric({ precision: 6, scale: 3 }).notNull(),

    /** Se resta del **acumulado del mes**, no de cada pago. */
    minimoNoImponible: numeric({ precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    minimoRetencion: numeric({ precision: 12, scale: 2 }).notNull().default("0"),

    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("regimenes_retencion_codigo_idx").on(t.codigo)],
);

/**
 * Pagos a proveedores.
 *
 * El pago es el documento y las retenciones cuelgan de él: el proveedor recibe
 * la transferencia y los certificados juntos, y la deuda baja por la suma de
 * los dos. Separarlos haría que el importe transferido y la baja de deuda nunca
 * coincidan y que nadie sepa cuál de los dos mirar.
 */
export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: uuid().primaryKey().defaultRandom(),

    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),

    fecha: timestamp({ withTimezone: true }).notNull().defaultNow(),

    /** Lo que se le imputa a la deuda: transferencia más retenciones. */
    total: numeric({ precision: 12, scale: 2 }).notNull(),
    /** Lo que efectivamente salió del banco o del cajón. */
    neto: numeric({ precision: 12, scale: 2 }).notNull(),

    medio: text().notNull().default("transferencia"),
    referencia: text(),
    notas: text(),

    /** Por qué circuito de facturación salió el pago. Ver `circuito.ts`. */
    circuito: circuito().notNull().default("blanco"),

    createdByUserId: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("supplier_payments_supplier_idx").on(t.supplierId),
    index("supplier_payments_fecha_idx").on(t.fecha),
    index("supplier_payments_circuito_idx").on(t.circuito, t.fecha),
  ],
);

/**
 * A qué facturas se imputa un pago a proveedor.
 *
 * De la clienta: "en pagos a proveedores poder relacionar con las facturas y
 * ver si pagó el total o pagó parcial". Hasta ahora el saldo se llevaba por
 * suma de movimientos y ninguna factura sabía cuánto le habían pagado. Un
 * pago puede cubrir varias facturas y una factura puede cobrarse en varios
 * pagos: por eso es una tabla y no una FK.
 *
 * Los pagos anteriores a esta tabla quedan sin imputar; se pueden imputar
 * después desde la factura, y el saldo global no cambia por eso.
 */
export const supplierPaymentAllocations = pgTable(
  "supplier_payment_allocations",
  {
    id: uuid().primaryKey().defaultRandom(),
    paymentId: uuid()
      .notNull()
      .references(() => supplierPayments.id, { onDelete: "cascade" }),
    purchaseInvoiceId: uuid()
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: "restrict" }),
    importe: numeric({ precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    index("supplier_payment_allocations_payment_idx").on(t.paymentId),
    index("supplier_payment_allocations_invoice_idx").on(t.purchaseInvoiceId),
  ],
);

export type SupplierPaymentAllocation =
  typeof supplierPaymentAllocations.$inferSelect;

/**
 * Con qué se pagó, renglón por renglón.
 *
 * "Poder adjuntar varias formas de pago para las facturas": el pago real a un
 * proveedor suele ser una transferencia más dos cheques a fecha. El `medio`
 * único de `supplier_payments` queda como el principal, para las pantallas y
 * los pagos viejos; el detalle vive acá, y un renglón de cheque apunta al
 * cheque de la cartera.
 */
export const supplierPaymentParts = pgTable(
  "supplier_payment_parts",
  {
    id: uuid().primaryKey().defaultRandom(),
    paymentId: uuid()
      .notNull()
      .references(() => supplierPayments.id, { onDelete: "cascade" }),
    /** transferencia | cheque | echeq | efectivo — el mismo texto del pago. */
    medio: text().notNull(),
    importe: numeric({ precision: 12, scale: 2 }).notNull(),
    referencia: text(),
    /** El cheque de la cartera que salió con este renglón, si es cheque. */
    chequeId: uuid().references(() => cheques.id, { onDelete: "set null" }),
  },
  (t) => [index("supplier_payment_parts_payment_idx").on(t.paymentId)],
);

export type SupplierPaymentPart = typeof supplierPaymentParts.$inferSelect;

/**
 * Una retención practicada: el certificado que se le entrega al proveedor.
 *
 * `numero` es el del certificado y lleva índice único: dos certificados con el
 * mismo número son dos papeles que dicen ser el mismo, y el proveedor los va a
 * presentar en su declaración.
 */
export const retencionesPracticadas = pgTable(
  "retenciones_practicadas",
  {
    id: uuid().primaryKey().defaultRandom(),

    paymentId: uuid()
      .notNull()
      .references(() => supplierPayments.id, { onDelete: "cascade" }),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    regimenId: uuid()
      .notNull()
      .references(() => regimenesRetencion.id, { onDelete: "restrict" }),

    numero: text().notNull(),

    /* Se copian del régimen al momento de retener: si mañana ARCA cambia la
       alícuota, el certificado emitido tiene que seguir diciendo la de ese día. */
    codigoRegimen: text().notNull(),
    impuesto: impuestoRetenido().notNull(),
    base: numeric({ precision: 12, scale: 2 }).notNull(),
    alicuota: numeric({ precision: 6, scale: 3 }).notNull(),
    importe: numeric({ precision: 12, scale: 2 }).notNull(),

    fecha: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("retenciones_practicadas_numero_idx").on(t.numero),
    index("retenciones_practicadas_pago_idx").on(t.paymentId),
    index("retenciones_practicadas_fecha_idx").on(t.fecha),
  ],
);

/**
 * Una retención sufrida: el certificado que nos entrega el cliente.
 *
 * **Baja lo que el cliente debe.** Pagó $95 y trajo un papel por $5: la cuenta
 * se salda en $100. Tratarla como un descuento comercial la sacaría del crédito
 * fiscal, que es plata que se recupera contra el impuesto.
 */
export const retencionesSufridas = pgTable(
  "retenciones_sufridas",
  {
    id: uuid().primaryKey().defaultRandom(),

    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),

    /** El número que trae el certificado del cliente. */
    numero: text().notNull(),
    impuesto: impuestoRetenido().notNull(),
    codigoRegimen: text(),

    base: numeric({ precision: 12, scale: 2 }).notNull(),
    alicuota: numeric({ precision: 6, scale: 3 }),
    importe: numeric({ precision: 12, scale: 2 }).notNull(),

    fecha: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** El comprobante contra el que retuvieron, como lo nombra el cliente. */
    referencia: text(),

    createdByUserId: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /*
     * Un certificado por cliente y número. Cargar dos veces el mismo papel
     * saldaría dos veces la misma deuda y computaría dos veces el crédito.
     */
    uniqueIndex("retenciones_sufridas_numero_idx").on(t.customerId, t.numero),
    index("retenciones_sufridas_fecha_idx").on(t.fecha),
  ],
);

export const supplierPaymentsRelations = relations(
  supplierPayments,
  ({ one, many }) => ({
    proveedor: one(suppliers, {
      fields: [supplierPayments.supplierId],
      references: [suppliers.id],
    }),
    retenciones: many(retencionesPracticadas),
  }),
);

export const retencionesPracticadasRelations = relations(
  retencionesPracticadas,
  ({ one }) => ({
    pago: one(supplierPayments, {
      fields: [retencionesPracticadas.paymentId],
      references: [supplierPayments.id],
    }),
    regimen: one(regimenesRetencion, {
      fields: [retencionesPracticadas.regimenId],
      references: [regimenesRetencion.id],
    }),
  }),
);

export type RegimenRetencionFila = typeof regimenesRetencion.$inferSelect;
export type SupplierPayment = typeof supplierPayments.$inferSelect;
export type RetencionPracticada = typeof retencionesPracticadas.$inferSelect;
export type RetencionSufrida = typeof retencionesSufridas.$inferSelect;
