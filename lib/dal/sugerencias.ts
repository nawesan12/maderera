import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  categories,
  inventory,
  priceListItems,
  productVariants,
  products,
} from "@/lib/db/schema";
import { coincideBusqueda } from "@/lib/busqueda";
import { listaVigente } from "@/lib/dal/precios-sesion";

/**
 * Qué producto del catálogo corresponde a cada material que calculó la
 * calculadora.
 *
 * El brief contesta "Cantidades **y sugerencia opcional**" a si el resultado
 * debe sugerir productos. Hasta ahora no sugería nada: la calculadora agregaba
 * al presupuesto una línea de **texto suelto, sin `variantId`**, así que el
 * renglón entraba sin precio, sin stock y sin nada que lo atara al catálogo.
 * Quien armaba un techo con la calculadora terminaba con un presupuesto de
 * cinco renglones y total cero.
 *
 * **Sugerencia y no reemplazo.** Si no hay coincidencia, la línea entra igual
 * como texto: el material existe aunque no esté cargado, y borrarlo del
 * resultado sería peor. La pantalla dice cuál encontró y cuál no.
 */

export interface Sugerencia {
  /** El término con el que se buscó, para poder aparearlo con su renglón. */
  busqueda: string;
  variantId: string;
  descripcion: string;
  unidad: string;
  /** Precio final de la lista que corresponde a quien mira. Null si no tiene. */
  precio: string | null;
  hayStock: boolean;
}

/**
 * Una variante por término, la mejor.
 *
 * "La mejor" es la más barata con stock: en una calculadora de materiales,
 * quien pide "machimbre pino" quiere el machimbre de pino que la maderera
 * tiene hoy, no el más caro de la lista. Sin stock igual se sugiere —se
 * encarga—, pero después.
 */
export async function sugerirDelCatalogo(
  terminos: string[],
): Promise<Sugerencia[]> {
  const unicos = [...new Set(terminos.map((t) => t.trim()).filter(Boolean))];
  if (unicos.length === 0) return [];

  // Request-time y nunca cacheado: el precio depende de la lista de quien
  // mira. Es la misma regla que gobierna el catálogo.
  const lista = await listaVigente();

  const propia = alias(priceListItems, "precio_propio");
  const general = alias(priceListItems, "precio_general");

  const encontradas: Sugerencia[] = [];

  for (const termino of unicos) {
    const porTexto = coincideBusqueda(termino, [
      products.name,
      productVariants.label,
      products.brand,
      categories.name,
    ]);

    if (!porTexto) continue;

    const [fila] = await db
      .select({
        variantId: productVariants.id,
        producto: products.name,
        medida: productVariants.label,
        unidad: products.unit,
        precio: sql<string | null>`coalesce(${propia.price}, ${general.price})`,
        stock: sql<number>`coalesce(sum(${inventory.qty}), 0)`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(
        propia,
        and(
          eq(propia.variantId, productVariants.id),
          lista.id ? eq(propia.priceListId, lista.id) : sql`false`,
        ),
      )
      .leftJoin(
        general,
        and(
          eq(general.variantId, productVariants.id),
          lista.generalId ? eq(general.priceListId, lista.generalId) : sql`false`,
        ),
      )
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(
        and(
          eq(productVariants.active, true),
          eq(products.active, true),
          porTexto,
        ),
      )
      .groupBy(
        productVariants.id,
        products.name,
        productVariants.label,
        products.unit,
        propia.price,
        general.price,
      )
      // Primero lo que tiene stock, después lo más barato. Un material sin
      // precio va al fondo: sugerir algo que dice "a consultar" no ayuda.
      .orderBy(
        sql`case when coalesce(sum(${inventory.qty}), 0) > 0 then 0 else 1 end`,
        sql`case when coalesce(${propia.price}, ${general.price}) is null then 1 else 0 end`,
        asc(sql`coalesce(${propia.price}, ${general.price})`),
      )
      .limit(1);

    if (!fila) continue;

    encontradas.push({
      busqueda: termino,
      variantId: fila.variantId,
      descripcion: fila.medida
        ? `${fila.producto} — ${fila.medida}`
        : fila.producto,
      unidad: fila.unidad,
      precio: fila.precio,
      hayStock: Number(fila.stock) > 0,
    });
  }

  return encontradas;
}
