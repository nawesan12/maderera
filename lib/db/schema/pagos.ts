import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { orders } from "./sales";

/**
 * Cobros.
 *
 * Tabla propia y no un par de columnas en `orders` porque un pago no siempre
 * corresponde a un pedido: cancelar deuda de cuenta corriente e inscribirse a
 * un evento también son cobros, y todos tienen que caer en el mismo lugar para
 * que la pantalla de conciliación muestre la plata que entró, y no la plata que
 * entró por un canal.
 *
 * Un pago tampoco se borra ni se edita una vez acreditado: se revierte con otro
 * pago de signo contrario, por lo mismo que un comprobante emitido se corrige
 * con una nota de crédito.
 */

export const tipoPago = pgEnum("tipo_pago", [
  "pedido",
  "deuda",
  "inscripcion",
]);

export const proveedorPago = pgEnum("proveedor_pago", [
  "mercado_pago",
  "transferencia",
  // El mostrador cobra en mano. Entra al mismo lugar que el resto porque la
  // pantalla de cobros tiene que mostrar la plata que entró y no la plata que
  // entró por internet: una venta de $300.000 en efectivo es tan cobro como una
  // aprobada por Mercado Pago.
  "mostrador",
  "demo",
]);

/**
 * Estados, en el orden en que ocurren.
 *
 * `iniciado` es "se generó el link y todavía no volvió nadie": la mayoría de
 * los abandonos de checkout quedan acá para siempre, y por eso conviene poder
 * distinguirlos de un rechazo real.
 */
export const estadoCobro = pgEnum("estado_cobro", [
  "iniciado",
  "pendiente",
  "en_revision",
  "aprobado",
  "rechazado",
  "reintegrado",
  "cancelado",
]);

export const payments = pgTable(
  "payments",
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid().references(() => orders.id, { onDelete: "set null" }),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    tipo: tipoPago().notNull().default("pedido"),
    proveedor: proveedorPago().notNull(),
    /** Preferencia / intención de pago del proveedor. Sirve para reabrir el link. */
    preferenciaId: text(),
    /**
     * Id del pago en el proveedor.
     *
     * Es la llave de idempotencia: Mercado Pago reintenta el webhook y manda el
     * mismo id varias veces. El índice único evita acreditar dos veces aunque
     * dos reintentos lleguen en paralelo, que es exactamente lo que pasa cuando
     * el primero tarda.
     */
    proveedorPaymentId: text(),
    /** Medio concreto informado por el proveedor: visa, rapipago, cuenta MP… */
    medio: text(),
    monto: numeric({ precision: 12, scale: 2 }).notNull(),
    estado: estadoCobro().notNull().default("iniciado"),
    /** Comprobante subido por el cliente cuando paga por transferencia. */
    comprobanteUrl: text(),
    /** Quién dio por buena la transferencia, y cuándo. */
    conciliadoPor: text(),
    conciliadoAt: timestamp({ withTimezone: true }),
    /** Movimiento de cuenta corriente generado, si el pago fue de deuda. */
    accountMovementId: uuid(),
    /** Respuesta cruda del proveedor, para poder explicar un rechazo. */
    detalle: jsonb(),
    motivoRechazo: text(),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    acreditadoAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("payments_proveedor_pago_idx").on(
      t.proveedor,
      t.proveedorPaymentId,
    ),
    index("payments_order_idx").on(t.orderId),
    index("payments_customer_idx").on(t.customerId),
    index("payments_estado_idx").on(t.estado),
    index("payments_created_idx").on(t.createdAt),
  ],
);

/**
 * Webhooks recibidos, crudos.
 *
 * Se guarda el cuerpo tal como llegó antes de tocar nada. Cuando un pago no
 * aparece acreditado, la primera pregunta es si el aviso llegó; sin esta tabla
 * la respuesta es "no sé" y hay que ir a buscarla al panel de Mercado Pago.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    proveedor: proveedorPago().notNull(),
    /** Id del aviso en el proveedor. Único: el mismo aviso no se procesa dos veces. */
    eventoId: text().notNull(),
    tipo: text(),
    cuerpo: jsonb(),
    firmaValida: text(),
    procesadoAt: timestamp({ withTimezone: true }),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_events_proveedor_evento_idx").on(
      t.proveedor,
      t.eventoId,
    ),
    index("payment_events_created_idx").on(t.createdAt),
  ],
);

/**
 * Datos bancarios para las transferencias.
 *
 * Una fila sola, editable desde el panel. Van en la base y no en variables de
 * entorno porque el alias de una cuenta lo cambia el contador, no el
 * programador, y no debería hacer falta un deploy para eso.
 */
export const datosBancarios = pgTable("datos_bancarios", {
  id: uuid().primaryKey().defaultRandom(),
  banco: text().notNull().default(""),
  titular: text().notNull().default(""),
  cuit: text().notNull().default(""),
  cbu: text().notNull().default(""),
  alias: text().notNull().default(""),
  instrucciones: text(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
  customer: one(customers, {
    fields: [payments.customerId],
    references: [customers.id],
  }),
}));

export type Payment = typeof payments.$inferSelect;
export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type DatosBancarios = typeof datosBancarios.$inferSelect;
