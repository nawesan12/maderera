"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/** Vuelve a poner en la cola un trabajo fallido (Go exige el admin y lo anota). */
export async function reintentarTrabajo(id: string): Promise<{ ok?: string; error?: string }> {
  const r = await (await api()).POST("/api/v1/admin/sistema/trabajos/{id}/reintentar", {
    params: { path: { id } },
  });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo reintentar.") };
  revalidatePath("/admin/sistema");
  return { ok: r.data?.ok ?? "Vuelve a la cola." };
}
