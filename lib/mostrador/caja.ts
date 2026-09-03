import "server-only";

import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  cashMovements,
  cashSessions,
  orders,
  user,
} from "@/lib/db/schema";

/**
 * El turno de caja del mostrador.
 *
 * Lo que sostiene todo esto es una regla sola: **el efectivo esperado no se
 * guarda, se suma.** Cada vez que hace falta, se suman los movimientos del
 * turno. Un saldo guardado se desincroniza en cuanto una operación falla a la
 * mitad, y a partir de ahí nadie sabe cuál de los dos números creer.
 */

export interface TurnoAbierto {
  id: string;
  sucursal: string;
  branchId: string;
  abiertaPor: string;
  abiertaAt: Date;
  /** Suma de todos los movimientos: el efectivo que tendría que haber. */
  esperado: number;
  fondoInicial: number;
  ventasEnEfectivo: number;
  otrosIngresos: number;
  retiros: number;
  cantidadDeVentas: number;
}

/** La suma con signo de los movimientos de un turno. */
function sumaDe(tipo?: string) {
  return tipo
    ? sql<string>`coalesce(sum(${cashMovements.monto}) filter (where ${cashMovements.tipo} = ${tipo}), 0)`
    : sql<string>`coalesce(sum(${cashMovements.monto}), 0)`;
}

/**
 * El turno abierto de una sucursal, con sus totales ya sumados, o `null` si no
 * hay ninguno.
 */
export async function turnoAbierto(
  branchId: string,
): Promise<TurnoAbierto | null> {
  const [fila] = await db
    .select({
      id: cashSessions.id,
      branchId: cashSessions.branchId,
      sucursal: branches.name,
      abiertaPor: user.name,
      abiertaAt: cashSessions.abiertaAt,
      esperado: sumaDe(),
      fondoInicial: sumaDe("apertura"),
      ventasEnEfectivo: sumaDe("venta"),
      otrosIngresos: sumaDe("ingreso"),
      retiros: sumaDe("retiro"),
      cantidadDeVentas: sql<number>`count(*) filter (where ${cashMovements.tipo} = 'venta')::int`,
    })
    .from(cashSessions)
    .innerJoin(branches, eq(branches.id, cashSessions.branchId))
    .innerJoin(user, eq(user.id, cashSessions.abiertaPor))
    .leftJoin(cashMovements, eq(cashMovements.sessionId, cashSessions.id))
    .where(
      and(eq(cashSessions.branchId, branchId), eq(cashSessions.estado, "abierta")),
    )
    .groupBy(
      cashSessions.id,
      cashSessions.branchId,
      branches.name,
      user.name,
      cashSessions.abiertaAt,
    )
    .limit(1);

  if (!fila) return null;

  return {
    ...fila,
    esperado: Number(fila.esperado),
    fondoInicial: Number(fila.fondoInicial),
    ventasEnEfectivo: Number(fila.ventasEnEfectivo),
    otrosIngresos: Number(fila.otrosIngresos),
    retiros: Number(fila.retiros),
  };
}

/** Los movimientos de un turno, del más nuevo al más viejo. */
export async function movimientosDelTurno(sessionId: string) {
  return db
    .select({
      id: cashMovements.id,
      tipo: cashMovements.tipo,
      monto: cashMovements.monto,
      motivo: cashMovements.motivo,
      orderId: cashMovements.orderId,
      createdAt: cashMovements.createdAt,
      quien: user.name,
    })
    .from(cashMovements)
    .leftJoin(user, eq(user.id, cashMovements.creadoPor))
    .where(eq(cashMovements.sessionId, sessionId))
    .orderBy(desc(cashMovements.createdAt));
}

/** Los turnos ya cerrados, para la pantalla de historial del panel. */
export async function turnosCerrados(limite = 30) {
  return db
    .select({
      id: cashSessions.id,
      sucursal: branches.name,
      abiertaAt: cashSessions.abiertaAt,
      cerradaAt: cashSessions.cerradaAt,
      contado: cashSessions.contado,
      notas: cashSessions.notas,
      abiertaPor: user.name,
      esperado: sumaDe(),
      /*
       * Movimientos que entraron después del arqueo.
       *
       * Solo pueden venir de una venta hecha sin conexión que llegó tarde: cae
       * en el turno que estaba abierto cuando se cobró, y eso corre el esperado
       * de un turno que ya se contó. No se esconde, se marca: quien mira el
       * historial tiene que saber que la diferencia de esa noche se calculó
       * contra un número que después cambió.
       */
      tardios: sql<number>`count(*) filter (where ${cashMovements.createdAt} > ${cashSessions.cerradaAt})::int`,
    })
    .from(cashSessions)
    .innerJoin(branches, eq(branches.id, cashSessions.branchId))
    .innerJoin(user, eq(user.id, cashSessions.abiertaPor))
    .leftJoin(cashMovements, eq(cashMovements.sessionId, cashSessions.id))
    .where(eq(cashSessions.estado, "cerrada"))
    .groupBy(
      cashSessions.id,
      branches.name,
      cashSessions.abiertaAt,
      cashSessions.cerradaAt,
      cashSessions.contado,
      cashSessions.notas,
      user.name,
    )
    .orderBy(desc(cashSessions.cerradaAt))
    .limit(limite);
}

