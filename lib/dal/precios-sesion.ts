import "server-only";

import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, priceLists } from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";

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
}

export const listaVigente = cache(async (): Promise<ListaVigente> => {
  const [general] = await db
    .select({ id: priceLists.id, nombre: priceLists.name })
    .from(priceLists)
    .where(and(eq(priceLists.isDefault, true), eq(priceLists.active, true)))
    .limit(1);

  const generalId = general?.id ?? null;
  const sesion = await getSession();

  if (!sesion) {
    return {
      id: generalId,
      generalId,
      nombre: general?.nombre ?? null,
      esDiferenciada: false,
    };
  }

  let elegida = sesion.priceListId;

  if (!elegida) {
    const [ficha] = await db
      .select({ priceListId: customers.priceListId })
      .from(customers)
      .where(and(eq(customers.userId, sesion.userId), eq(customers.active, true)))
      .limit(1);

    elegida = ficha?.priceListId ?? null;
  }

  if (!elegida || elegida === generalId) {
    return {
      id: generalId,
      generalId,
      nombre: general?.nombre ?? null,
      esDiferenciada: false,
    };
  }

  // Una lista dada de baja no se aplica: se cae a la general en vez de dejar el
  // catálogo sin precios.
  const [propia] = await db
    .select({ id: priceLists.id, nombre: priceLists.name })
    .from(priceLists)
    .where(and(eq(priceLists.id, elegida), eq(priceLists.active, true)))
    .limit(1);

  if (!propia) {
    return {
      id: generalId,
      generalId,
      nombre: general?.nombre ?? null,
      esDiferenciada: false,
    };
  }

  return {
    id: propia.id,
    generalId,
    nombre: propia.nombre,
    esDiferenciada: true,
  };
});
