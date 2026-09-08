"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  productReviews,
  products,
  siteSettings,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

export interface EstadoContenido {
  error?: string;
  ok?: string;
}

function refrescar() {
  // Los ajustes del sitio están cacheados entre visitas. `updateTag` expira la
  // entrada en el acto, así que el cambio se ve al recargar y no cuando vence
  // la red de seguridad.
  updateTag(ETIQUETAS.ajustes);
  updateTag(ETIQUETAS.contenido);

  revalidatePath("/admin/contenido");
  revalidatePath("/");
}

export async function guardarAjuste(
  _previo: EstadoContenido,
  formData: FormData,
): Promise<EstadoContenido> {
  await requireStaff();

  const parsed = z
    .object({ clave: z.string().min(1).max(60), valor: z.string().max(500) })
    .safeParse({
      clave: formData.get("clave"),
      valor: formData.get("valor") ?? "",
    });

  if (!parsed.success) return { error: "Datos inválidos." };

  await db
    .update(siteSettings)
    .set({ valor: parsed.data.valor, updatedAt: new Date() })
    .where(eq(siteSettings.clave, parsed.data.clave));

  refrescar();

  return { ok: "Guardado." };
}


/**
 * Publica o rechaza una reseña.
 *
 * Todas son de compra verificada, así que lo que se decide no es si la persona
 * compró: es si lo que escribió va firmado en la ficha del producto. El motivo
 * del rechazo se guarda para poder explicarlo si alguien pregunta.
 */
export async function moderarResena(
  _previo: EstadoContenido,
  formData: FormData,
): Promise<EstadoContenido> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      id: z.string().uuid(),
      estado: z.enum(["publicada", "rechazada", "pendiente"]),
      motivo: z.string().trim().max(300).optional(),
    })
    .safeParse({
      id: formData.get("id"),
      estado: formData.get("estado"),
      motivo: (formData.get("motivo") as string) || undefined,
    });

  if (!parsed.success) return { error: "Datos inválidos." };

  const [fila] = await db
    .update(productReviews)
    .set({
      estado: parsed.data.estado,
      // El motivo solo tiene sentido en un rechazo: dejarlo pegado a una reseña
      // que después se publica explicaría algo que ya no pasó.
      motivoRechazo:
        parsed.data.estado === "rechazada" ? (parsed.data.motivo ?? null) : null,
      resueltoPor: usuario.userId,
      updatedAt: new Date(),
    })
    .where(eq(productReviews.id, parsed.data.id))
    .returning({ productId: productReviews.productId });

  if (!fila) return { error: "Esa reseña no existe." };

  const [producto] = await db
    .select({ slug: products.slug })
    .from(products)
    .where(eq(products.id, fila.productId))
    .limit(1);

  refrescar();
  if (producto) revalidatePath(`/catalogo/${producto.slug}`);
  updateTag(ETIQUETAS.catalogo);

  return {
    ok:
      parsed.data.estado === "publicada"
        ? "Reseña publicada."
        : parsed.data.estado === "rechazada"
          ? "Reseña rechazada. No se muestra en el sitio."
          : "Reseña vuelta a pendiente.",
  };
}
