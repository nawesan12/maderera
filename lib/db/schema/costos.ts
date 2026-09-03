import { relations } from "drizzle-orm";
import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { productVariants } from "./catalog";

/**
 * A cuánto costó lo que hay en el depósito.
 *
 * Archivo propio, separado de `compras.ts`, porque **ventas y reportes lo leen
 * sin saber nada de compras**: el margen de un pedido necesita el costo y no
 * necesita saber de qué remito vino.
 *
 * Dos decisiones que cuesta cambiar después:
 *
 * 1. **El costo es global por variante, no por sucursal.** Las dos sucursales
 *    se abastecen del mismo proveedor; abrirlo por sucursal obligaría a mover
 *    costo en cada transferencia y a que el join del margen pase por dos tablas
 *    más, a cambio de una precisión que nadie va a mirar.
 *
 * 2. **`cantidadBase` es propia y no es `inventory.qty`.** Aquella está por
 *    sucursal, la mueven ajustes que no tienen costo y puede quedar negativa
 *    por regla de negocio. Esta solo la mueven las recepciones, que son las
 *    únicas que traen un costo con qué promediar.
 */
export const variantCosts = pgTable(
  "variant_costs",
  {
    id: uuid().primaryKey().defaultRandom(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),

    /** Unidades valorizadas. Ver arriba: no es el stock. */
    cantidadBase: numeric({ precision: 14, scale: 4 }).notNull().default("0"),

    /**
     * Neto, sin IVA, con **cuatro decimales**.
     *
     * Cuatro y no dos: un promedio de $10,005 redondeado en cada una de
     * doscientas recepciones deriva varios pesos por unidad, siempre para el
     * mismo lado.
     */
    costoPromedio: numeric({ precision: 14, scale: 4 }).notNull().default("0"),

    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("variant_costs_variant_idx").on(t.variantId)],
);

/**
 * Cada vez que el costo de una variante cambió, y por qué.
 *
 * Mismo criterio que `priceHistory`: guardar el valor anterior es lo que
 * permite auditar una recepción de hace ocho meses sin rehacer toda la
 * historia. Sin esto, "¿por qué este perfil pasó a costar el doble?" no tiene
 * respuesta posible.
 */
export const costHistory = pgTable(
  "cost_history",
  {
    id: uuid().primaryKey().defaultRandom(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),

    costoAnterior: numeric({ precision: 14, scale: 4 }).notNull(),
    costoNuevo: numeric({ precision: 14, scale: 4 }).notNull(),
    cantidadAnterior: numeric({ precision: 14, scale: 4 }).notNull(),
    cantidadNueva: numeric({ precision: 14, scale: 4 }).notNull(),

    /** Qué lo movió: normalmente una recepción, a veces una corrección. */
    documentoTipo: text(),
    documentoId: uuid(),
    motivo: text(),

    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cost_history_variant_idx").on(t.variantId),
    index("cost_history_created_idx").on(t.createdAt),
  ],
);

export const variantCostsRelations = relations(variantCosts, ({ one }) => ({
  variante: one(productVariants, {
    fields: [variantCosts.variantId],
    references: [productVariants.id],
  }),
}));

export type VariantCost = typeof variantCosts.$inferSelect;
