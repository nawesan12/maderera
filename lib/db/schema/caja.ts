import { relations, sql } from "drizzle-orm";
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
import { branches } from "./inventory";
import { orders } from "./sales";
import { user } from "./auth";

/**
 * La caja del mostrador.
 *
 * Existe por una razón concreta: al cierre del día alguien cuenta los billetes
 * y ese número tiene que poder compararse contra algo. Sin turno de caja, la
 * plata en efectivo que entró por el mostrador queda mezclada con la que entró
 * por Mercado Pago y por transferencia, y "faltan quinientos pesos" pasa a ser
 * una frase que no se puede investigar.
 *
 * **Un turno por sucursal a la vez.** Lo garantiza un índice único parcial: dos
 * personas que abren caja en Casa Central al mismo tiempo no pueden terminar
 * con dos turnos abiertos y las ventas repartidas entre los dos.
 *
 * Lo que se guarda es el libro, no el saldo: el efectivo esperado se calcula
 * sumando los movimientos del turno. Un saldo guardado se desincroniza en
 * cuanto algo falla a la mitad, y después nadie sabe cuál de los dos números es
 * el bueno.
 */

export const estadoCaja = pgEnum("estado_caja", ["abierta", "cerrada"]);

/**
 * De dónde sale o a dónde va el efectivo.
 *
 * `venta` la genera una venta cobrada en efectivo. `ingreso` y `retiro` son a
 * mano: el cambio que se trae de la mañana, la plata que se lleva al banco.
 * `apertura` es el fondo con el que arranca el turno, y va como movimiento —y
 * no como una columna aparte— para que el efectivo esperado sea siempre la
 * misma suma y no una suma con excepciones.
 */
export const tipoMovimientoCaja = pgEnum("tipo_movimiento_caja", [
  "apertura",
  "venta",
  "ingreso",
  "retiro",
  "devolucion",
  /**
   * Plata que salió por un gasto concreto.
   *
   * Existe aparte de `retiro` porque un retiro es plata que se movió de lugar
   * —al banco, a la caja fuerte— y un gasto es plata que se fue. Hasta acá los
   * dos se anotaban como retiro y quedaban sin clasificar: al cierre del mes
   * nadie podía decir cuánto se gastó en fletes.
   */
  "gasto",
]);

export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),

    abiertaPor: text("abierta_por")
      .notNull()
      .references(() => user.id),
    abiertaAt: timestamp("abierta_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    cerradaPor: text("cerrada_por").references(() => user.id),
    cerradaAt: timestamp("cerrada_at", { withTimezone: true }),

    /**
     * Lo que se contó al cerrar. Se guarda tal como lo dijo la persona, sin
     * corregirlo contra lo esperado: la diferencia es justamente el dato que
     * interesa, y pisarla sería tapar lo único que este registro sirve para ver.
     */
    contado: numeric("contado", { precision: 12, scale: 2 }),

    estado: estadoCaja("estado").notNull().default("abierta"),
    notas: text("notas"),
  },
  (t) => [
    /*
     * Un solo turno abierto por sucursal. El índice es parcial —solo mira las
     * filas abiertas— porque los turnos cerrados de la misma sucursal son
     * justamente lo que se quiere acumular.
     */
    uniqueIndex("cash_sessions_una_abierta_por_sucursal")
      .on(t.branchId)
      .where(sql`${t.estado} = 'abierta'`),
    index("cash_sessions_abierta_idx").on(t.abiertaAt),
  ],
);

export const cashMovements = pgTable(
  "cash_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => cashSessions.id, { onDelete: "cascade" }),

    tipo: tipoMovimientoCaja("tipo").notNull(),

    /**
     * Con signo: positivo entra, negativo sale. Guardar el signo en el monto y
     * no derivarlo del tipo hace que el efectivo esperado sea una suma sola, y
     * que una devolución no dependa de que alguien recuerde restarla.
     */
    monto: numeric("monto", { precision: 12, scale: 2 }).notNull(),

    motivo: text("motivo"),
    orderId: uuid("order_id").references(() => orders.id),

    /**
     * El gasto que originó la salida, si la originó uno.
     *
     * Sin FK declarada: `gastos.ts` importa de acá y declararla al revés
     * cerraría el ciclo entre los dos módulos. La integridad la da la
     * transacción que escribe las dos filas juntas.
     */
    expenseId: uuid("expense_id"),

    /**
     * Clave de idempotencia, para los movimientos que se encolan sin conexión.
     *
     * Mismo patrón que `orders.claveMostrador`: el navegador la genera, el
     * índice único impide que un reintento cargue dos veces el mismo ingreso.
     * Los movimientos hechos en línea la dejan en null.
     */
    clave: text("clave"),

    creadoPor: text("creado_por").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cash_movements_sesion_idx").on(t.sessionId),
    index("cash_movements_pedido_idx").on(t.orderId),
    uniqueIndex("cash_movements_clave_idx").on(t.clave),
  ],
);

export const cashSessionsRelations = relations(cashSessions, ({ one, many }) => ({
  sucursal: one(branches, {
    fields: [cashSessions.branchId],
    references: [branches.id],
  }),
  movimientos: many(cashMovements),
}));

export const cashMovementsRelations = relations(cashMovements, ({ one }) => ({
  sesion: one(cashSessions, {
    fields: [cashMovements.sessionId],
    references: [cashSessions.id],
  }),
  pedido: one(orders, {
    fields: [cashMovements.orderId],
    references: [orders.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/* Cajas físicas                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Cada máquina que vende en el mostrador.
 *
 * Existe por una sola razón: **el número provisorio de las ventas hechas sin
 * internet**. Mientras no hay servidor, la venta necesita un identificador que
 * el cliente se pueda llevar escrito, y ese identificador lo tiene que dar la
 * máquina.
 *
 * **El código lo asigna el servidor, no el dispositivo.** Si cada máquina se
 * autobautiza, dos terminan llamándose `CAJA1` y dos clientes se van con el
 * mismo papel. La `claveMostrador` protege la base contra el duplicado; no
 * protege el papel, que es sobre lo que la gente discute.
 *
 * `pendientes` lo reporta el latido de cada caja: es lo que permite que el
 * cierre de turno avise "CAJA1 tiene 4 ventas sin subir" en vez de cerrar con
 * una diferencia que va a aparecer después.
 */
export const posDevices = pgTable(
  "pos_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Lo que se imprime en el ticket: "CAJA1". */
    codigo: text("codigo").notNull(),
    nombre: text("nombre"),

    branchId: uuid("branch_id").references(() => branches.id),

    /**
     * Token opaco que guarda el navegador al vincularse.
     *
     * No autoriza nada por sí solo —la sesión sigue decidiendo quién entra—:
     * sirve para que una máquina no pueda apropiarse del contador de otra.
     */
    secreto: text("secreto").notNull(),

    activo: boolean("activo").notNull().default(true),

    /** Última vez que esta caja dio señales de vida. */
    ultimaVezAt: timestamp("ultima_vez_at", { withTimezone: true }),

    /** Ventas sin subir que reportó en su último latido. */
    pendientes: integer("pendientes").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("pos_devices_codigo_idx").on(t.codigo)],
);

export type PosDevice = typeof posDevices.$inferSelect;
