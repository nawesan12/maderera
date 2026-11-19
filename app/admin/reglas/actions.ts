"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

export type ClaveDeRegla =
  | "ganancia_gastos"
  | "ganancia_descuento"
  | "anular_compra_con_pagos"
  | "descuento_sin_autorizacion_pct";

/** Cambia una regla del negocio. Go valida que el valor sea una opción. */
export async function guardarRegla(clave: ClaveDeRegla, valor: string): Promise<{ ok?: string; error?: string }> {
  const r = await (await api()).PUT("/api/v1/admin/contenido/ajustes/{clave}", {
    params: { path: { clave } },
    body: { valor },
  });
  if (r.error) return { error: mensajeDe(r.error as Problema, "No se pudo guardar.") };
  updateTag(ETIQUETAS.ajustes);
  revalidatePath("/admin/reglas");
  revalidatePath("/admin");
  revalidatePath("/admin/cierre");
  revalidatePath("/mostrador");
  return { ok: "Guardado." };
}
