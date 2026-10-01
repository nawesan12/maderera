/**
 * El ancho de la sierra: lo que se lleva el disco en cada pasada.
 *
 * De la clienta (30/9/2026): «hacer que los 5 mm que saca la máquina por corte
 * sean editables». Ya se podía cambiar el valor general, pero entero y para
 * todo el sistema; ahora cada trabajo guarda el suyo, con un decimal, porque
 * un disco de 3,2 mm redondeado a 3 promete piezas que no entran.
 *
 * Lógica pura: la usan el mostrador, el panel, el sitio y los tests.
 */

/** Entre medio milímetro y un centímetro: fuera de eso es un error de tipeo. */
export const SIERRA_MINIMA_MM = 0.5;
export const SIERRA_MAXIMA_MM = 10;

/** Lee lo tipeado («3,2», «3.2», «5») y lo redondea a un decimal. */
export function leerAnchoDeSierra(texto: string | number | null | undefined): number | null {
  if (texto === null || texto === undefined || texto === "") return null;
  const n = typeof texto === "number" ? texto : Number(String(texto).trim().replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const redondeado = Math.round(n * 10) / 10;
  if (redondeado < SIERRA_MINIMA_MM || redondeado > SIERRA_MAXIMA_MM) return null;
  return redondeado;
}

/** «3,2 mm», «5 mm». */
export function formatearSierra(mm: number): string {
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(mm)} mm`;
}
