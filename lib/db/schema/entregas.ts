import { relations } from "drizzle-orm";
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
import { branches } from "./inventory";
import { orderItems, orders } from "./sales";

/**
 * Remitos: cada vez que sale mercadería por la puerta.
 *
 * En una maderera un pedido rara vez se lleva de una sola vez. El cliente
 * compra la obra entera, deja el material en acopio y va retirando a medida que
 * avanza. Por eso la entrega es una entidad aparte y no un estado del pedido:
 * un pedido tiene N entregas parciales, y lo que queda en acopio se calcula
 * restando.
 *
 * El mismo objeto cubre el envío: la diferencia entre "lo retiró" y "se lo
 * llevamos" es el tipo y los datos de seguimiento, no la estructura.
 */

export const estadoEntrega = pgEnum("estado_entrega", [
  "preparada",
  "entregada",
  "anulada",
]);

export const tipoEntregaRemito = pgEnum("tipo_entrega_remito", [
  "retiro",
  "envio",
]);

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Correlativo visible, `REM-0001`. No es un documento fiscal, pero se cita igual. */
    numero: text().notNull(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),
    tipo: tipoEntregaRemito().notNull().default("retiro"),
    estado: estadoEntrega().notNull().default("preparada"),
    /** Quién se la llevó. Puede no ser el titular del pedido: manda el flete, o un oficial. */
    receptorNombre: text(),
    receptorDocumento: text(),
    /**
     * Firma manuscrita en PNG, en almacenamiento privado.
     *
     * Reemplaza al remito en papel (cláusula 1.6), así que lo que la hace valer
     * es el contexto guardado alrededor: cuándo se firmó y desde qué IP. Sin
     * eso es un dibujo.
     */
    firmaUrl: text(),
    firmadoAt: timestamp({ withTimezone: true }),
    firmadoIp: text(),
    /**
     * Token del link de firma. Aleatorio y de un solo uso: lo que lo invalida
     * no es borrarlo sino el cambio de estado del remito, porque después de
     * firmar el mismo link tiene que seguir mostrando la constancia.
     */
    firmaToken: text(),
    notas: text(),
    entregadoAt: timestamp({ withTimezone: true }),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("deliveries_numero_idx").on(t.numero),
    uniqueIndex("deliveries_firma_token_idx").on(t.firmaToken),
    index("deliveries_order_idx").on(t.orderId),
    index("deliveries_estado_idx").on(t.estado),
    index("deliveries_created_idx").on(t.createdAt),
  ],
);

export const deliveryItems = pgTable(
  "delivery_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    deliveryId: uuid()
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    /**
     * Apunta al renglón del pedido, no a la variante: es lo que permite saber
     * cuánto queda pendiente de *ese* renglón cuando el mismo producto aparece
     * dos veces en el pedido con precios distintos.
     */
    orderItemId: uuid()
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    cantidad: numeric({ precision: 12, scale: 2 }).notNull(),
    orden: integer().notNull().default(0),
  },
  (t) => [
    index("delivery_items_delivery_idx").on(t.deliveryId),
    index("delivery_items_order_item_idx").on(t.orderItemId),
  ],
);

export const estadoEnvio = pgEnum("estado_envio", [
  "preparando",
  "despachado",
  "en_transito",
  "entregado",
  "devuelto",
]);

/**
 * Seguimiento del envío (cláusula 1.3).
 *
 * El transportista y el número de seguimiento se cargan a mano desde el panel.
 * Andreani tiene API con cuenta corporativa y CDI probablemente no, así que la
 * carga manual es el piso que funciona con cualquiera de los dos; una
 * integración después llena estos mismos campos sin cambiar las pantallas.
 */
export const shipments = pgTable(
  "shipments",
  {
    id: uuid().primaryKey().defaultRandom(),
    deliveryId: uuid()
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    transportista: text(),
    numeroSeguimiento: text(),
    urlSeguimiento: text(),
    estado: estadoEnvio().notNull().default("preparando"),
    despachadoAt: timestamp({ withTimezone: true }),
    entregadoAt: timestamp({ withTimezone: true }),
    observaciones: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shipments_delivery_idx").on(t.deliveryId)],
);

export const deliveriesRelations = relations(deliveries, ({ one, many }) => ({
  order: one(orders, { fields: [deliveries.orderId], references: [orders.id] }),
  branch: one(branches, {
    fields: [deliveries.branchId],
    references: [branches.id],
  }),
  items: many(deliveryItems),
  shipment: one(shipments),
}));

export const deliveryItemsRelations = relations(deliveryItems, ({ one }) => ({
  delivery: one(deliveries, {
    fields: [deliveryItems.deliveryId],
    references: [deliveries.id],
  }),
  orderItem: one(orderItems, {
    fields: [deliveryItems.orderItemId],
    references: [orderItems.id],
  }),
}));

export const shipmentsRelations = relations(shipments, ({ one }) => ({
  delivery: one(deliveries, {
    fields: [shipments.deliveryId],
    references: [deliveries.id],
  }),
}));

export type Delivery = typeof deliveries.$inferSelect;
export type DeliveryItem = typeof deliveryItems.$inferSelect;
export type Shipment = typeof shipments.$inferSelect;
