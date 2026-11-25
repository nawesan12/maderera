"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Prender, apagar y cambiar el texto de un aviso por correo. Lo hace la API
 * de Go (backend/internal/avisos), con la validación de antes.
 */

export interface EstadoAvisoEmail {
  error?: string;
  ok?: string;
}

function resultado(r: { data?: { ok: string }; error?: unknown }): EstadoAvisoEmail {
  return r.data ? { ok: r.data.ok } : { error: mensajeDe(r.error as Problema | undefined, "Revisá el texto.") };
}

/** Prende o apaga un aviso por correo. */
export async function cambiarAvisoEmail(_previo: EstadoAvisoEmail, formData: FormData): Promise<EstadoAvisoEmail> {
  const r = await (await api()).PUT("/api/v1/admin/avisos/activo", {
    body: { id: formData.get("id"), activo: formData.get("activo") },
  });
  if (r.data) revalidatePath("/admin/avisos");
  return resultado(r);
}

/** Cambia el asunto y el encabezado de un aviso. */
export async function guardarTextoAvisoEmail(_previo: EstadoAvisoEmail, formData: FormData): Promise<EstadoAvisoEmail> {
  const r = await (await api()).PUT("/api/v1/admin/avisos/texto", {
    body: { id: formData.get("id"), asunto: formData.get("asunto"), encabezado: formData.get("encabezado") },
  });
  if (r.data) revalidatePath("/admin/avisos");
  return resultado(r);
}
