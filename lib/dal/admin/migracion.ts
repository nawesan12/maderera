import "server-only";

import { desc, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  customers,
  inventory,
  migrationRuns,
  productVariants,
  type MigrationRun,
  type RechazoMigracion,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

export interface CorridaMigracion {
  id: string;
  entidad: MigrationRun["entidad"];
  archivo: string;
  estado: MigrationRun["estado"];
  filasTotales: number;
  creados: number;
  actualizados: number;
  omitidos: number;
  conError: number;
  rechazos: RechazoMigracion[];
  createdAt: Date;
  finishedAt: Date | null;
}

/** Últimas corridas, para saber qué se migró y qué quedó por el camino. */
export async function historialDeMigraciones(
  limite = 20,
): Promise<CorridaMigracion[]> {
  await requireStaff();

  const filas = await db
    .select()
    .from(migrationRuns)
    .orderBy(desc(migrationRuns.createdAt))
    .limit(limite);

  return filas.map((fila) => ({
    id: fila.id,
    entidad: fila.entidad,
    archivo: fila.archivo,
    estado: fila.estado,
    filasTotales: fila.filasTotales,
    creados: fila.creados,
    actualizados: fila.actualizados,
    omitidos: fila.omitidos,
    conError: fila.conError,
    rechazos: (fila.rechazos as RechazoMigracion[]) ?? [],
    createdAt: fila.createdAt,
    finishedAt: fila.finishedAt,
  }));
}

export interface EstadoDelSistema {
  clientes: number;
  clientesMigrados: number;
  medidas: number;
  conExistencia: number;
  saldosMigrados: number;
}

/**
 * Lo que ya hay cargado, para poder mirar antes de subir nada.
 *
 * En una migración la pregunta previa siempre es la misma: "¿esto ya lo corrí?".
 * Los contadores de fichas con código del sistema anterior y de saldos
 * iniciales la contestan sin abrir el historial.
 */
export async function estadoDelSistema(): Promise<EstadoDelSistema> {
  await requireStaff();

  const contar = sql<number>`count(*)::int`;

  const [[clientes], [migrados], [medidas], [existencias], [saldos]] =
    await Promise.all([
      db.select({ n: contar }).from(customers),
      db
        .select({ n: contar })
        .from(customers)
        .where(isNotNull(customers.codigoLegacy)),
      db.select({ n: contar }).from(productVariants),
      db.select({ n: contar }).from(inventory).where(sql`${inventory.qty} > 0`),
      db
        .select({ n: contar })
        .from(accountMovements)
        .where(sql`${accountMovements.referencia} = 'SALDO-INICIAL'`),
    ]);

  return {
    clientes: clientes?.n ?? 0,
    clientesMigrados: migrados?.n ?? 0,
    medidas: medidas?.n ?? 0,
    conExistencia: existencias?.n ?? 0,
    saldosMigrados: saldos?.n ?? 0,
  };
}
