import "server-only";

import { cache } from "react";
import { db } from "@/lib/db";
import { siteSettings } from "@/lib/db/schema";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";

/**
 * Los textos editables del sitio.
 *
 * Este archivo tenía además el blog y los testimonios. **Los dos salieron el
 * 7/9/2026 por pedido de la clienta**: las seis notas las había escrito el
 * prototipo y los cuatro testimonios eran personas inventadas, ya ocultas. Lo
 * que dice la gente sobre los productos ahora sale de las reseñas de compra
 * verificada (`lib/dal/resenas.ts`), que es la misma información sin el
 * problema de tener que conseguir a alguien que la firme.
 *
 * Lo que queda son los ajustes, y quedan porque los lee todo el sitio: el
 * número de WhatsApp del pie, las leyendas de la barra superior y lo que
 * imprime el ticket del mostrador.
 */

/**
 * Ajustes del sitio, todos juntos.
 *
 * Se traen de una y memoizados por request: son media docena de filas y varias
 * pantallas consultan dos o tres, así que una consulta por ajuste sería
 * gratuito de escribir y caro de correr.
 */
/*
 * Doble memoización a propósito: `cache()` de React evita repetirla dentro de
 * una misma request, y `cachearPublico` la comparte entre visitas. Es la
 * consulta que corre en absolutamente toda página del sitio.
 */
export const ajustesDelSitio = cache(
  cachearPublico(
    async (): Promise<Record<string, string>> => {
      const filas = await db
        .select({ clave: siteSettings.clave, valor: siteSettings.valor })
        .from(siteSettings);

      return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
    },
    ["ajustes-del-sitio"],
    ETIQUETAS.ajustes,
  ),
);

export async function ajuste(clave: string, porDefecto = ""): Promise<string> {
  const ajustes = await ajustesDelSitio();
  return ajustes[clave] || porDefecto;
}
