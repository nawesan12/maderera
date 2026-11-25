"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/* Los productos sugeridos de una ficha. Los guarda la API de Go (backend/internal/productos). */

export interface EstadoSugeridos {
  error?: string;
  ok?: string;
}

function refrescar(productId: string) {
  revalidatePath(`/admin/productos/${productId}`);
  revalidatePath("/catalogo", "layout");
}

export async function agregarSugerido(_previo: EstadoSugeridos, formData: FormData): Promise<EstadoSugeridos> {
  const productId = String(formData.get("productId") ?? "");
  const r = await (await api()).POST("/api/v1/admin/productos/{id}/sugeridos", {
    params: { path: { id: productId } },
    body: { relatedProductId: String(formData.get("relatedProductId") ?? ""), tipo: String(formData.get("tipo") ?? "") },
  });
  if (r.response.status === 400) return { error: "Elegí un producto de la lista." };
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Elegí un producto de la lista.") };
  refrescar(productId);
  return { ok: r.data.ok };
}

export async function quitarSugerido(_previo: EstadoSugeridos, formData: FormData): Promise<EstadoSugeridos> {
  const productId = String(formData.get("productId") ?? "");
  const r = await (await api()).DELETE("/api/v1/admin/productos/{id}/sugeridos/{relacion}", {
    params: { path: { id: productId, relacion: String(formData.get("id") ?? "") } },
  });
  if (r.response.status === 400) {
    return { error: "No pudimos encontrar ese producto sugerido. Recargá la pantalla y probá de nuevo." };
  }
  if (!r.response.ok) return { error: "Esa relación ya no estaba." };
  refrescar(productId);
  return { ok: "Listo." };
}
