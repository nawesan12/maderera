import "server-only";

import { apiPublica, datos } from "@/lib/api/servidor";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import type { ParametrosDeCalculo } from "@/lib/cortes/tipos";

/**
 * Los parámetros con los que calculan las calculadoras y el disco con que
 * nacen los cortes. Los lee la API de Go (backend/internal/cortes): si no hay
 * fila cargada, devuelve los del brief. Se editan en /admin/calculadoras.
 */
export const parametrosDeCalculo = cachearPublico(
  async (): Promise<ParametrosDeCalculo> => datos(await apiPublica.GET("/api/v1/calculadora/parametros")),
  ["calculadora", "parametros"],
  ETIQUETAS.catalogo,
);
