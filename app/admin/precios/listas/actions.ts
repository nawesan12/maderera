"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/* El «general ± N %» de una lista derivada. Lo guarda la API de Go (solo el admin). */

export interface EstadoLista {
  error?: string;
  ok?: string;
}

export async function ajustarPorcentajeDeLista(_previo: EstadoLista, formData: FormData): Promise<EstadoLista> {
  const r = await (await api()).PUT("/api/v1/admin/precios/listas/{id}/porcentaje", {
    params: { path: { id: String(formData.get("id") ?? "") } },
    body: { porcentaje: String(formData.get("porcentaje") ?? "") },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "El porcentaje tiene que estar entre −50 y 50.") };
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/admin/precios/listas");
  return { ok: r.data.ok };
}
