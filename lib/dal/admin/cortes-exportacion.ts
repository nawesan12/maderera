import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Los formatos de la lista de piezas para el optimizador. Los guarda y los
 * aplica la API de Go (backend/internal/cortes); el archivo lo sirve Go en
 * /api/cortes/[id]/lista, la dirección de siempre del agente del taller.
 */
export async function listarPerfiles() {
  const filas = datos(await (await api()).GET("/api/v1/admin/cortes/perfiles"));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt), updatedAt: new Date(f.updatedAt) }));
}

export type PerfilGuardado = Awaited<ReturnType<typeof listarPerfiles>>[number];
