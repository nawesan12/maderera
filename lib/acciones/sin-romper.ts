/**
 * Una acción del servidor que no rompe la página si falla.
 *
 * Si la llamada a la acción se corta (sin conexión, un 500 de Next), React
 * tira el error al límite más cercano y la página entera pasa a «Se nos rompió
 * algo»: el cliente perdía el importe y el archivo que había cargado (mes
 * simulado, tercera prueba). Envuelta, la falla vuelve como un error más del
 * formulario y lo cargado queda en su lugar.
 *
 * No envolver una acción que hace `redirect()`.
 */
export const ERROR_DE_RED = "No pudimos mandarlo. Revisá la conexión y probá de nuevo.";

export function sinRomper<E extends { error?: string; ok?: string }>(
  accion: (previo: E, datos: FormData) => Promise<E>,
): (previo: E, datos: FormData) => Promise<E> {
  return async (previo, datos) => {
    try {
      return await accion(previo, datos);
    } catch {
      return { ...previo, ok: undefined, error: ERROR_DE_RED };
    }
  };
}
