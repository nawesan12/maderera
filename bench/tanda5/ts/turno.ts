import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { cashSessions } from "@/lib/db/schema";

type Transaccion = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

/**
 * Sirve dentro y fuera de una transacción.
 *
 * La venta lo llama con su `tx`, porque ahí el turno y el movimiento tienen que
 * decidirse juntos. Un ingreso de caja suelto lo llama con `db`, porque es una
 * sola escritura y no hay nada que serializar.
 */
type Consultador = Transaccion | typeof import("@/lib/db").db;

/**
 * A qué turno de caja pertenece una venta.
 *
 * Existe por una situación concreta y para nada rara: el mostrador vendió sin
 * internet a las 19:40, alguien cerró la caja a las 20:00, y la venta llega al
 * servidor a las 20:15. Buscar "el turno abierto" mandaría esa plata al turno
 * de mañana, o a ninguno.
 *
 * La regla es la que cualquiera diría en voz alta: **la venta cae en el turno
 * que estaba abierto cuando se cobró.** Se busca por la ventana del turno y no
 * por su estado, así que la venta en línea —cuyo momento es ahora— encuentra el
 * turno abierto, y la diferida encuentra el que le corresponde aunque ya esté
 * cerrado.
 *
 * Que un movimiento entre a un turno cerrado corre su diferencia después del
 * arqueo, y eso no se esconde: `/admin/caja` marca los turnos donde pasó. La
 * alternativa —tirar la plata en el turno de hoy— no cambia el problema de
 * lugar, lo cambia de día y lo vuelve inexplicable.
 */
export async function turnoQueContiene(
  tx: Consultador,
  branchId: string,
  momento: Date,
) {
  const [turno] = await tx
    .select({ id: cashSessions.id, estado: cashSessions.estado })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.branchId, branchId),
        sql`${cashSessions.abiertaAt} <= ${momento}`,
        // Sin cierre el turno sigue corriendo, así que contiene cualquier
        // momento posterior a su apertura.
        sql`(${cashSessions.cerradaAt} is null or ${cashSessions.cerradaAt} >= ${momento})`,
      ),
    )
    // Si dos turnos de la misma sucursal se tocaran en el borde —el cierre de
    // uno y la apertura del otro en el mismo segundo—, gana el más nuevo, que
    // es el que estaba corriendo.
    .orderBy(desc(cashSessions.abiertaAt))
    .limit(1);

  return turno ?? null;
}
