import "server-only";

import { cache } from "react";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { api, apiPublica, datos } from "@/lib/api/servidor";

/**
 * Qué lista de precios corresponde a quien está mirando.
 *
 * Hasta ahora el catálogo consultaba siempre la lista general, así que la lista
 * profesional existía en el modelo y no se veía en ningún lado. Acá se resuelve,
 * en un solo lugar y con un orden de prioridad explícito:
 *
 * 1. La lista asignada al perfil (`profiles.priceListId`), que es la excepción
 *    que un vendedor carga a mano.
 * 2. La de la ficha de cliente (`customers.priceListId`), que es el caso normal
 *    de un profesional aprobado.
 * 3. La general.
 *
 * **Dos reglas que no se pueden relajar:**
 *
 * - Esto es request-time y nunca va bajo `use cache`. Un precio profesional
 *   cacheado y servido al público es exactamente el peor error posible de este
 *   módulo: precios mayoristas expuestos a cualquiera.
 * - El precio de la lista profesional **cae a la general cuando falta**. Una
 *   lista alternativa rara vez tiene todos los productos cargados, y un catálogo
 *   que muestra la mitad de los artículos "sin precio" a un profesional es peor
 *   que mostrarle el precio de público.
 */

export interface ListaVigente {
  /** Lista a aplicar. Null solo si no hay ninguna lista cargada. */
  id: string | null;
  /** Lista general, siempre, para el respaldo de los productos sin precio propio. */
  generalId: string | null;
  nombre: string | null;
  /** Verdadero cuando no es la general: la pantalla lo puede decir. */
  esDiferenciada: boolean;
  /**
   * Multiplicador sobre el precio general cuando la lista es derivada
   * (`porcentajeSobreGeneral`): −5 % da 0,95. Uno para las listas comunes.
   *
   * Con esto el respaldo tiene tres escalones: ítem propio de la lista →
   * general por este factor → general tal cual (factor 1). Las consultas lo
   * aplican dentro del `coalesce`, así que un factor 1 deja todo como estaba.
   */
  factorDerivado: number;
}

/**
 * Cuál es la lista general.
 *
 * **Esto sí se cachea, y es la única parte de este módulo que puede.** No
 * depende de quién mira: la lista general es la misma para todo el mundo y es
 * justamente la pública. Lo que no se puede cachear —y sigue sin cacharse— es
 * *qué lista le toca a esta persona*, que es lo que sale abajo del perfil y de
 * la ficha de cliente.
 *
 * Importa porque era la última consulta que quedaba por visita en el sitio
 * público: el resto de la portada ya se servía de datos cacheados y esta sola
 * obligaba a ir a la base en cada carga, para leer siempre la misma fila.
 */
export const listaGeneral = cachearPublico(
  async (): Promise<{ id: string; nombre: string } | null> => {
    // Sin la cookie: lo que contesta es la lista general.
    const { lista } = datos(await apiPublica.GET("/api/v1/catalogo/lista"));
    return lista.id ? { id: lista.id, nombre: lista.nombre ?? "" } : null;
  },
  ["lista-de-precios-general"],
  ETIQUETAS.catalogo,
);

/**
 * La lista y la vista de quien mira, de una sola vez por pedido. Las resuelve
 * la API de Go (backend/internal/catalogo/lista.go) con el orden de arriba.
 */
const listaYVista = cache(async () => datos(await (await api()).GET("/api/v1/catalogo/lista")));

export const listaVigente = cache(async (): Promise<ListaVigente> => (await listaYVista()).lista);

/* -------------------------------------------------------------------------- */
/* Con IVA o sin IVA                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Cómo se muestra el precio en la vitrina.
 *
 * - `final`: el número grande es lo que se paga, con el IVA adentro. Es lo que
 *   ve el público, y lo que la ley 27.743 obliga a mostrar al consumidor final
 *   junto con el neto en letra chica.
 * - `neto`: el número grande es el precio sin IVA, con "+ IVA" al lado y el
 *   final en letra chica debajo.
 *
 * Sale del brief: "¿Los precios se muestran con IVA? — **Ambos, según tipo de
 * cliente**". Un responsable inscripto compara precios netos porque el IVA se
 * lo computa, y leer el final lo obliga a dividir por 1,21 en cada renglón. Un
 * consumidor final quiere saber cuánto paga.
 *
 * **Los precios guardados no cambian**: siguen siendo finales, con IVA
 * incluido, y siguen siendo lo que se cobra. Esto es solo cómo se presentan.
 * Confundir las dos cosas sería el peor error posible acá: facturar sobre un
 * neto mostrado en pantalla haría que cada venta a un profesional saliera un
 * 21 % barata.
 */
export type VistaDePrecio = "final" | "neto";

export const vistaDePrecio = cache(async (): Promise<VistaDePrecio> => (await listaYVista()).vista);
