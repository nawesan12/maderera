"use server";

import { apiPublica, mensajeDe, type Problema } from "@/lib/api/servidor";

/**
 * La baja desde la página: el mismo enlace firmado, confirmado con un botón.
 * La verifica y la anota la API de Go (backend/internal/campanas).
 */
export async function confirmarBaja(e: string, t: string, recibir: boolean): Promise<{ ok?: true; error?: string }> {
  const r = await apiPublica.POST("/api/v1/bajas", { body: { e, t, recibir } });
  return r.data ? { ok: true } : { error: mensajeDe(r.error as Problema | undefined, "El enlace no es válido.") };
}
