import { relations } from "drizzle-orm";
import {
  boolean,
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

/**
 * Cómo se vende cada producto. Determina qué unidad muestra el catálogo, con qué
 * unidad opera la calculadora y qué se imprime en la factura, así que las tres
 * partes tienen que hablar el mismo idioma.
 */
export const unitOfSale = pgEnum("unit_of_sale", [
  "unidad",
  "metro_lineal",
  "metro_cuadrado",
  /**
   * La tabla de deck.
   *
   * El deck se vendía por metro cuadrado y la clienta lo cambió: cada tabla con
   * su medida y su precio. Cobrar por m² obligaba a alguien a convertir a
   * tablas enteras en el mostrador, y esa cuenta salía distinta cada vez.
   */
  "tabla",
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

/**
 * Los rubros de adentro de una categoría.
 *
 * Existían como `products.subcategory`, texto libre escrito a mano en cada
 * producto. Con eso no se puede navegar: dos productos del mismo rubro escritos
 * distinto —"Colas vinílicas" y "colas vinilicas"— son dos rubros para el
 * sistema y ninguno para quien busca.
 *
 * La clienta trajo los 43 rubros con los que la ferretería ya trabajaba en el
 * sitio anterior. Ferretería sola son ~1000 SKUs según el brief: sin un nivel
 * más de navegación, esa categoría es una grilla de mil productos donde nadie
 * encuentra un tarugo.
 */
export const subcategories = pgTable(
  "subcategories",
  {
    id: uuid().primaryKey().defaultRandom(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    name: text().notNull(),
    sortOrder: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // El slug es único dentro de la categoría y no en toda la tabla: "membranas"
    // puede existir en Ferretería y en Techos, y son rubros distintos.
    uniqueIndex("subcategories_categoria_slug_idx").on(t.categoryId, t.slug),
    index("subcategories_categoria_idx").on(t.categoryId),
  ],
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
    /**
     * El rubro, como texto.
     *
     * Se conserva junto a `subcategoryId` porque es de donde salieron los
     * rubros al migrarlos, y porque un producto puede estar cargado con un
     * rubro que todavía no existe como fila. La navegación usa la relación; el
     * texto queda como respaldo de lo que alguien escribió.
     */
    subcategory: text(),
    subcategoryId: uuid().references(() => subcategories.id, {
      onDelete: "set null",
    }),
    description: text().notNull().default(""),
    /** Marca propia del cliente (Moldava) o de terceros. */
    brand: text(),
    unit: unitOfSale().notNull().default("unidad"),
    /**
     * Alicuota de IVA con la que se factura este producto.
     *
     * Vive en el producto y no en la linea de factura porque es una propiedad
     * de la mercaderia, no de la venta: la madera va al 21 %, pero hay
     * excepciones estables que no se pueden estar recordando en cada
     * comprobante.
     */
    alicuotaIva: numeric({ precision: 4, scale: 2 }).notNull().default("21"),
    featured: boolean().notNull().default(false),
    /**
     * Se fabrica a pedido: no tiene stock y no debería mostrarse como agotado.
     *
     * Son los maquinados especiales del brief —escaleras a medida, tirantes en
     * medidas que no vienen de origen y se elaboran en planta—. Sin esta marca
     * la ficha solo puede decir "sin stock", que para este producto es falso:
     * no falta, se hace.
     */
    aPedido: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_slug_idx").on(t.slug),
    index("products_category_idx").on(t.categoryId),
    index("products_subcategory_idx").on(t.subcategoryId),
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
    /**
     * Terminación de la pieza: laqueada, cruda, cepillada, melamínica.
     *
     * Del brief, a "qué variantes cambian el precio de un mismo producto":
     * espesor, medida, color, tipo o calidad, marca, largo y **terminación**.
     * Las primeras cinco ya estaban; estas dos faltaban y terminaban metidas
     * dentro del `label`, donde no se pueden filtrar ni comparar.
     */
    terminacion: text(),
    /** Tipo o calidad: primera, segunda, estándar, premium. */
    calidad: text(),
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

/**
 * Productos sugeridos (cláusula 1.3).
 *
 * Dos relaciones distintas y por eso el tipo: **complementario** es lo que hace
 * falta para usar el producto —los clavos del machimbre, el sellador del deck— y
 * es lo que sube el ticket; **similar** es la alternativa cuando lo que se está
 * mirando no convence o no hay stock.
 *
 * Se cargan a mano porque el criterio lo tiene el vendedor: ninguna heurística
 * sabe que a un deck de grandis le corresponde ese fijador y no otro. Cuando no
 * hay ninguna cargada, la ficha cae a otros productos de la misma categoría,
 * que es mejor que no mostrar nada.
 */
export const tipoRelacion = pgEnum("tipo_relacion_producto", [
  "complementario",
  "similar",
]);

export const relatedProducts = pgTable(
  "related_products",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    relatedProductId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    tipo: tipoRelacion().notNull().default("complementario"),
    orden: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex("related_products_par_idx").on(
      t.productId,
      t.relatedProductId,
      t.tipo,
    ),
    index("related_products_producto_idx").on(t.productId, t.tipo),
  ],
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
export type Subcategory = typeof subcategories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type RelatedProduct = typeof relatedProducts.$inferSelect;
