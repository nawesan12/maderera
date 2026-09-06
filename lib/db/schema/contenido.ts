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


/* -------------------------------------------------------------------------- */
/* Banners                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Dónde puede aparecer un banner.
 *
 * Son lugares concretos y contados, no un sistema de "zonas" configurable: un
 * espacio publicitario que se puede poner en cualquier parte termina con seis
 * banners peleándose la portada. Cada ubicación tiene un tamaño y un rol.
 */
export const ubicacionBanner = pgEnum("ubicacion_banner", [
  /** La franja de texto de arriba de todo. Sin imagen: es un aviso corto. */
  "franja",
  /** Debajo del hero de la portada, ancho completo. El lugar de la promoción. */
  "portada",
  /** Arriba del listado del catálogo. */
  "catalogo",
]);

/**
 * Los banners de promoción.
 *
 * **Por qué hacía falta.** La maderera cambia precios todas las semanas, tiene
 * promociones con MODO y con tarjetas bancarizadas y no bancarizadas, y hace
 * descuentos por pagar de contado. Nada de eso se podía anunciar: el sitio no
 * tenía un solo lugar donde poner un aviso, así que una promoción vigente por
 * quince días exigía un despliegue —o directamente no se anunciaba—.
 *
 * **La vigencia es lo que hace que sirva.** Un banner con fecha de fin se
 * apaga solo. Sin eso, el "30 % los martes con MODO" se queda tres meses
 * después de que terminó la promoción, y eso es peor que no haberlo puesto:
 * alguien llega al mostrador a reclamar un descuento que no existe.
 */
export const banners = pgTable(
  "banners",
  {
    id: uuid().primaryKey().defaultRandom(),
    ubicacion: ubicacionBanner().notNull(),
    /**
     * El chip de arriba del título: "Promoción", "Nuevo", "-15%".
     *
     * Es lo que hace que un banner se lea como una promoción y no como un
     * cartel institucional. Corto —dos o tres palabras—: más largo deja de ser
     * una etiqueta y compite con el título.
     */
    etiqueta: text().notNull().default(""),
    titulo: text().notNull(),
    bajada: text().notNull().default(""),
    /** A dónde lleva. Vacío lo deja sin enlace. */
    enlace: text(),
    textoEnlace: text().notNull().default(""),
    /**
     * La imagen de fondo. Opcional: un banner de texto sobre el color de marca
     * se ve mejor que una foto mal recortada, y es lo que el equipo va a poder
     * armar solo desde el celular.
     */
    imagenUrl: text(),
    /** Desde cuándo se muestra. Vacío es "ya". */
    desde: timestamp({ withTimezone: true }),
    /** Hasta cuándo. Vacío es "hasta que lo apaguen". */
    hasta: timestamp({ withTimezone: true }),
    orden: integer().notNull().default(0),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("banners_ubicacion_idx").on(t.ubicacion, t.activo, t.orden)],
);
