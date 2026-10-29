import "server-only";

import { cache } from "react";
import { apiInterna, apiPublica, datos } from "@/lib/api/servidor";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { listaVigente } from "@/lib/dal/precios-sesion";
import type { PlacaCortable } from "@/lib/cortes/tipos";

/**
 * Las placas que se pueden mandar a cortar desde el sitio: con las dos
 * medidas, precio y tarifa de pasada. Las arma la API de Go
 * (backend/internal/cortes) con el precio de una lista y la tarifa ya
 * resuelta.
 *
 * **Cacheadas por lista de precios**, como el catálogo: la lista viaja en la
 * clave, así que la entrada de un profesional no se le sirve a otro ni al
 * público. Para pedirle a Go los precios de una lista sin la cookie de nadie
 * va el secreto interno (`apiInterna`). Lo que se cobra no sale de acá: al
 * agregar el corte al carrito Go vuelve a buscar la placa con la lista real.
 */
export type { PlacaCortable };

const placasDeLaLista = cachearPublico(
  async (listaId: string | null): Promise<PlacaCortable[]> =>
    listaId
      ? datos(await apiInterna.GET("/api/v1/cortes/placas", { params: { query: { lista: listaId } } }))
      : datos(await apiPublica.GET("/api/v1/cortes/placas", { params: { query: { publico: true } } })),
  ["cortes", "placas"],
  ETIQUETAS.catalogo,
);

/** Las placas con el precio de la lista de quien pide. */
export const placasCortables = cache(async (): Promise<PlacaCortable[]> => {
  const lista = await listaVigente();
  return placasDeLaLista(lista.esDiferenciada ? lista.id : null);
});

/** Las placas a precio de público, las mismas para todo el que entre. */
export const placasCortablesPublicas = cache(async (): Promise<PlacaCortable[]> => placasDeLaLista(null));
