import "server-only";

import { apiPublica, datos } from "@/lib/api/servidor";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";

/**
 * El ancho de sierra con que nace cada corte, en milímetros. Vive en la fila
 * de parámetros que usaban las calculadoras (ver
 * `backend/internal/cortes/parametros.go`) y se edita en /admin/cortes/tarifas.
 * Sin fila cargada, Go devuelve el del brief.
 */
export const anchoDeSierra = cachearPublico(
  async (): Promise<number> => datos(await apiPublica.GET("/api/v1/calculadora/parametros")).anchoSierraMm,
  ["sierra"],
  ETIQUETAS.catalogo,
);
