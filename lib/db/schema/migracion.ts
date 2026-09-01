import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
