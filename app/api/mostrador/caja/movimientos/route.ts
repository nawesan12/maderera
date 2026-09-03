import { z } from "zod";
import { db } from "@/lib/db";
import { cashMovements } from "@/lib/db/schema";
import { fechaAcotada } from "@/lib/mostrador/offline/numero-provisorio";
import { turnoQueContiene } from "@/lib/mostrador/turno";
import { conStaff } from "../../guardia";

/**
 * Un ingreso o un retiro de caja, que puede haber esperado en la cola.
 *
 * Se resuelve igual que una venta diferida: el movimiento cae en el turno que
 * estaba abierto **cuando pasó**, no en el que esté abierto cuando llega. Un
 * retiro de las 19:40 no pertenece al turno de mañana.
 *
 * La `clave` la genera el navegador y el índice único la hace repetible: un
 * reintento de la cola no puede cargar dos veces el mismo retiro, que es
 * exactamente el error que aparecería como un faltante de caja.
 */
const esquema = z.object({
  clave: z.string().uuid(),
  branchId: z.string().uuid(),
  tipo: z.enum(["ingreso", "retiro"]),
  monto: z.number().positive(),
  motivo: z.string().min(1),
  hechoAt: z.string().datetime(),
});

export async function POST(request: Request) {
  return conStaff(async (usuario) => {
    const crudo = await request.json().catch(() => null);
    const leido = esquema.safeParse(crudo);

    // Un fallo de forma es definitivo: la cola no tiene que reintentarlo nunca,
    // porque el mismo cuerpo va a fallar igual dentro de una hora.
    if (!leido.success) {
      return { error: "datos", detalle: "El movimiento llegó incompleto." };
    }

    const datos = leido.data;
    const momento = fechaAcotada(new Date(datos.hechoAt));
    const turno = await turnoQueContiene(db, datos.branchId, momento);

    if (!turno) {
      return {
        error: "sin_turno",
        detalle: "No había ninguna caja abierta en ese momento.",
      };
    }

    const [movimiento] = await db
      .insert(cashMovements)
      .values({
        sessionId: turno.id,
        tipo: datos.tipo,
        // El signo lo pone el tipo, como en el resto del libro: así el efectivo
        // esperado es una suma sola y no una suma con excepciones.
        monto: (datos.tipo === "retiro" ? -datos.monto : datos.monto).toFixed(2),
        motivo: datos.motivo.trim(),
        clave: datos.clave,
        creadoPor: usuario.userId,
        createdAt: momento,
      })
      // La clave ya cargada significa que este movimiento ya entró. No es un
      // error: es el reintento haciendo lo que tiene que hacer.
      .onConflictDoNothing({ target: cashMovements.clave })
      .returning({ id: cashMovements.id });

    return { ok: true, nuevo: Boolean(movimiento), sessionId: turno.id };
  });
}
