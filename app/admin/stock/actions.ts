"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { inventory, inventoryMovements } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";

export interface EstadoTransferencia {
  error?: string;
  ok?: string;
}

const transferenciaSchema = z.object({
  variantId: z.string().uuid("Elegí un producto."),
  origenId: z.string().uuid("Elegí la sucursal de origen."),
  destinoId: z.string().uuid("Elegí la sucursal de destino."),
  cantidad: z.coerce.number().int().positive("La cantidad tiene que ser mayor a cero."),
  nota: z.string().trim().max(300).optional(),
});

/**
 * Mueve stock de una sucursal a otra.
 *
 * Va en una transacción porque son cuatro escrituras que tienen que valer todas o
 * ninguna: descontar del origen, sumar al destino y dejar los dos movimientos que
 * lo explican. Si se cayera a la mitad, el sistema reportaría mercadería que no
 * está en ningún lado.
 */
export async function transferirStock(
  _previo: EstadoTransferencia,
  formData: FormData,
): Promise<EstadoTransferencia> {
  const usuario = await requireStaff();

  const parsed = transferenciaSchema.safeParse({
    variantId: formData.get("variantId"),
    origenId: formData.get("origenId"),
    destinoId: formData.get("destinoId"),
    cantidad: formData.get("cantidad"),
    nota: (formData.get("nota") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const { variantId, origenId, destinoId, cantidad, nota } = parsed.data;

  if (origenId === destinoId) {
    return { error: "El origen y el destino tienen que ser distintos." };
  }

  try {
    await db.transaction(async (tx) => {
      const [enOrigen] = await tx
        .select({ qty: inventory.qty })
        .from(inventory)
        .where(
          and(eq(inventory.variantId, variantId), eq(inventory.branchId, origenId)),
        )
        .limit(1);

      const disponible = enOrigen?.qty ?? 0;

      if (disponible < cantidad) {
        // No se permite dejar el origen en negativo: si el depósito dice que hay
        // menos de lo que se quiere mover, el dato a corregir es el inventario.
        throw new Error(
          `En la sucursal de origen hay ${disponible}. No se pueden mover ${cantidad}.`,
        );
      }

      const grupo = randomUUID();

      await tx
        .update(inventory)
        .set({ qty: disponible - cantidad, updatedAt: new Date() })
        .where(
          and(eq(inventory.variantId, variantId), eq(inventory.branchId, origenId)),
        );

      await tx
        .insert(inventory)
        .values({
          variantId,
          branchId: destinoId,
          qty: cantidad,
          minQty: 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [inventory.variantId, inventory.branchId],
          set: {
            // Suma sobre lo que ya había en destino, sin leerlo antes.
            qty: sql`${inventory.qty} + ${cantidad}`,
            updatedAt: new Date(),
          },
        });

      await tx.insert(inventoryMovements).values([
        {
          variantId,
          branchId: origenId,
          type: "transferencia_salida",
          qty: -cantidad,
          note: nota,
          transferGroup: grupo,
          createdByUserId: usuario.userId,
        },
        {
          variantId,
          branchId: destinoId,
          type: "transferencia_entrada",
          qty: cantidad,
          note: nota,
          transferGroup: grupo,
          createdByUserId: usuario.userId,
        },
      ]);
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "No se pudo registrar la transferencia.",
    };
  }

  // El ajuste rápido de stock no se registra acá: `inventory_movements` ya
  // guarda cada uno con su cantidad y su autor, y son decenas por día. La
  // transferencia sí, porque mueve mercadería entre locales y es lo que se
  // discute cuando en un galpón falta lo que el sistema dice que está.
  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "stock",
    entidadId: variantId,
    descripcion: `Transfirió ${cantidad} entre sucursales${nota ? `: ${nota}` : ""}`,
    detalle: { variantId, origenId, destinoId, cantidad },
  });

  revalidatePath("/admin/stock");
  // El catálogo está cacheado entre visitas, con la lista de precios en la
  // clave. `updateTag` —y no `revalidateTag`— porque quien acaba de tocar esto
  // tiene que verlo aplicado al volver al sitio, no en la visita siguiente:
  // sin esto, el cambio tardaría hasta cinco minutos en salir.
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/stock");
  revalidatePath("/catalogo");

  return { ok: "Transferencia registrada." };
}
