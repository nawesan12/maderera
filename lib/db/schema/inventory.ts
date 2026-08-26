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
    /**
     * Cantidad comprometida en pedidos confirmados que todavía no salieron del
     * depósito.
     *
     * Existe porque en una maderera la mercadería se paga hoy y se retira en
     * tres semanas. Sin esta columna, esas placas siguen figurando disponibles
     * y el sitio las vende de nuevo: el físico está, pero ya tiene dueño.
     *
     * **Disponible = `qty − reservado`.** El físico solo cambia cuando algo
     * entra o sale de verdad por la puerta.
     */
    reservado: integer().notNull().default(0),
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

/**
 * Reservas de stock: mercadería vendida que todavía no salió del depósito.
 *
 * En una maderera se paga hoy y se retira en tres semanas. Sin registrar la
 * reserva, esas placas siguen figurando disponibles y la tienda las vuelve a
 * vender: el físico está, pero ya tiene dueño.
 *
 * **Esta tabla es la fuente de verdad**; `inventory.reservado` es la suma de
 * las filas activas, mantenida en la misma transacción. Es la única cifra
 * derivada que el proyecto guarda, y se guarda por una razón concreta: cada
 * listado del catálogo público necesita el disponible de cada variante, y
 * agregarlo en cada consulta convierte una lectura barata en una costosa.
 * `recalcularReservado()` reconstruye la columna desde acá cuando haga falta
 * comprobarlo.
 *
 * Se cuelga del renglón del pedido y no solo de la variante para poder
 * consumirla de a partes: un acopio se retira en varias veces.
 */
export const estadoReserva = pgEnum("estado_reserva", [
  "activa",
  "consumida",
  "liberada",
]);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid().notNull(),
    orderItemId: uuid().notNull(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    /**
     * Unidades reservadas, redondeadas hacia arriba.
     *
     * El inventario se lleva en enteros y una venta puede ser de 2,5 metros
     * lineales. Reservar 3 es lo conservador: sobra medio metro en el papel,
     * pero nunca se promete algo que no está.
     */
    cantidad: integer().notNull(),
    estado: estadoReserva().notNull().default("activa"),
    resueltoAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_reservations_order_idx").on(t.orderId),
    index("stock_reservations_item_idx").on(t.orderItemId),
    index("stock_reservations_activa_idx").on(t.variantId, t.branchId, t.estado),
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
export type StockReservation = typeof stockReservations.$inferSelect;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
