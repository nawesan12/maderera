"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { branches, inventory, inventoryMovements } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

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

  const [actual] = await db
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

  await db.transaction(async (tx) => {
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
  });

  revalidatePath("/admin/stock");
  revalidatePath("/admin");
  revalidatePath("/catalogo");
  revalidatePath("/stock");

  return { ok: `${sucursal.nombre}: ${previo} → ${nuevo}` };
}
