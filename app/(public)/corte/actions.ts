"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cartCortes } from "@/lib/db/schema";
import { obtenerOCrearCarrito } from "@/lib/dal/carrito";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

export interface EstadoCorte {
  error?: string;
  ok?: string;
}

/**
 * Guarda en el carrito un corte armado en el sitio.
 *
 * **Todo se vuelve a calcular en Go** (/api/v1/cortes/cotizar): la placa con
 * la lista de quien compra, el plano con el disco configurado y el
 * presupuesto, con las mismas validaciones y el freno por IP de siempre. Una
 * acción de servidor es una dirección pública: el precio nunca viaja en el
 * formulario. La escritura en el carrito sigue acá hasta que se mude el
 * carrito (tanda 6).
 */
export async function agregarCorteAlCarrito(datos: {
  variantId: string;
  mitad?: "largo" | "ancho" | null;
  cantoDescripcion?: string | null;
  piezas: unknown[];
}): Promise<EstadoCorte> {
  const r = await (await api()).POST("/api/v1/cortes/cotizar", { body: datos as Record<string, unknown> });
  if (!r.data) {
    return {
      error: mensajeDe(r.error as Problema | undefined, "Revisá las medidas: tienen que ser números en milímetros."),
    };
  }
  const c = r.data;
  const cartId = await obtenerOCrearCarrito();

  await db.insert(cartCortes).values({
    cartId,
    variantId: c.variantId,
    materialDescripcion: c.materialDescripcion,
    placaLargoMm: c.placaLargoMm,
    placaAnchoMm: c.placaAnchoMm,
    mitad: c.mitad,
    cantoDescripcion: c.cantoDescripcion,
    piezas: JSON.stringify(c.piezas),
    placas: c.placas,
    pasadas: c.pasadas,
    total: c.total,
  });

  revalidatePath("/carrito");
  revalidatePath("/carrito/confirmar");
  return { ok: "El corte quedó en tu carrito." };
}

/** Saca un corte del carrito. */
export async function quitarCorteDelCarrito(id: string): Promise<EstadoCorte> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { error: "No se pudo quitar." };

  // Del carrito de quien está pidiendo y de ningún otro.
  const cartId = await obtenerOCrearCarrito();

  await db
    .delete(cartCortes)
    .where(and(eq(cartCortes.id, parsed.data), eq(cartCortes.cartId, cartId)));

  revalidatePath("/carrito");
  revalidatePath("/carrito/confirmar");
  return { ok: "Corte quitado." };
}
