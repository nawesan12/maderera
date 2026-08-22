import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { productVariants } from "./catalog";

/**
 * Carrito y presupuesto en curso.
 *
 * Se guarda en la base y no en memoria del navegador porque el prototipo perdía
 * todo al recargar: alguien armaba un pedido de treinta ítems con la
 * calculadora, tocaba F5 y empezaba de nuevo.
 *
 * `token` identifica el carrito de quien todavía no inició sesión, mediante una
 * cookie. Cuando esa persona se registra o entra, su carrito se le asigna con el
 * `userId` y el token deja de usarse.
 */
export const carts = pgTable(
  "carts",
  {
    id: uuid().primaryKey().defaultRandom(),
    token: text().notNull(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("carts_token_idx").on(t.token),
    index("carts_user_idx").on(t.userId),
  ],
);

/**
 * Línea del carrito.
 *
 * Guarda `descripcion` y `unidad` además del `variantId` porque la calculadora
 * de materiales produce ítems que todavía no están atados a un producto del
 * catálogo (por ejemplo "Clavos para machimbre, 3 kg"). Esos entran igual y se
 * resuelven cuando alguien del mostrador arma el presupuesto.
 */
export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid().references(() => productVariants.id, {
      onDelete: "cascade",
    }),
    descripcion: text().notNull(),
    unidad: text().notNull().default("unidad"),
    cantidad: numeric({ precision: 12, scale: 2 }).notNull().default("1"),
    /** Precio al momento de agregarlo, para avisar si cambió antes de comprar. */
    precioUnitario: numeric({ precision: 12, scale: 2 }),
    /** De dónde vino: el catálogo o alguna de las calculadoras. */
    origen: text().notNull().default("catalogo"),
    notas: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cart_items_cart_idx").on(t.cartId)],
);

/**
 * Zonas de envío con su costo.
 *
 * Se configuran desde el panel en vez de consultarle la tarifa a un
 * transportista: los envíos de la maderera son con flete propio o contratado por
 * zona, y el precio lo pone el negocio.
 */
export const shippingZones = pgTable(
  "shipping_zones",
  {
    id: uuid().primaryKey().defaultRandom(),
    nombre: text().notNull(),
    /** Códigos postales o localidades que cubre, separados por coma. */
    cobertura: text().notNull().default(""),
    costo: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    /** A partir de este monto el envío no se cobra. Cero desactiva la promoción. */
    envioGratisDesde: numeric({ precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    demoraEstimada: text(),
    activa: boolean().notNull().default(true),
    orden: numeric({ precision: 4, scale: 0 }).notNull().default("0"),
  },
  (t) => [index("shipping_zones_activa_idx").on(t.activa)],
);

export const cartsRelations = relations(carts, ({ one, many }) => ({
  user: one(user, { fields: [carts.userId], references: [user.id] }),
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, {
    fields: [cartItems.variantId],
    references: [productVariants.id],
  }),
}));

export type Cart = typeof carts.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type ShippingZone = typeof shippingZones.$inferSelect;
