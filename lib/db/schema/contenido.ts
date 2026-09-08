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

import { customers } from "./customers";
import { products } from "./catalog";
import { orders } from "./sales";

/**
 * Contenido editable del sitio: reseñas, ajustes y avisos.
 *
 * **El blog y los testimonios salieron el 7/9/2026**, por pedido de la clienta.
 * Las seis notas las había escrito el prototipo y estaban publicadas con la
 * maderera como autora; los cuatro testimonios eran personas inventadas y ya
 * estaban ocultos. El contenido del blog quedó respaldado fuera del repo antes
 * de borrarlo.
 *
 * Lo que la gente opina sobre los productos ahora sale de las reseñas de
 * compra verificada: es el mismo dato sin el problema de tener que conseguir a
 * alguien que lo firme.
 */

/**
 * En qué estado está una reseña.
 *
 * Nace pendiente y alguien de la casa la publica o la rechaza. No se publica
 * sola: una reseña es un texto de un tercero que aparece firmado en el sitio,
 * y el día que entre un insulto o el teléfono de un competidor va a estar ahí
 * hasta que alguien lo vea.
 */
export const estadoResena = pgEnum("estado_resena", [
  "pendiente",
  "publicada",
  "rechazada",
]);

/**
 * Reseñas de producto, de compra verificada.
 *
 * La clienta pidió "agregar reseñas". Lo que existía eran testimonios cargados
 * a mano desde el panel, y los cuatro que traía el prototipo están ocultos
 * porque eran personas inventadas.
 *
 * **Solo puede reseñar quien compró.** Cada fila apunta al pedido entregado que
 * la habilita, y esa es toda la diferencia entre una reseña y un formulario de
 * comentarios: sin el pedido detrás, la primera reseña falsa la escribe
 * cualquiera con un navegador, y la segunda la escribe la competencia.
 *
 * El índice único sobre (pedido, producto) impide dos reseñas del mismo
 * producto en la misma compra. Se puede reseñar otra vez si se vuelve a
 * comprar, que es razonable: es otra experiencia.
 */
export const productReviews = pgTable(
  "product_reviews",
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Quién la escribió. Se conserva para poder contestarle. */
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** El pedido entregado que la habilita. Es lo que la hace verificada. */
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** De 1 a 5. Se valida antes de guardar. */
    estrellas: integer().notNull(),
    texto: text().notNull().default(""),
    /** Con qué nombre se publica. Se copia del cliente al crear la reseña. */
    nombre: text().notNull(),
    estado: estadoResena().notNull().default("pendiente"),
    /** Por qué se rechazó. Queda para poder explicarlo. */
    motivoRechazo: text(),
    resueltoPor: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("product_reviews_pedido_producto_idx").on(t.orderId, t.productId),
    index("product_reviews_producto_idx").on(t.productId, t.estado),
    index("product_reviews_estado_idx").on(t.estado, t.createdAt),
  ],
);

export type ProductReview = typeof productReviews.$inferSelect;

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
