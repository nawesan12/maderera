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
 * Contenido editable del sitio: blog, testimonios y ajustes generales.
 *
 * El blog es una obligación del contrato (cláusula 1.2) y, sobre todo, la
 * herramienta de posicionamiento del sitio: "cómo elegir machimbre para techo"
 * es lo que alguien busca antes de saber que necesita una maderera.
 *
 * Estaba escrito a mano en `lib/products.ts` —seis artículos como constantes de
 * TypeScript—, lo que significaba un deploy por cada nota publicada. Nadie
 * escribe un blog así.
 */

export const estadoPublicacion = pgEnum("estado_publicacion", [
  "borrador",
  "publicado",
  "archivado",
]);

export const blogCategories = pgTable(
  "blog_categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    nombre: text().notNull(),
    descripcion: text(),
    orden: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("blog_categories_slug_idx").on(t.slug)],
);

export const blogPosts = pgTable(
  "blog_posts",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    titulo: text().notNull(),
    /** Resumen para la tarjeta del listado y la descripción de la página. */
    resumen: text().notNull().default(""),
    /** Cuerpo en Markdown acotado: encabezados, listas, negritas y enlaces. */
    contenido: text().notNull().default(""),
    imagenUrl: text(),
    categoryId: uuid().references(() => blogCategories.id, {
      onDelete: "set null",
    }),
    autor: text(),
    estado: estadoPublicacion().notNull().default("borrador"),
    /**
     * Cuándo se publicó.
     *
     * Va aparte de `createdAt` porque una nota se escribe hoy y se publica el
     * martes, y la fecha que se muestra —y la que ordena el listado— es la de
     * publicación.
     */
    publicadoAt: timestamp({ withTimezone: true }),
    /**
     * Minutos de lectura, calculados al guardar.
     *
     * Se guarda en vez de derivarse en cada render: es un número que no cambia
     * salvo que se edite la nota, y contar palabras en cada visita al listado
     * es trabajo repetido para nada.
     */
    minutosLectura: integer().notNull().default(1),
    /** Metadatos de posicionamiento, cuando conviene que difieran del título. */
    metaTitulo: text(),
    metaDescripcion: text(),
    destacado: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("blog_posts_slug_idx").on(t.slug),
    index("blog_posts_estado_idx").on(t.estado, t.publicadoAt),
    index("blog_posts_categoria_idx").on(t.categoryId),
  ],
);

/**
 * Testimonios de clientes.
 *
 * En la base y no como constante porque son personas reales: si alguien pide
 * que saquen el suyo, tiene que poder salir sin un deploy.
 */
export const testimonials = pgTable(
  "testimonials",
  {
    id: uuid().primaryKey().defaultRandom(),
    nombre: text().notNull(),
    rol: text(),
    texto: text().notNull(),
    /** Iniciales para el avatar, cuando no hay foto. */
    iniciales: text(),
    orden: integer().notNull().default(0),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("testimonials_activo_idx").on(t.activo, t.orden)],
);

/**
 * Ajustes del sitio, como pares clave-valor.
 *
 * Textos y números que el negocio quiere poder cambiar sin pedir un deploy: el
 * teléfono de WhatsApp, la leyenda del envío gratis, el aviso de la barra
 * superior. Como tabla de claves y no como columnas porque cada ajuste nuevo no
 * puede costar una migración.
 */
export const siteSettings = pgTable("site_settings", {
  clave: text().primaryKey(),
  valor: text().notNull().default(""),
  descripcion: text(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const blogPostsRelations = relations(blogPosts, ({ one }) => ({
  categoria: one(blogCategories, {
    fields: [blogPosts.categoryId],
    references: [blogCategories.id],
  }),
}));

export const blogCategoriesRelations = relations(blogCategories, ({ many }) => ({
  posts: many(blogPosts),
}));

export type BlogPost = typeof blogPosts.$inferSelect;
export type BlogCategory = typeof blogCategories.$inferSelect;
export type Testimonial = typeof testimonials.$inferSelect;
export type SiteSetting = typeof siteSettings.$inferSelect;
