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

/**
 * Cómo se vende cada producto. Determina qué unidad muestra el catálogo, con qué
 * unidad opera la calculadora y qué se imprime en la factura, así que las tres
 * partes tienen que hablar el mismo idioma.
 */
export const unitOfSale = pgEnum("unit_of_sale", [
  "unidad",
  "metro_lineal",
  "metro_cuadrado",
  "placa",
  "rollo",
  "par",
  "juego",
  "kg",
  "litro",
]);

export const categories = pgTable(
  "categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    /** Nombre del ícono de lucide-react, ej. "Home", "Layers". */
    icon: text(),
    image: text(),
    sortOrder: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("categories_slug_idx").on(t.slug)],
);

export const products = pgTable(
  "products",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    name: text().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    subcategory: text(),
    description: text().notNull().default(""),
    /** Marca propia del cliente (Moldava) o de terceros. */
    brand: text(),
    unit: unitOfSale().notNull().default("unidad"),
    featured: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_slug_idx").on(t.slug),
    index("products_category_idx").on(t.categoryId),
  ],
);

/**
 * Una variante es lo que realmente se vende, se stockea y se factura: una placa de
 * 18 mm y una de 5,5 mm no comparten ni precio ni stock.
 *
 * `label` es el texto que ve la gente ('2" x 4" x 3.60m'), mientras que
 * largoMm/anchoMm/espesorMm son los mismos datos en números para que la calculadora
 * de materiales pueda operar con ellos. Quedan nullable porque hay productos sin
 * dimensiones (una bisagra, un litro de laca).
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text().notNull(),
    label: text().notNull(),
    largoMm: integer(),
    anchoMm: integer(),
    espesorMm: integer(),
    material: text(),
    color: text(),
    sortOrder: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("product_variants_sku_idx").on(t.sku),
    index("product_variants_product_idx").on(t.productId),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text().notNull(),
    alt: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  variants: many(productVariants),
  images: many(productImages),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, {
    fields: [productVariants.productId],
    references: [products.id],
  }),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
