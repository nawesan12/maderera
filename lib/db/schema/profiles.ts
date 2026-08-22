import { relations } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { priceLists } from "./pricing";

/** Qué es esta persona para el negocio. */
export const userRole = pgEnum("user_role", [
  "cliente",
  "profesional",
  "staff",
]);

/** Qué puede hacer dentro del panel. Solo aplica a `userRole = staff`. */
export const staffRole = pgEnum("staff_role", [
  "admin",
  "vendedor",
  "deposito",
]);

/**
 * Condición frente al IVA del receptor. ARCA la exige en toda factura emitida
 * (`CondicionIVAReceptorId`, obligatorio desde abril de 2026), así que se pide
 * desde el registro y no en el momento de facturar.
 */
export const condicionIva = pgEnum("condicion_iva", [
  "responsable_inscripto",
  "monotributista",
  "exento",
  "consumidor_final",
  "no_categorizado",
]);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: userRole().notNull().default("cliente"),
    staffRole: staffRole(),
    /** Lista de precios que ve esta persona. Si es null, se usa la lista por defecto. */
    priceListId: uuid().references(() => priceLists.id, {
      onDelete: "set null",
    }),
    razonSocial: text(),
    cuit: text(),
    condicionIva: condicionIva().notNull().default("consumidor_final"),
    telefono: text(),
    rubro: text(),
    notas: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("profiles_user_idx").on(t.userId),
    index("profiles_cuit_idx").on(t.cuit),
    index("profiles_role_idx").on(t.role),
  ],
);

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(user, {
    fields: [profiles.userId],
    references: [user.id],
  }),
  priceList: one(priceLists, {
    fields: [profiles.priceListId],
    references: [priceLists.id],
  }),
}));

export type Profile = typeof profiles.$inferSelect;
