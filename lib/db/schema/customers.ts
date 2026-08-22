import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { condicionIva } from "./profiles";
import { priceLists } from "./pricing";

/**
 * Clientes del negocio.
 *
 * Tabla propia y no `profiles` porque la mayoría de los clientes de una maderera
 * nunca se van a crear una cuenta: compran en el mostrador y hay que poder
 * facturarles igual. `userId` queda en null hasta que esa persona se registre en
 * el sitio, y ahí se vinculan las dos cosas.
 */
export const tipoCliente = pgEnum("tipo_cliente", ["particular", "profesional"]);

export const estadoCliente = pgEnum("estado_cliente", [
  "activo",
  "moroso",
  "inactivo",
]);

export const customers = pgTable(
  "customers",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    nombre: text().notNull(),
    razonSocial: text(),
    cuit: text(),
    condicionIva: condicionIva().notNull().default("consumidor_final"),
    email: text(),
    telefono: text(),
    direccion: text(),
    rubro: text(),
    tipo: tipoCliente().notNull().default("particular"),
    estado: estadoCliente().notNull().default("activo"),
    /** Si es null, se usa la lista por defecto. */
    priceListId: uuid().references(() => priceLists.id, {
      onDelete: "set null",
    }),
    /** Tope de cuenta corriente. Cero significa que no opera a cuenta. */
    limiteCredito: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    asesor: text(),
    notas: text(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customers_nombre_idx").on(t.nombre),
    index("customers_cuit_idx").on(t.cuit),
    uniqueIndex("customers_user_idx").on(t.userId),
  ],
);

export const tipoMovimientoCuenta = pgEnum("tipo_movimiento_cuenta", [
  "compra",
  "pago",
  "nota_credito",
  "nota_debito",
  "ajuste",
]);

/**
 * Movimientos de cuenta corriente.
 *
 * El saldo no se guarda: se suma. Un saldo cacheado se desincroniza en cuanto
 * algo falla a la mitad, y en una cuenta corriente esa diferencia se descubre
 * discutiendo con el cliente.
 *
 * Positivo = el cliente debe. Negativo = pagó o se le acreditó.
 */
export const accountMovements = pgTable(
  "account_movements",
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    tipo: tipoMovimientoCuenta().notNull(),
    monto: numeric({ precision: 12, scale: 2 }).notNull(),
    detalle: text(),
    /** Comprobante que originó el movimiento, si hay. */
    referencia: text(),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("account_movements_customer_idx").on(t.customerId),
    index("account_movements_created_idx").on(t.createdAt),
  ],
);

/**
 * Direcciones guardadas del cliente.
 *
 * Existen para que quien compra seguido no vuelva a tipear la dirección de la
 * obra en cada checkout. Van en tabla aparte y no como una columna más de
 * `customers` porque una constructora entrega en varios lados a la vez, y
 * `customers.direccion` sigue siendo el domicilio fiscal, que es otra cosa.
 */
export const addresses = pgTable(
  "addresses",
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** Cómo la reconoce el cliente: "Casa", "Obra Alem 3400". */
    etiqueta: text().notNull(),
    calle: text().notNull(),
    localidad: text().notNull().default("Mar del Plata"),
    codigoPostal: text(),
    /** Referencias para el fletero: "portón verde", "tocar timbre del fondo". */
    notas: text(),
    predeterminada: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("addresses_customer_idx").on(t.customerId)],
);

export const customersRelations = relations(customers, ({ one, many }) => ({
  user: one(user, { fields: [customers.userId], references: [user.id] }),
  priceList: one(priceLists, {
    fields: [customers.priceListId],
    references: [priceLists.id],
  }),
  movimientos: many(accountMovements),
  direcciones: many(addresses),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  customer: one(customers, {
    fields: [addresses.customerId],
    references: [customers.id],
  }),
}));

export const accountMovementsRelations = relations(
  accountMovements,
  ({ one }) => ({
    customer: one(customers, {
      fields: [accountMovements.customerId],
      references: [customers.id],
    }),
  }),
);

export type Customer = typeof customers.$inferSelect;
export type AccountMovement = typeof accountMovements.$inferSelect;
export type Address = typeof addresses.$inferSelect;
