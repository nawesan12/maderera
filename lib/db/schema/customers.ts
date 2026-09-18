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

/**
 * Los vendedores de la casa.
 *
 * La clienta: "hay clientes que se cargan con un vendedor asignado (o sea que
 * hay vendedores, y vendedores de calle)". Hasta ahora el vendedor era el
 * campo de texto `asesor`, y "Gabriela" y "GABRIELA" eran dos personas
 * distintas para cualquier reporte.
 *
 * Tabla propia y **no** una FK a `user`: el vendedor de calle no opera el
 * sistema —vende, y otro carga—. El día que uno tenga usuario se pueden
 * vincular, pero la entidad existe aunque nunca lo tenga.
 */
export const tipoVendedor = pgEnum("tipo_vendedor", ["salon", "calle"]);

export const sellers = pgTable(
  "sellers",
  {
    id: uuid().primaryKey().defaultRandom(),
    nombre: text().notNull(),
    tipo: tipoVendedor().notNull().default("salon"),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sellers_nombre_idx").on(t.nombre)],
);

export type Seller = typeof sellers.$inferSelect;

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
    /**
     * A cuántos días vence lo que compra a cuenta.
     *
     * Era una constante global de 30 días (`DIAS_PARA_VENCER`) porque el brief
     * decía que el plazo «depende del cliente» sin fijarlo. Ahora depende del
     * cliente de verdad: la constructora a la que se le dan 60 días y el que
     * paga a 15 no pueden tener el mismo corte, y con un solo número uno de los
     * dos siempre queda mal marcado.
     */
    diasCredito: integer().notNull().default(30),
    /**
     * Cuenta corriente bloqueada a mano.
     *
     * Es lo que la clienta ya hace en papel: cuando alguien se atrasa, le cortan
     * la cuenta hasta que se ponga al día. Distinto del bloqueo automático por
     * mora —que se calcula de la antigüedad— porque éste lo decide una persona y
     * no se levanta solo: hay que volver a habilitarlo.
     */
    cuentaBloqueada: boolean().notNull().default(false),
    /** Por qué se bloqueó. Es lo que se le explica al cliente cuando reclama. */
    motivoBloqueo: text(),
    /** El vendedor asignado. `asesor` queda como texto legado de la migración. */
    sellerId: uuid().references(() => sellers.id, { onDelete: "set null" }),
    asesor: text(),
    notas: text(),
    /**
     * Código de esta ficha en el sistema anterior (cláusula 1.9).
     *
     * Es lo único que permite volver a correr la migración sin duplicar la
     * cartera entera, y lo que después ata cada saldo de cuenta corriente a su
     * ficha: el CUIT no alcanza porque media cartera de una maderera son
     * consumidores finales sin CUIT cargado. Queda para siempre, no solo
     * durante la migración, porque el cliente va a seguir nombrando a la gente
     * por el número que usaba antes.
     */
    codigoLegacy: text(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customers_nombre_idx").on(t.nombre),
    index("customers_cuit_idx").on(t.cuit),
    uniqueIndex("customers_codigo_legacy_idx").on(t.codigoLegacy),
    uniqueIndex("customers_user_idx").on(t.userId),
  ],
);

/**
 * En qué anda una gestión con un cliente.
 *
 * Las cuatro etapas de un seguimiento real, que es el que la clienta pidió
 * asentar: hay algo para hacer, se está hablando, quedó una promesa con fecha,
 * o se terminó. No son etapas de venta genéricas de un CRM —«prospecto»,
 * «calificado»— porque acá el cliente ya existe: lo que se sigue es la gestión,
 * casi siempre una cobranza o un presupuesto que espera respuesta.
 */
export const etapaSeguimiento = pgEnum("etapa_seguimiento", [
  "pendiente",
  "hablando",
  "promesa",
  "cerrado",
]);

/**
 * Las gestiones con un cliente, con su recordatorio.
 *
 * **Por qué existe.** De la clienta: «seguimiento tipo pipeline para que los
 * recordatorios estén asentados». Hasta ahora lo único que había era un campo
 * de notas en la ficha —un solo texto, que se pisa— y todo lo demás vivía en la
 * cabeza de quien atendió: a quién había que volver a llamar, qué prometió y
 * para cuándo.
 *
 * Lo que la vuelve útil es **`proximaAccionAt`**: una gestión sin fecha es una
 * anotación, y una anotación no aparece sola el día que hay que hacer algo. Con
 * la fecha, lo vencido entra al «Para hoy» del panel.
 */
export const customerFollowUps = pgTable(
  "customer_follow_ups",
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    etapa: etapaSeguimiento().notNull().default("pendiente"),
    /** De qué se trata, en una línea: "Cobrar la factura 1234". */
    asunto: text().notNull(),
    /** Lo que se fue hablando. Se agrega, no se pisa. */
    notas: text(),
    /** Cuándo hay que volver. Sin esto, la gestión no aparece sola nunca. */
    proximaAccionAt: timestamp({ withTimezone: true }),
    /** Quién la tiene: el vendedor que atiende a este cliente. */
    responsableUserId: text(),
    creadoPor: text(),
    cerradoAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("customer_follow_ups_cliente_idx").on(t.customerId),
    // Por acá entra el "Para hoy": lo que vence, de lo que sigue abierto.
    index("customer_follow_ups_proxima_idx").on(t.etapa, t.proximaAccionAt),
  ],
);

export type CustomerFollowUp = typeof customerFollowUps.$inferSelect;

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
 * obra en cada compra. Van en tabla aparte y no como una columna más de
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
