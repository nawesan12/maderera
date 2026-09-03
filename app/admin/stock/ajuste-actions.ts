"use server";

import { revalidatePath, updateTag } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { branches, inventory, inventoryMovements } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { claveDeLock } from "@/lib/inventario/locks";
import { ETIQUETAS } from "@/lib/cache-publico";

export interface EstadoAjuste {
  error?: string;
  ok?: string;
}

const ajusteSchema = z.object({
  variantId: z.string().uuid(),
  branchSlug: z.enum(["casa-central", "aserradero"]),
  cantidad: z.coerce.number().int(),
});

/**
 * Suma o resta stock en una sucursal.
 *
 * Es para el uso de todos los días: llegó mercadería, se rompió una placa, se
 * contó mal. Cada ajuste deja su movimiento, así que el inventario siempre
 * puede explicar por qué dice lo que dice.
 */
export async function ajustarStock(
  variantId: string,
  branchSlug: string,
  cantidad: number,
): Promise<EstadoAjuste> {
  const usuario = await requireStaff();

  const parsed = ajusteSchema.safeParse({ variantId, branchSlug, cantidad });
  if (!parsed.success) return { error: "Datos inválidos." };
  if (parsed.data.cantidad === 0) return {};

  const [sucursal] = await db
    .select({ id: branches.id, nombre: branches.name })
    .from(branches)
    .where(eq(branches.slug, parsed.data.branchSlug))
    .limit(1);

  if (!sucursal) return { error: "No se encontró la sucursal." };

  /*
   * Leer y escribir **adentro de la misma transacción, y con el lock tomado**.
   *
   * Antes el `select` del valor previo estaba afuera y el `update` escribía la
   * cantidad absoluta. Dos ajustes simultáneos sobre la misma variante leían el
   * mismo previo y el segundo pisaba al primero: se perdía un ajuste entero, no
   * un centavo. Con el lock, el segundo espera y lee el número ya corregido.
   *
   * Se sigue escribiendo el absoluto y no `qty + n` a propósito: es lo que
   * permite decir "de 12 a 15" en el mensaje y en el libro de movimientos, que
   * es el valor de esta pantalla. Con el lock puesto, absoluto y relativo son
   * equivalentes.
   */
  const resultado = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${claveDeLock(parsed.data.variantId, sucursal.id)})`,
    );

    const [actual] = await tx
      .select({ qty: inventory.qty })
      .from(inventory)
      .where(
        and(
          eq(inventory.variantId, parsed.data.variantId),
          eq(inventory.branchId, sucursal.id),
        ),
      )
      .limit(1);

    const previo = actual?.qty ?? 0;
    const nuevo = previo + parsed.data.cantidad;

    if (nuevo < 0) {
      // El inventario no baja de cero: si el depósito dice que hay menos de lo
      // que el sistema descuenta, lo que hay que corregir es el número, no
      // permitir un negativo que después nadie entiende.
      return { error: `Solo hay ${previo} en ${sucursal.nombre}.` };
    }

    await tx
      .insert(inventory)
      .values({
        variantId: parsed.data.variantId,
        branchId: sucursal.id,
        qty: nuevo,
        minQty: 0,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [inventory.variantId, inventory.branchId],
        set: { qty: nuevo, updatedAt: new Date() },
      });

    await tx.insert(inventoryMovements).values({
      variantId: parsed.data.variantId,
      branchId: sucursal.id,
      type: parsed.data.cantidad > 0 ? "ingreso" : "egreso",
      qty: parsed.data.cantidad,
      note: `Ajuste rápido desde Stock (${previo} → ${nuevo})`,
      createdByUserId: usuario.userId,
    });

    return { ok: `${sucursal.nombre}: ${previo} → ${nuevo}` };
  });

  if (resultado.error) return resultado;

  /*
   * El nivel de stock que ve el público sale de `qty`, y el catálogo está
   * cacheado por etiqueta. Sin `updateTag`, un ajuste tardaba hasta cinco
   * minutos en verse en la tienda. Es `updateTag` y no `revalidateTag` por lo
   * mismo que en precios y sucursales: quien acaba de tocarlo tiene que verlo
   * aplicado al volver, no en la visita siguiente.
   */
  updateTag(ETIQUETAS.catalogo);

  revalidatePath("/admin/stock");
  revalidatePath("/admin");
  revalidatePath("/catalogo");
  revalidatePath("/stock");

  return resultado;
}
