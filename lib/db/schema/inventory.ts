import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { productVariants } from "./catalog";

export const branches = pgTable(
  "branches",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    name: text().notNull(),
    address: text().notNull().default(""),
    phone: text(),
    whatsapp: text(),
    email: text(),
    hours: text(),
    mapUrl: text(),
    sortOrder: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("branches_slug_idx").on(t.slug)],
);

/**
 * Stock real por variante y sucursal, en cantidades.
 *
 * El nivel categórico que ve el público (alto / medio / bajo / sin stock) no se
 * guarda: se deriva de `qty` y `minQty` en `lib/stock-level.ts`. Guardar las dos
 * cosas fue lo que dejó el prototipo con dos modelos de stock contradictorios.
 */
export const inventory = pgTable(
  "inventory",
  {
    id: uuid().primaryKey().defaultRandom(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    qty: integer().notNull().default(0),
    /** Umbral de reposición. Por debajo, el producto entra en las alertas del panel. */
    minQty: integer().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_variant_branch_idx").on(t.variantId, t.branchId),
    index("inventory_branch_idx").on(t.branchId),
  ],
);

export const movementType = pgEnum("movement_type", [
  "ingreso",
  "egreso",
  "ajuste",
  "transferencia_salida",
  "transferencia_entrada",
  "venta",
  "devolucion",
]);

/**
 * Libro de movimientos: toda variación de `inventory.qty` deja un registro acá.
 * Sin esto no hay forma de explicar por qué el stock del sistema no coincide con
 * el del depósito, que es la primera pregunta que aparece cuando algo no cierra.
 */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid().primaryKey().defaultRandom(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    type: movementType().notNull(),
    /** Positivo suma, negativo resta. */
    qty: integer().notNull(),
    note: text(),
    /** Agrupa las dos patas de una transferencia entre sucursales. */
    transferGroup: uuid(),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_movements_variant_idx").on(t.variantId),
    index("inventory_movements_branch_idx").on(t.branchId),
    index("inventory_movements_created_idx").on(t.createdAt),
  ],
);

export const branchesRelations = relations(branches, ({ many }) => ({
  inventory: many(inventory),
}));

export const inventoryRelations = relations(inventory, ({ one }) => ({
  variant: one(productVariants, {
    fields: [inventory.variantId],
    references: [productVariants.id],
  }),
  branch: one(branches, {
    fields: [inventory.branchId],
    references: [branches.id],
  }),
}));

export const inventoryMovementsRelations = relations(
  inventoryMovements,
  ({ one }) => ({
    variant: one(productVariants, {
      fields: [inventoryMovements.variantId],
      references: [productVariants.id],
    }),
    branch: one(branches, {
      fields: [inventoryMovements.branchId],
      references: [branches.id],
    }),
  }),
);

export type Branch = typeof branches.$inferSelect;
export type Inventory = typeof inventory.$inferSelect;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
