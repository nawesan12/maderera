import { parsearImporte } from "@/lib/formato";

/**
 * El arqueo, en palabras.
 *
 * Vive fuera de `lib/mostrador/caja.ts` porque ese módulo es `server-only` —lee
 * la base— y esto lo necesita el panel de caja del mostrador, que corre en el
 * navegador y muestra la diferencia mientras se cuenta el efectivo.
 */

/**
 * Hasta cuánto se considera que el arqueo cerró.
 *
 * Un peso. No es una tolerancia contable: es el redondeo de una venta con
 * centavos. Cualquier diferencia mayor es plata que faltó o sobró, y hay que
 * explicarla al cerrar —que es el único momento en que alguien se acuerda de
 * por qué fue—.
 */
export const TOLERANCIA_ARQUEO = 1;

/** Cómo se llama una diferencia de arqueo, con el nombre que usa el mostrador. */
export function nombreDeLaDiferencia(
  diferencia: number,
): "sin diferencia" | "faltante" | "sobrante" {
  if (Math.abs(diferencia) <= TOLERANCIA_ARQUEO) return "sin diferencia";
  return diferencia > 0 ? "sobrante" : "faltante";
}

/**
 * Lo tipeado en un campo de plata de la caja: el fondo, un ingreso o retiro,
 * el efectivo contado. `null` si no se puede leer o es negativo.
 *
 * Los campos eran `type="number"` y se leían con `Number()`: «15.000», como se
 * escribe acá, quedaba en $15 (comité final, M13). Se lee con la regla de los
 * cobros (`parsearImporte`): el punto con tres cifras atrás es de miles.
 */
export function importeDeCaja(texto: string): number | null {
  const n = parsearImporte(texto);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
