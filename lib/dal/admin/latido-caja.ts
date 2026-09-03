import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posDevices } from "@/lib/db/schema";

/**
 * Lo que cada caja del mostrador reporta de sí misma en cada latido.
 *
 * Es el único canal por el que el servidor se entera de que una máquina tiene
 * ventas sin subir, y de eso depende que el cierre de turno pueda frenarse a
 * tiempo. Por eso el latido escribe, aunque un latido que escribe suene raro:
 * el dato no existe en ningún otro lado hasta que la venta llega, y para
 * entonces ya es tarde.
 *
 * El secreto se verifica acá y no en la guardia: no decide quién entra —de eso
 * se ocupa la sesión— sino **de qué caja se está hablando**. Sin él, una
 * pestaña podría poner en cero los pendientes de otra máquina y destrabar un
 * cierre que tenía que quedar trabado.
 */
export async function anotarLatido(
  cajaId: string,
  secreto: string,
  pendientes: number,
): Promise<boolean> {
  const filas = await db
    .update(posDevices)
    .set({
      ultimaVezAt: new Date(),
      pendientes: Math.max(0, Math.trunc(pendientes)),
    })
    .where(and(eq(posDevices.id, cajaId), eq(posDevices.secreto, secreto)))
    .returning({ id: posDevices.id });

  return filas.length > 0;
}
