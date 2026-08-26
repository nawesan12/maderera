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
import { user } from "./auth";
import { customers } from "./customers";
import { priceLists } from "./pricing";
import { branches } from "./inventory";

/**
 * Portal de profesionales (cláusula 1.7).
 *
 * Arquitectos, constructoras y carpinteros son el segmento de mayor ticket y de
 * mayor recurrencia, y compran distinto que el público: precios diferenciados,
 * descuentos por volumen, cuenta corriente y respuestas rápidas.
 *
 * La solicitud es una entidad aparte de `customers` a propósito: alguien puede
 * pedir el acceso y no obtenerlo, y esa negativa también hay que poder
 * explicarla tres meses después. Aprobar la solicitud es lo que crea o
 * actualiza la ficha de cliente.
 */

export const rubroProfesional = pgEnum("rubro_profesional", [
  "arquitecto",
  "constructora",
  "carpintero",
  "disenador",
  "instalador",
  "otro",
]);

export const estadoSolicitud = pgEnum("estado_solicitud", [
  "pendiente",
  "aprobada",
  "rechazada",
]);

export const professionalApplications = pgTable(
  "professional_applications",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Cuenta web de quien pidió, si estaba con sesión iniciada. */
    userId: text().references(() => user.id, { onDelete: "set null" }),
    /** Ficha creada o vinculada al aprobar. */
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    nombre: text().notNull(),
    razonSocial: text(),
    /**
     * CUIT, solo dígitos.
     *
     * Se valida el dígito verificador antes de guardar (`lib/cuit.ts`). No dice
     * si existe —eso solo lo sabe ARCA— pero atrapa los errores de tipeo, que
     * son la enorme mayoría y terminan en una factura rechazada.
     */
    cuit: text().notNull(),
    email: text().notNull(),
    telefono: text().notNull(),
    rubro: rubroProfesional().notNull().default("otro"),
    /** Matrícula profesional, cuando el rubro la tiene. */
    matricula: text(),
    /** Qué compra y cuánto: es lo que el vendedor mira para decidir. */
    volumenEstimado: text(),
    localidad: text(),
    mensaje: text(),
    estado: estadoSolicitud().notNull().default("pendiente"),
    /** Por qué se rechazó. Se le manda al solicitante. */
    motivoRechazo: text(),
    resueltoPor: text(),
    resueltoAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("professional_applications_estado_idx").on(t.estado),
    index("professional_applications_cuit_idx").on(t.cuit),
    index("professional_applications_created_idx").on(t.createdAt),
  ],
);

/**
 * Escalas de descuento por volumen.
 *
 * Van sobre la lista de precios y no sobre el producto porque el descuento por
 * cantidad es una política comercial de la lista: el público no lo tiene, el
 * profesional sí. Se pueden colgar de una variante concreta o de una categoría
 * entera; cuando hay dos que aplican, gana la más específica.
 */
export const volumeDiscounts = pgTable(
  "volume_discounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    priceListId: uuid()
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    /** Null en las dos = la escala aplica a todo el catálogo. */
    variantId: uuid(),
    categoryId: uuid(),
    /** A partir de cuántas unidades aplica. */
    desdeCantidad: numeric({ precision: 12, scale: 2 }).notNull(),
    /** Porcentaje de descuento sobre el precio de la lista. */
    porcentaje: numeric({ precision: 5, scale: 2 }).notNull(),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("volume_discounts_lista_idx").on(t.priceListId, t.activo),
    index("volume_discounts_variant_idx").on(t.variantId),
    index("volume_discounts_category_idx").on(t.categoryId),
  ],
);

/**
 * Documentación técnica descargable.
 *
 * Fichas de producto, tablas de carga, instructivos de colocación. Es de las
 * cosas que más pide un arquitecto y de las que menos se encuentran: tenerlas
 * ordenadas y accesibles es parte del valor del portal.
 *
 * `soloProfesionales` distingue lo que puede ver cualquiera de lo que se
 * entrega solo a quien está aprobado.
 */
