"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Las tarifas de corte. Las valida y guarda la API de Go
 * (backend/internal/cortes), solo para el admin: el precio se lee con
 * parsearImporte («1.200» son mil doscientos) y queda en la bitácora.
 */

export interface EstadoTarifa {
  error?: string;
  ok?: string;
}

export async function guardarTarifaDeCorte(_previo: EstadoTarifa, formData: FormData): Promise<EstadoTarifa> {
  const texto = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };
  const r = await (await api()).POST("/api/v1/admin/cortes/tarifas", {
    body: {
      ...(texto("id") ? { id: texto("id") } : {}),
      material: texto("material"),
      ...(texto("priceListId") ? { priceListId: texto("priceListId") } : {}),
      precioPorPasada: texto("precioPorPasada"),
      precioPorMetroCanto: texto("precioPorMetroCanto"),
      activo: formData.get("activo") === "on",
    },
  });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  revalidatePath("/admin/cortes/tarifas");
  return { ok: "Tarifa guardada." };
}

/** El ancho de sierra con que nacen los cortes (ver `lib/dal/sierra.ts`). */
export async function guardarSierra(_previo: EstadoTarifa, formData: FormData): Promise<EstadoTarifa> {
  const mm = Number(String(formData.get("anchoSierraMm") ?? "").replace(",", "."));
  const r = await (await api()).PUT("/api/v1/admin/cortes/sierra", { body: { anchoSierraMm: mm } });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined, "Revisá el ancho.") };
  // El cortador del sitio la lee de la caché del catálogo.
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/admin/cortes/tarifas");
  return { ok: "Guardado." };
}
