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
import { productVariants } from "./catalog";

/**
 * Listas de precios: "general" para el público y "profesional" para arquitectos,
 * constructoras y carpinteros.
 *
 * Se modela como tabla y no como un porcentaje de descuento sobre el precio general
 * porque el precio profesional no es uniforme: hay productos con margen distinto y
 * el cliente va a querer excepciones puntuales.
 */
export const priceChangeSource = pgEnum("price_change_source", [
  "manual",
  "ajuste_masivo",
  "importacion",
]);

export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    name: text().notNull(),
    isDefault: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("price_lists_slug_idx").on(t.slug)],
);

export const priceListItems = pgTable(
  "price_list_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    priceListId: uuid()
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    /**
     * numeric, nunca float: los precios se suman, se multiplican por cantidad y
     * terminan en una factura fiscal. Drizzle lo entrega como string.
     */
    price: numeric({ precision: 12, scale: 2 }).notNull(),
    /**
     * Precio de lista antes de la oferta.
     *
     * Cuando está cargado y es mayor al precio vigente, la tienda muestra el
     * tachado y calcula el descuento. Se guarda acá y no como un porcentaje
     * para que el número tachado sea el que realmente estuvo vigente: inventar
     * un precio anterior para simular un descuento es publicidad engañosa.
     */
    precioAnterior: numeric({ precision: 12, scale: 2 }),
    /** Hasta cuándo vale la oferta. Vencida, se muestra el precio normal. */
    ofertaHasta: timestamp({ withTimezone: true }),
    currency: text().notNull().default("ARS"),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("price_list_items_list_variant_idx").on(
      t.priceListId,
      t.variantId,
    ),
    index("price_list_items_variant_idx").on(t.variantId),
  ],
);

export const priceListsRelations = relations(priceLists, ({ many }) => ({
  items: many(priceListItems),
}));

export const priceListItemsRelations = relations(priceListItems, ({ one }) => ({
  priceList: one(priceLists, {
    fields: [priceListItems.priceListId],
    references: [priceLists.id],
  }),
  variant: one(productVariants, {
    fields: [priceListItems.variantId],
    references: [productVariants.id],
  }),
}));

export type PriceList = typeof priceLists.$inferSelect;
export type PriceListItem = typeof priceListItems.$inferSelect;

/**
 * Historial de precios.
 *
 * Cada cambio queda registrado con lo que había antes, lo que quedó y por qué.
 * En un país donde los precios se actualizan seguido, la pregunta "¿desde cuándo
 * vale esto?" aparece todo el tiempo: al facturar una entrega pactada semanas
 * atrás, al revisar un presupuesto vencido o cuando un cliente reclama.
 *
 * El precio anterior se guarda en la fila y no se deduce del registro previo:
 * así una consulta sola alcanza para explicar un cambio.
 */
export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid().primaryKey().defaultRandom(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    priceListId: uuid()
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    precioAnterior: numeric({ precision: 12, scale: 2 }),
    precioNuevo: numeric({ precision: 12, scale: 2 }).notNull(),
    /** De dónde vino el cambio: edición suelta, ajuste masivo o importación. */
    origen: priceChangeSource().notNull(),
    motivo: text(),
    /** Agrupa todas las filas de un mismo ajuste masivo o de una importación. */
    loteId: uuid(),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("price_history_variant_idx").on(t.variantId),
    index("price_history_lote_idx").on(t.loteId),
    index("price_history_created_idx").on(t.createdAt),
  ],
);

export type PriceHistory = typeof priceHistory.$inferSelect;
