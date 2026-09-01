import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, cashMovements, cashSessions, user } from "@/lib/db/schema";

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
