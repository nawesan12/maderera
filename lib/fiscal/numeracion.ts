import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { invoices } from "@/lib/db/schema";
import type { TipoComprobante } from "./comprobantes";

type Transaccion = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

/**
 * Siguiente número de comprobante para un punto de venta y un tipo.
 *
 * ARCA controla que la numeración de cada punto de venta sea correlativa y sin
 * huecos. Eso obliga a dos cosas:
 *
 * 1. **Asignar el número dentro de la transacción que crea el comprobante.**
 *    Nada de pedirlo antes y usarlo después: si algo falla en el medio, ese
 *    número queda quemado y el hueco no se puede tapar.
 *
 * 2. **Tomar un lock.** Dos personas facturando al mismo tiempo leerían el
 *    mismo máximo y pedirían el mismo número. El índice único de `invoices`
 *    lo impediría, pero fallando con un error feo en la cara de quien factura;
 *    el lock hace que la segunda espere y saque el siguiente.
 *
 * `pg_advisory_xact_lock` se libera solo al terminar la transacción, con commit
 * o con rollback, así que no hay forma de quedarse con el lock tomado.
 */
export async function siguienteNumeroComprobante(
  tx: Transaccion,
  puntoVenta: number,
  tipo: TipoComprobante,
): Promise<number> {
  // La clave del lock combina punto de venta y tipo: dos comprobantes de tipos
  // distintos no compiten entre sí y pueden emitirse en paralelo.
  const clave = claveDeLock(puntoVenta, tipo);
  await tx.execute(sql`select pg_advisory_xact_lock(${clave})`);

  const [fila] = await tx
    .select({
      maximo: sql<number>`coalesce(max(${invoices.numero}), 0)::int`,
    })
    .from(invoices)
    .where(
      and(eq(invoices.puntoVenta, puntoVenta), eq(invoices.tipo, tipo)),
    );

  return Number(fila?.maximo ?? 0) + 1;
}

/**
 * Entero estable de 63 bits para el lock, derivado del punto de venta y el tipo.
 *
 * Postgres necesita un bigint, no un texto. Se arma con un hash simple: no hace
 * falta que sea criptográfico, solo que dos combinaciones distintas rara vez
 * caigan en el mismo número, y que la misma combinación dé siempre lo mismo.
 */
function claveDeLock(puntoVenta: number, tipo: string): number {
  let hash = 5381;
  for (const caracter of tipo) {
    hash = (hash * 33) ^ caracter.charCodeAt(0);
  }
  // Se acota para que entre holgado en el rango de bigint con signo.
  return Math.abs((hash >>> 0) % 1_000_000) * 10_000 + (puntoVenta % 10_000);
}
