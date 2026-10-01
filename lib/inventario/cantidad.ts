import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { productVariants, products } from "@/lib/db/schema";
import { admiteDecimales, formatearUnidadLarga } from "@/lib/unidades";

type Lector = Pick<typeof db, "select">;

/**
 * Si una cantidad de stock tiene sentido para la variante.
 *
 * Los metros, los m², los kilos y las placas (por las medias) admiten
 * decimales; lo que se cuenta, no. Un ajuste de 2,5 bisagras no es un dato:
 * es un error de tipeo que después nadie encuentra contando.
 *
 * Devuelve el motivo listo para mostrar, o `null` si está bien.
 */
export async function revisarCantidadDeStock(
  lector: Lector,
  variantId: string,
  cantidad: number,
): Promise<string | null> {
  if (!Number.isFinite(cantidad)) return "La cantidad tiene que ser un número.";

  const [fila] = await lector
    .select({ unit: products.unit })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, variantId))
    .limit(1);

  if (!fila) return "No se encontró el producto.";

  if (!admiteDecimales(fila.unit) && !Number.isInteger(cantidad)) {
    return `Este producto se cuenta por ${formatearUnidadLarga(fila.unit)}: la cantidad va sin decimales.`;
  }
  return null;
}
