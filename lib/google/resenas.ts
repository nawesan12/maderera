import "server-only";

import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { api, apiPublica, datos } from "@/lib/api/servidor";

/**
 * Las reseñas del negocio: las de Google y las que se cargan a mano, que la
 * portada muestra junto al promedio.
 *
 * Las sirve la API de Go (backend/internal/contenido/negocio.go). Las de
 * Google las trae el worker de Go una vez por semana (tarea
 * «resenas-google») o el botón del panel, y entran sin publicar: alguien las
 * revisa antes de mostrarlas.
 */

export interface ResenaDelNegocio {
  id: string;
  autor: string;
  estrellas: number;
  texto: string;
  fecha: Date;
  origen: "manual" | "google";
  fotoUrl: string | null;
}

const publicadas = cachearPublico(
  async () => datos(await apiPublica.GET("/api/v1/contenido/negocio/resenas")),
  ["resenas-del-negocio"],
  ETIQUETAS.contenido,
);

/** Las publicadas, hasta 12. */
export async function resenasDelNegocio(): Promise<ResenaDelNegocio[]> {
  return (await publicadas()).map((r) => ({ ...r, fecha: new Date(r.fecha) }));
}

/** El promedio (con un decimal) y cuántas hay publicadas, o null si ninguna. */
export const resumenDelNegocio = cachearPublico(
  async (): Promise<{ promedio: number; cuantas: number } | null> =>
    datos(await apiPublica.GET("/api/v1/contenido/negocio/resumen")) ?? null,
  ["resumen-resenas-negocio"],
  ETIQUETAS.contenido,
);

/** Todas, para el panel. */
export async function listarResenasDelNegocio() {
  const filas = datos(await (await api()).GET("/api/v1/admin/contenido/negocio"));
  return filas.map((r) => ({
    ...r,
    fecha: new Date(r.fecha),
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  }));
}
