"use server";

import { revalidatePath } from "next/cache";
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
