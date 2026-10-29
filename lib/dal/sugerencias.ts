import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Qué producto del catálogo corresponde a cada material que calculó la
 * calculadora: por término, la variante más barata con stock, con el precio
 * de la lista de quien mira. Lo resuelve la API de Go
 * (backend/internal/cortes). Sugerencia y no reemplazo: si no hay
 * coincidencia, el renglón entra igual como texto.
 */
export interface Sugerencia {
  busqueda: string;
  variantId: string;
  descripcion: string;
  unidad: string;
  precio: string | null;
  hayStock: boolean;
}

export async function sugerirDelCatalogo(terminos: string[]): Promise<Sugerencia[]> {
  if (terminos.length === 0) return [];
  return datos(
    await (await api()).POST("/api/v1/calculadora/sugerencias", {
      body: { terminos: terminos.slice(0, 50).map((t) => t.slice(0, 200)) },
    }),
  );
}
