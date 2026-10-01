import "server-only";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { productVariants, products } from "@/lib/db/schema";
import {
  admiteMedia,
  esPresentacion,
  factorDeStock,
  type Presentacion,
  type ProductoQueSeVende,
} from "@/lib/ventas/forma-de-venta";

type Lector = Pick<typeof db, "select">;

/** Lo mínimo de una línea para saber cuánto stock descuenta. */
export interface LineaConPresentacion {
  variantId: string | null;
  presentacion?: string | null;
}

export interface FactorDeLinea {
  /** La presentación validada: una media sobre una placa que no la admite se descarta. */
  presentacion: Presentacion;
  stockPorUnidad: number;
}

/**
 * El factor de stock de cada línea, leído del producto y no del navegador.
 *
 * La presentación llega de quien vende —el mostrador, el carrito—, pero lo
 * que vale una media placa en stock lo decide el producto. Si el navegador
 * manda `media_largo` sobre un fenólico que solo se vende entero, la
 * presentación se descarta y la línea descuenta una placa: nadie puede
 * fabricar medias placas mandando un campo de más.
 *
 * Devuelve un arreglo en el mismo orden que las líneas.
 */
export async function factoresDeStock(
  lector: Lector,
  lineas: LineaConPresentacion[],
): Promise<FactorDeLinea[]> {
  const ids = [
    ...new Set(lineas.map((l) => l.variantId).filter((v): v is string => Boolean(v))),
  ];

  const filas = ids.length
    ? await lector
        .select({
          id: productVariants.id,
          largoMm: productVariants.largoMm,
          anchoMm: productVariants.anchoMm,
          unit: products.unit,
          formaDeVenta: products.formaDeVenta,
          precioMediaPct: products.precioMediaPct,
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(inArray(productVariants.id, ids))
    : [];

  const porVariante = new Map<string, ProductoQueSeVende>(
    filas.map((f) => [f.id, f]),
  );

  return lineas.map((linea) => {
    const producto = linea.variantId ? porVariante.get(linea.variantId) : undefined;
    if (!producto) return { presentacion: null, stockPorUnidad: 1 };

    const presentacion =
      esPresentacion(linea.presentacion) && admiteMedia(producto)
        ? linea.presentacion
        : null;

    return { presentacion, stockPorUnidad: factorDeStock(producto, presentacion) };
  });
}
