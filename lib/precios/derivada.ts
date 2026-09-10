/**
 * Listas de precios derivadas por porcentaje.
 *
 * La lista constructora —y cualquier otra que se sume— puede definirse como
 * "la general menos N %", ajustable desde el panel. La cuenta vive acá, sin
 * base de datos, para poder probarla: es un número que multiplica el catálogo
 * entero.
 */

/**
 * El multiplicador de una lista derivada. Acotado a la mitad y el doble del
 * precio general: un porcentaje tipeado con un cero de más no puede publicar
 * el catálogo entero al 10 % de su valor.
 */
export function factorDeLista(
  porcentajeSobreGeneral: string | number | null,
): number {
  const pct = Number(porcentajeSobreGeneral ?? 0);
  if (!Number.isFinite(pct) || pct === 0) return 1;
  return Math.min(Math.max(1 + pct / 100, 0.5), 2);
}
