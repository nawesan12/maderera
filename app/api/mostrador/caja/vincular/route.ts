import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posDevices } from "@/lib/db/schema";
import { conStaff } from "../../guardia";

/**
 * Vincular esta máquina a una caja física.
 *
 * Las cajas las da de alta el panel; acá solo se eligen. Es la regla que
 * sostiene el número provisorio: **el código lo asigna el servidor**, porque si
 * cada navegador se autobautiza, dos se llaman `CAJA1` y dos clientes se van
 * con el mismo papel.
 *
 * El secreto viaja en la respuesta y eso está bien: no autoriza nada —quien
 * pregunta ya tiene sesión de staff— y solo sirve para que el latido pueda
 * decir de qué máquina habla.
 */

/** Las cajas disponibles de una sucursal, para elegir. */
export async function GET(request: Request) {
  return conStaff(async () => {
    const branchId = new URL(request.url).searchParams.get("branchId");
    if (!branchId) return { cajas: [] };

    const cajas = await db
      .select({
        id: posDevices.id,
        codigo: posDevices.codigo,
        nombre: posDevices.nombre,
        ultimaVezAt: posDevices.ultimaVezAt,
      })
      .from(posDevices)
      .where(
        and(eq(posDevices.branchId, branchId), eq(posDevices.activo, true)),
      )
      .orderBy(asc(posDevices.codigo));

    return { cajas };
  });
}

export async function POST(request: Request) {
  return conStaff(async () => {
    const cuerpo = await request.json().catch(() => ({}));
    const cajaId = typeof cuerpo?.cajaId === "string" ? cuerpo.cajaId : null;

    if (!cajaId) return { error: "Elegí una caja." };

    const [caja] = await db
      .select({
        id: posDevices.id,
        codigo: posDevices.codigo,
        secreto: posDevices.secreto,
      })
      .from(posDevices)
      .where(and(eq(posDevices.id, cajaId), eq(posDevices.activo, true)))
      .limit(1);

    if (!caja) return { error: "Esa caja no existe o está dada de baja." };

    await db
      .update(posDevices)
      .set({ ultimaVezAt: new Date() })
      .where(eq(posDevices.id, caja.id));

    return { caja };
  });
}
