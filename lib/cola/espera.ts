/**
 * Cuánto esperar antes de reintentar un trabajo que falló.
 *
 * Crece al doble en cada intento —30 s, 1 min, 2, 4…— y se planta en una hora.
 * Es lo que hace que una caída corta (Mercado Pago contestando 503 un par de
 * minutos) se resuelva sola enseguida, y una larga no golpee a la API cada
 * minuto durante horas.
 *
 * Aparte y sin base, para poder probarla.
 */
export const ESPERA_INICIAL_MS = 30_000;
export const ESPERA_MAXIMA_MS = 60 * 60_000;

export function esperaParaElIntento(intentos: number): number {
  const exponente = Math.max(0, intentos - 1);
  return Math.min(ESPERA_INICIAL_MS * 2 ** exponente, ESPERA_MAXIMA_MS);
}
