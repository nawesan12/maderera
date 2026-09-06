import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { invoices, puntosVenta } from "@/lib/db/schema";
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
 *
 * 3. **Arrancar desde donde quedó el sistema anterior.** Esta base nace vacía,
 *    pero ARCA viene contando desde hace años en los puntos de venta 15, 17 y
 *    20. Sin ese piso, el primer comprobante saldría número 1 y quedaría
 *    rechazado o —peor— duplicaría una numeración ya usada. El piso se carga
 *    por punto de venta en `/admin/arca` y es `puntos_venta.numeroInicial`.
 *
 *    El piso **no distingue por tipo de comprobante**, y es a propósito: lo
 *    que se carga es el último número emitido en ese punto de venta, sin
 *    entrar en si era una A o una nota de crédito. Empezar todos los tipos por
 *    encima de ese número es conservador —puede dejar un hueco al principio de
 *    una serie que nunca se usó— y eso es exactamente lo que conviene: un
 *    hueco no rompe nada, un número repetido sí.
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

  const [punto] = await tx
    .select({ numeroInicial: puntosVenta.numeroInicial })
    .from(puntosVenta)
    .where(eq(puntosVenta.numero, puntoVenta))
    .limit(1);

  // Gana el mayor: una vez que esta base emitió por encima del piso, el piso
  // deja de importar y manda el correlativo propio.
  const desde = Math.max(Number(fila?.maximo ?? 0), Number(punto?.numeroInicial ?? 0));

  return desde + 1;
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