export const technicalDocuments = pgTable(
  "technical_documents",
  {
    id: uuid().primaryKey().defaultRandom(),
    titulo: text().notNull(),
    descripcion: text(),
    categoria: text().notNull().default("general"),
    url: text().notNull(),
    /** Tipo y peso, para avisar antes de que alguien descargue 40 MB con datos móviles. */
    formato: text().notNull().default("pdf"),
    tamanoBytes: integer(),
    soloProfesionales: boolean().notNull().default(true),
    descargas: integer().notNull().default(0),
    activo: boolean().notNull().default(true),
    orden: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("technical_documents_categoria_idx").on(t.categoria, t.activo),
  ],
);

/* -------------------------------------------------------------------------- */
/* Eventos y capacitaciones                                                    */
/* -------------------------------------------------------------------------- */

export const estadoEvento = pgEnum("estado_evento", [
  "borrador",
  "publicado",
  "cerrado",
  "cancelado",
]);

/**
 * Eventos tipo "Wood Frame Experiencia" (cláusula 1.7).
 *
 * Capacitaciones con fecha, lugar, cupo y precio. El cupo es el dato que manda:
 * sobrevender una capacitación presencial significa gente parada en la puerta.
 */
export const events = pgTable(
  "events",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    titulo: text().notNull(),
    resumen: text(),
    descripcion: text(),
    imagenUrl: text(),
    lugar: text(),
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),
    inicia: timestamp({ withTimezone: true }).notNull(),
    termina: timestamp({ withTimezone: true }),
    /** Cero significa sin tope. */
    cupo: integer().notNull().default(0),
    /** Cero significa gratuito: la inscripción no pasa por el cobro. */
    precio: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    /** Si solo pueden inscribirse profesionales aprobados. */
    soloProfesionales: boolean().notNull().default(false),
    estado: estadoEvento().notNull().default("borrador"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("events_slug_idx").on(t.slug),
    index("events_estado_idx").on(t.estado),
    index("events_inicia_idx").on(t.inicia),
  ],
);

export const estadoInscripcion = pgEnum("estado_inscripcion", [
  "reservada",
  "confirmada",
  "asistio",
  "ausente",
  "cancelada",
]);

/**
 * Inscripción a un evento.
 *
 * `reservada` es "anotado y sin pagar": ocupa cupo mientras el pago está en
 * curso, y se libera si se cancela. En un evento con precio, `confirmada` llega
 * por el mismo `acreditarPago` que cobra un pedido.
 */
export const eventRegistrations = pgTable(
  "event_registrations",
  {
    id: uuid().primaryKey().defaultRandom(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    nombre: text().notNull(),
    email: text().notNull(),
    telefono: text(),
    estado: estadoInscripcion().notNull().default("reservada"),
    paymentId: uuid(),
    /** Si ya se le mandó el recordatorio, para no mandarlo dos veces. */
    recordadoAt: timestamp({ withTimezone: true }),
    notas: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Una persona no se anota dos veces al mismo evento con el mismo correo.
    uniqueIndex("event_registrations_evento_email_idx").on(t.eventId, t.email),
    index("event_registrations_evento_idx").on(t.eventId, t.estado),
  ],
);

export const professionalApplicationsRelations = relations(
  professionalApplications,
  ({ one }) => ({
    customer: one(customers, {
      fields: [professionalApplications.customerId],
      references: [customers.id],
    }),
  }),
);

export const eventsRelations = relations(events, ({ one, many }) => ({
  branch: one(branches, {
    fields: [events.branchId],
    references: [branches.id],
  }),
  inscripciones: many(eventRegistrations),
}));

export const eventRegistrationsRelations = relations(
  eventRegistrations,
  ({ one }) => ({
    event: one(events, {
      fields: [eventRegistrations.eventId],
      references: [events.id],
    }),
    customer: one(customers, {
      fields: [eventRegistrations.customerId],
      references: [customers.id],
    }),
  }),
);

export type ProfessionalApplication =
  typeof professionalApplications.$inferSelect;
export type VolumeDiscount = typeof volumeDiscounts.$inferSelect;
export type TechnicalDocument = typeof technicalDocuments.$inferSelect;
export type Evento = typeof events.$inferSelect;
export type EventRegistration = typeof eventRegistrations.$inferSelect;
