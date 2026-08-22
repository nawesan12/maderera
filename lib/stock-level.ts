import type { StockLevel } from "@/lib/products";

export type { StockLevel };

/**
 * Traduce una cantidad real a los cuatro niveles que muestra el sitio público.
 *
 * El negocio guarda cantidades; el visitante ve "En stock / Stock limitado / Poco
 * stock / Sin stock". Mostrar el número exacto expondría información comercial
 * (cuánto compró el cliente, cuánto le queda a la competencia por vender).
 *
 * El umbral de reposición (`minQty`) lo define cada sucursal por producto: 3 placas
 * de fenólico pueden ser "poco" y 3 rollos de membrana pueden ser "de sobra".
 */
export function stockLevel(qty: number, minQty: number): StockLevel {
  if (qty <= 0) return "sin-stock";
  if (minQty <= 0) return qty > 0 ? "alto" : "sin-stock";
  if (qty <= minQty) return "bajo";
  if (qty <= minQty * 3) return "medio";
  return "alto";
}

/** Nivel combinado entre sucursales, para las tarjetas que no discriminan por local. */
export function combinedStockLevel(
  levels: readonly StockLevel[],
): StockLevel {
  const order: StockLevel[] = ["alto", "medio", "bajo", "sin-stock"];
  for (const level of order) {
    if (levels.includes(level)) return level;
  }
  return "sin-stock";
}
