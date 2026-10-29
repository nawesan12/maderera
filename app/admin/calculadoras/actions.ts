"use server";

import { revalidatePath, updateTag } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { ETIQUETAS } from "@/lib/cache-publico";

/*
 * Los parámetros de las calculadoras. Los valida y guarda la API de Go
 * (backend/internal/cortes), solo para el admin: los porcentajes se escriben
 * como en el brief («un +20 %») y se guardan como fracción.
 */

export interface EstadoCalculadoras {
  error?: string;
  ok?: string;
}

export async function guardarParametros(
  _previo: EstadoCalculadoras,
  formData: FormData,
): Promise<EstadoCalculadoras> {
  const campos: Record<string, string> = {};
  for (const [k, v] of formData) {
    if (!k.startsWith("$") && typeof v === "string") campos[k] = v;
  }
  const r = await (await api()).PUT("/api/v1/admin/calculadoras", { body: campos });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined, "Un campo: revisá los datos.") };

  // La calculadora pública se sirve del CDN: sin invalidar, el cambio no se ve.
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/admin/calculadoras");
  revalidatePath("/calculadora");
  return { ok: "Parámetros guardados. La calculadora ya usa estos números." };
}
