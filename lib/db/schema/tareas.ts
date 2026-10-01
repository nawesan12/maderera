import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Las tareas programadas que ya corrieron, una fila por tarea y período.
 *
 * Mientras el sitio vivió en Vercel no había ningún proceso periódico: lo que
 * tenía que pasar «todos los días» era un botón (los recordatorios de eventos)
 * o no pasaba (la tabla de límites crecía sin fin). En el servidor propio un
 * contenedor `cron` llama a `/api/tareas/<tarea>` y estas filas son lo que
 * hace que **llamarla dos veces no haga nada dos veces**: la clave única
 * `(tarea, periodo)` es el candado. Un cron que se reinicia a mitad de la
 * mañana, o alguien que la dispara a mano para probar, no manda dos veces el
 * parte del día.
 *
 * Una corrida que falló se puede repetir en el mismo período; una que quedó
 * «corriendo» porque el contenedor se cayó, también, pasada media hora.
 */
export const estadoTarea = pgEnum("estado_tarea", ["corriendo", "ok", "error"]);

export const tareasCorridas = pgTable(
  "tareas_corridas",
  {
    id: uuid().primaryKey().defaultRandom(),
    tarea: text().notNull(),
    /** `2026-10-01T09` para las horarias, `2026-10-01` las diarias, `2026-W40` las semanales. */
    periodo: text().notNull(),
    estado: estadoTarea().notNull().default("corriendo"),
    /** Lo que hizo, para leerlo en el panel: `{ recordatorios: 3, limites: 120 }`. */
    resultado: jsonb(),
    error: text(),
    iniciadaAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    terminadaAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("tareas_corridas_tarea_periodo_idx").on(t.tarea, t.periodo)],
);

/**
 * La cola de trabajos con reintentos.
 *
 * Lo que llegaba por un webhook —un pago de Mercado Pago, un mensaje de
 * WhatsApp— se procesaba en `after()`, con la respuesta ya enviada. Bien para
 * contestar rápido, pero sin red: si el proceso se reiniciaba en ese segundo
 * —un despliegue, justamente— el trabajo se perdía y nadie se enteraba. En
 * Vercel no había mucho más que hacer; con un proceso vivo y un cron, sí.
 *
 * Ahora el webhook guarda el trabajo y contesta. Se procesa enseguida igual
 * (en `after()`, para no esperar al cron), y si falla o se corta, la tarea de
 * cada minuto lo retoma con espera creciente. Los trabajos se toman con
 * `FOR UPDATE SKIP LOCKED`, así dos procesadores a la vez nunca agarran el
 * mismo.
 */
export const estadoTrabajo = pgEnum("estado_trabajo", [
  "pendiente",
  "procesando",
  "hecho",
  "fallido",
]);

export const trabajos = pgTable(
  "trabajos",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Qué manejador lo procesa: `pago.aviso`, `whatsapp.payload`. */
    tipo: text().notNull(),
    carga: jsonb().notNull(),
    estado: estadoTrabajo().notNull().default("pendiente"),
    intentos: integer().notNull().default(0),
    maxIntentos: integer().notNull().default(8),
    proximoIntentoAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /**
     * Hasta cuándo lo tiene tomado quien lo está procesando. Si el proceso se
     * muere con el trabajo en la mano, pasada esta hora otro lo retoma: sin
     * esto quedaría «procesando» para siempre.
     */
    tomadoHasta: timestamp({ withTimezone: true }),
    ultimoError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    terminadoAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // Lo único que se consulta en caliente: lo que está por hacerse.
    index("trabajos_pendientes_idx")
      .on(t.proximoIntentoAt)
      .where(sql`${t.estado} in ('pendiente', 'procesando')`),
  ],
);

export type TareaCorrida = typeof tareasCorridas.$inferSelect;
export type Trabajo = typeof trabajos.$inferSelect;