/** Las sucursales donde se puede abrir caja, con su turno si ya está abierto. */
export async function sucursalesConCaja() {
  return db
    .select({
      id: branches.id,
      nombre: branches.name,
      turnoId: cashSessions.id,
      abiertaAt: cashSessions.abiertaAt,
    })
    .from(branches)
    .leftJoin(
      cashSessions,
      and(
        eq(cashSessions.branchId, branches.id),
        eq(cashSessions.estado, "abierta"),
      ),
    )
    .where(eq(branches.active, true))
    .orderBy(asc(branches.sortOrder));
}

/**
 * Las ventas de mostrador de hoy en una sucursal.
 *
 * Es lo que quien atiende necesita ver para poder deshacer: el mostrador no
 * tiene historial, tiene "lo que pasó hoy". Van también las anuladas, tachadas:
 * esconderlas haría que el mismo error se anule dos veces.
 */
export async function ventasDeHoy(branchId: string) {
  return db
    .select({
      id: orders.id,
      numero: orders.numero,
      cliente: orders.contactoNombre,
      total: orders.total,
      medioPago: orders.medioPago,
      estado: orders.estado,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.branchId, branchId),
        eq(orders.origen, "mostrador"),
        sql`${orders.claveMostrador} is not null`,
        sql`${orders.createdAt} >= date_trunc('day', now())`,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(40);
}

/** Una fila del cierre Z: cuánto entró por cada medio. */
export interface RenglonDelCierre {
  medioPago: string;
  cantidad: number;
  total: number;
}

/**
 * El cierre Z del turno: cuánto entró por cada medio de pago.
 *
 * El arqueo cuenta **efectivo**, y está bien que así sea: es la única plata que
 * puede faltar del cajón. Pero un turno no es solo efectivo, y hasta acá no
 * había forma de saber cuánto se cobró con débito, con transferencia o a
 * cuenta corriente sin ir a mirar las ventas una por una. Eso es lo primero que
 * pregunta quien cierra el día.
 *
 * Las ventas del turno se identifican por sucursal y ventana de tiempo: desde
 * que se abrió hasta que se cerró, o hasta ahora si sigue abierto. Las anuladas
 * quedan afuera —el pedido pasa a `cancelado` y su plata ya se revirtió—.
 */
export async function cierresDeTurnos(
  sessionIds: string[],
): Promise<Map<string, RenglonDelCierre[]>> {
  if (sessionIds.length === 0) return new Map();

  /*
   * Una sola consulta para todos los turnos, con el join sobre la ventana de
   * cada uno. La alternativa —una consulta por turno— parece más simple hasta
   * que el historial tiene veinte filas y son veinte viajes a la base para
   * dibujar una pantalla.
   */
  const filas = await db
    .select({
      sessionId: cashSessions.id,
      medioPago: orders.medioPago,
      cantidad: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${orders.total}), 0)`,
    })
    .from(cashSessions)
    .innerJoin(
      orders,
      and(
        eq(orders.branchId, cashSessions.branchId),
        eq(orders.origen, "mostrador"),
        sql`${orders.claveMostrador} is not null`,
        sql`${orders.estado} <> 'cancelado'`,
        gte(orders.createdAt, cashSessions.abiertaAt),
        sql`(${cashSessions.cerradaAt} is null or ${orders.createdAt} <= ${cashSessions.cerradaAt})`,
      ),
    )
    .where(inArray(cashSessions.id, sessionIds))
    .groupBy(cashSessions.id, orders.medioPago);

  const porTurno = new Map<string, RenglonDelCierre[]>();

  for (const fila of filas) {
    const renglones = porTurno.get(fila.sessionId) ?? [];
    renglones.push({
      medioPago: fila.medioPago ?? "sin especificar",
      cantidad: Number(fila.cantidad),
      total: Number(fila.total),
    });
    porTurno.set(fila.sessionId, renglones);
  }

  for (const renglones of porTurno.values()) {
    renglones.sort((a, b) => b.total - a.total);
  }

  return porTurno;
}

/** El cierre de un turno solo. */
export async function cierreDelTurno(
  sessionId: string,
): Promise<RenglonDelCierre[]> {
  const cierres = await cierresDeTurnos([sessionId]);
  return cierres.get(sessionId) ?? [];
}
