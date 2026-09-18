import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
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
 * Un corte a medida que alguien armó en el sitio.
 *
 * **Por qué no es una línea más del carrito.** Un corte no es un producto con
 * cantidad: es una placa, un despiece de medidas en milímetros y un acomodo del
 * que salen tres cobros distintos —el material, las pasadas de sierra y los
 * metros de tapacanto—. Meterlo como texto en `cart_items` perdería el despiece,
 * que es justamente lo que después tiene que bajar al taller.
 *
 * Al confirmar la compra cada fila se convierte en una orden de corte en la cola
 * del taller, dentro de la misma transacción del pedido —igual que hace el
 * mostrador— y en las líneas que se cobran.
 *
 * **El precio se vuelve a calcular en el servidor al comprar.** El que se guarda
 * acá es el que se le mostró a la persona, para poder avisarle si cambió; nunca
 * es el que se cobra.
 */
export const cartCortes = pgTable(
  "cart_cortes",
  {
    id: uuid().primaryKey().defaultRandom(),
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    /** La placa del catálogo. Sin ella no hay precio de material ni stock. */
    variantId: uuid().references(() => productVariants.id, {
      onDelete: "cascade",
    }),
    materialDescripcion: text().notNull(),
    /** La medida sobre la que se acomodó, ya resuelta. */
    placaLargoMm: integer().notNull(),
    placaAnchoMm: integer().notNull(),
    /** De qué sale: placa entera (null) o media, y en qué sentido partida. */
    mitad: text(),
    cantoDescripcion: text(),
    /**
     * El despiece, como JSON: `[{ largoMm, anchoMm, cantidad, respetaVeta,
     * cantoLargo, cantoAncho, etiqueta }]`.
     *
     * Va como texto y no como tabla hija porque solo se lee entero y solo vive
     * hasta que la compra se confirma, igual que `cuttingOrders.acomodoManual`.
     */
    piezas: text().notNull(),
    /** Lo que dio el plano cuando se armó, para mostrarlo sin recalcular. */
    placas: integer().notNull().default(1),
    pasadas: integer().notNull().default(0),
    /** El precio que se le mostró. Se recalcula al comprar. */
    total: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cart_cortes_cart_idx").on(t.cartId)],
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
    /**
     * La zona no tiene tarifa fija: el flete se cotiza caso por caso.
     *
     * Existe porque el cliente contestó "depende" al costo y al plazo de las
     * tres zonas —según el volumen sale en camión propio o por comisionista—.
     * Sin esto la única forma de expresarlo era dejar `costo` en cero, que la
     * pantalla muestra como "Sin cargo": exactamente lo contrario de lo que
     * pasa, y la clase de error que se descubre cuando alguien reclama que le
     * cobraron un envío que decía gratis.
     */
    aCotizar: boolean().notNull().default(false),
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
  cortes: many(cartCortes),
}));

export const cartCortesRelations = relations(cartCortes, ({ one }) => ({
  cart: one(carts, { fields: [cartCortes.cartId], references: [carts.id] }),
  variant: one(productVariants, {
    fields: [cartCortes.variantId],
    references: [productVariants.id],
  }),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, {
    fields: [cartItems.variantId],
    references: [productVariants.id],
  }),
}));

export type Cart = typeof carts.$inferSelect;
export type CartCorte = typeof cartCortes.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type ShippingZone = typeof shippingZones.$inferSelect;
