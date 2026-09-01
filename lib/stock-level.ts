/**
 * Los cuatro niveles que ve el público.
 *
 * Vivían en `lib/products.ts` junto al catálogo escrito a mano del prototipo.
 * Ese archivo se borró: el catálogo sale de la base, y el tipo pertenece acá,
 * que es donde está la función que lo calcula.
 */
export type StockLevel = "alto" | "medio" | "bajo" | "sin-stock";

/**
 * Lo que se puede vender: el físico menos lo que ya tiene dueño.
 *
 * El galpón puede tener veinte placas y no haber ninguna para vender si están
 * todas comprometidas en pedidos que no se retiraron. Todo lo que mira el
 * público —niveles de stock, tienda, buscador— tiene que salir de acá y no de
 * `qty`, o se vende mercadería ajena.
 *
 * Nunca da negativo: si el reservado supera al físico —pasa cuando se entregó
 * algo sin cargarlo— el disponible es cero, no un número rojo en la tienda.
 */
export function disponible(qty: number, reservado: number): number {
  return Math.max(qty - reservado, 0);
}

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
