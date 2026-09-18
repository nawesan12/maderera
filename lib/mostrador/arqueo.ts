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
