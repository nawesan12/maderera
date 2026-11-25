"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

export interface EstadoResena {
  error?: string;
  ok?: string;
}

/**
 * Dejar una reseña. La valida la API de Go (backend/internal/contenido):
 * solo de un pedido entregado, una por compra, y queda pendiente hasta que
 * alguien de la maderera la publica.
 */
export async function dejarResena(_previo: EstadoResena, formData: FormData): Promise<EstadoResena> {
  const texto = String(formData.get("texto") ?? "").trim();
  const r = await (await api()).POST("/api/v1/contenido/mis-resenas", {
    body: {
      productId: String(formData.get("productId") ?? ""),
      orderId: String(formData.get("orderId") ?? ""),
      estrellas: Number(formData.get("estrellas")),
      ...(texto ? { texto } : {}),
    },
  });
  if (r.response.status === 401) return { error: "Entrá con tu cuenta para dejar una reseña." };
  if (!r.data) {
    return {
      error: mensajeDe(r.error as Problema | undefined, "No pudimos guardar la reseña. Probá de nuevo en un momento."),
    };
  }

  revalidatePath("/mi-cuenta/resenas");
  revalidatePath("/admin/contenido");
  if (r.data.slug) revalidatePath(`/catalogo/${r.data.slug}`);
  updateTag(ETIQUETAS.catalogo);
  return { ok: "Gracias. La publicamos apenas la revisemos." };
}
