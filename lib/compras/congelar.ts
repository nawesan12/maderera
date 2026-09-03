import "server-only";

import { eq, inArray } from "drizzle-orm";
import { productVariants, products, variantCosts } from "@/lib/db/schema";

type Consultador = {
  select: typeof import("@/lib/db").db.select;
};

/**
 * El costo y la alícuota de cada variante, para congelarlos en la venta.
 *
 * **Se congelan a propósito.** El costo promedio se recalcula con cada
 * recepción: leer el de hoy para una venta de marzo reescribiría el margen de
 * marzo cada vez que llega un camión, y el reporte de márgenes dejaría de ser
 * comparable consigo mismo de un día para el otro. Es el mismo criterio con el
 * que ya se guarda el precio en la línea.
 *
 * Una sola consulta para todas las variantes de la venta: llamarla por línea
 * sería el N+1 dentro de la transacción que menos conviene tenerlo, porque
 * mientras corre están tomados los locks de stock.
 */
export interface CostoCongelado {
  costoUnitario: string | null;
  alicuotaIva: string;
}

export async function costosParaCongelar(
  tx: Consultador,
  variantIds: string[],
): Promise<Map<string, CostoCongelado>> {
  const mapa = new Map<string, CostoCongelado>();
  const unicos = [...new Set(variantIds)];
  if (unicos.length === 0) return mapa;

  const filas = await tx
    .select({
      variantId: productVariants.id,
      alicuotaIva: products.alicuotaIva,
      costoPromedio: variantCosts.costoPromedio,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(variantCosts, eq(variantCosts.variantId, productVariants.id))
    .where(inArray(productVariants.id, unicos));

  for (const fila of filas) {
    mapa.set(fila.variantId, {
      /*
       * Sin fila de costo el valor queda en `null` y no en cero.
       *
       * Cero diría "esto no costó nada" y el margen saldría del 100 %. `null`
       * dice "no se sabe", que es la verdad para todo lo anterior al módulo de
       * compras, y la pantalla de márgenes cuenta esas líneas aparte en vez de
       * promediarlas con las demás.
       */
      costoUnitario: fila.costoPromedio,
      alicuotaIva: fila.alicuotaIva,
    });
  }

  return mapa;
}
