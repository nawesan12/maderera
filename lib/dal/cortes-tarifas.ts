import "server-only";

import { cache } from "react";
import { api, datos } from "@/lib/api/servidor";
import type { TarifaDeCorte } from "@/lib/cortes/tipos";

/**
 * Las tarifas de corte activas, de la API de Go (backend/internal/cortes).
 * Request-time y sin caché: es un precio que el negocio cambia y tiene que
 * valer para el trabajo siguiente.
 */
export const tarifasDeCorte = cache(async (): Promise<TarifaDeCorte[]> =>
  datos(await (await api()).GET("/api/v1/admin/cortes/tarifas/activas")),
);

/** Todas, activas o no, para la pantalla de tarifas (solo el admin). */
export async function todasLasTarifas() {
  const filas = datos(await (await api()).GET("/api/v1/admin/cortes/tarifas"));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt), updatedAt: new Date(f.updatedAt) }));
}
