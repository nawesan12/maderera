import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { customers } from "./customers";

/**
 * Bitácora de la migración desde el sistema anterior (cláusula 1.9).
 *
 * Existe por una razón puntual: la migración se corre una vez, con datos que
 * después no se pueden volver a mirar, y la pregunta que aparece semanas más
 * tarde es siempre la misma —"este cliente, ¿vino de la migración o lo cargó
 * alguien?"; "estas 40 filas que no están, ¿se cayeron o nunca vinieron?"—.
 * Sin registro no hay forma de contestarla.
 *
 * Guarda además el mapeo de columnas que se usó, para poder repetir la corrida
 * exactamente igual con un archivo corregido.
 */
export const entidadMigracion = pgEnum("entidad_migracion", [
  "clientes",
  "productos",
  "stock",
  "saldos",
  "proveedores",
  "ventas_historicas",
  "comprobantes_historicos",
]);

export const estadoMigracion = pgEnum("estado_migracion", [
  "en_curso",
  "completada",
  "interrumpida",
]);

export const migrationRuns = pgTable(
  "migration_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    entidad: entidadMigracion().notNull(),
    archivo: text().notNull(),
    codificacion: text().notNull().default("utf-8"),
    /** Mapeo campo → índice de columna, tal como se confirmó en pantalla. */
    mapeo: jsonb().notNull().default({}),
    filasTotales: integer().notNull().default(0),
    creados: integer().notNull().default(0),
    actualizados: integer().notNull().default(0),
    omitidos: integer().notNull().default(0),
    conError: integer().notNull().default(0),
    /**
     * Las filas que no entraron, con el motivo.
     *
     * Se guardan en la corrida y no solo se muestran en pantalla porque son
     * exactamente lo que hay que mandarle al cliente para que las corrija en el
     * sistema viejo, y eso pasa al día siguiente, no en el momento.
     */
    rechazos: jsonb().notNull().default([]),
    estado: estadoMigracion().notNull().default("en_curso"),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("migration_runs_entidad_idx").on(t.entidad, t.createdAt),
    index("migration_runs_created_idx").on(t.createdAt),
  ],
);

/** Una fila que no entró, tal como se guarda en `rechazos`. */
export interface RechazoMigracion {
  linea: number;
  identificador: string;
  motivo: string;
}

export type MigrationRun = typeof migrationRuns.$inferSelect;


/* -------------------------------------------------------------------------- */
/* El archivo histórico                                                        */
/* -------------------------------------------------------------------------- */

/*
 * Las ventas y los comprobantes del sistema anterior van a tablas propias, no
 * a `orders` ni a `invoices`. Es la decisión de diseño de este módulo y vale
 * la pena dejarla escrita, porque la tentación de meterlos "donde van" es
 * fuerte y las dos veces sale mal:
 *
 * - Un pedido viejo cargado en `orders` dispararía reservas de stock por
 *   mercadería que se entregó hace tres años, y quedaría en la cola del panel
 *   como trabajo por hacer.
 * - Un comprobante viejo cargado en `invoices` contaminaría
 *   `max(invoices.numero)`, que es de donde sale el correlativo de los
 *   comprobantes nuevos. Además no tiene CAE propio de este sistema, así que
 *   habría que inventarle un estado que mienta.
 *
 * Se migran para poder consultarlos —"¿qué le vendimos a este cliente en
 * 2019?" es la pregunta real— y por eso son de solo lectura: se escriben una
 * vez desde la migración y nada más las toca.
 */

/** Una venta del sistema anterior, tal como la exportó. */
export const historicalSales = pgTable(
  "historical_sales",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Número o identificador con el que la conocía el sistema viejo. */
    comprobanteLegacy: text().notNull(),
    /** Código de cliente del sistema viejo, para poder reconciliar después. */
    codigoClienteLegacy: text(),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    clienteNombre: text().notNull().default(""),
    fecha: timestamp({ withTimezone: true }).notNull(),
    total: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    /** El detalle tal como vino: no se intenta parsear a renglones. */
    detalle: text().notNull().default(""),
    sucursal: text(),
    vendedor: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("historical_sales_legacy_idx").on(t.comprobanteLegacy),
    index("historical_sales_customer_idx").on(t.customerId),
    index("historical_sales_fecha_idx").on(t.fecha),
  ],
);

/** Un comprobante emitido por el sistema anterior. */
export const historicalInvoices = pgTable(
  "historical_invoices",
  {
    id: uuid().primaryKey().defaultRandom(),
    /**
     * Punto de venta, tipo y número, tal como los emitió el sistema viejo.
     *
     * Van como texto y no como los enums fiscales de `invoices` a propósito:
     * lo que llegue del archivo es lo que ARCA ya tiene registrado, y
     * normalizarlo a nuestros valores sería reinterpretar un dato fiscal.
     */
    puntoVenta: integer().notNull(),
    tipo: text().notNull(),
    numero: integer().notNull(),
    codigoClienteLegacy: text(),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    clienteNombre: text().notNull().default(""),
    clienteCuit: text(),
    fecha: timestamp({ withTimezone: true }).notNull(),
    neto: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    iva: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    total: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    cae: text(),
    caeVence: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("historical_invoices_numeracion_idx").on(
      t.puntoVenta,
      t.tipo,
      t.numero,
    ),
    index("historical_invoices_customer_idx").on(t.customerId),
    index("historical_invoices_fecha_idx").on(t.fecha),
  ],
);
