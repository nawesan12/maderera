import type { VarianteForm } from "./formulario";

/**
 * El stock de una medida como lo da la ficha de Go (una entrada por sucursal
 * activa) a la forma de la pantalla (por id de sucursal).
 *
 * Va aparte del formulario porque lo llaman las páginas, que son del
 * servidor: una función exportada de un archivo "use client" no se puede
 * ejecutar ahí.
 */
export function stocksDeFicha(
  stocks: { sucursal: string; stock: number; minimo: number }[],
): VarianteForm["stocks"] {
  return Object.fromEntries(stocks.map((s) => [s.sucursal, { stock: s.stock, minimo: s.minimo }]));
}
