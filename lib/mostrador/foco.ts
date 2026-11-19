/**
 * A dónde vuelve el cursor después de cada cosa que se hace en el mostrador.
 *
 * El vendedor escanea sin mirar la pantalla: si después de cerrar el corte, la
 * carga a mano, la caja o «Vaciar» el foco queda en un botón —o en ninguna
 * parte—, el próximo código que pasa la pistola se pierde (crítica del
 * operario, T4). La regla es una sola y está acá, con su prueba, para que cada
 * diálogo no la decida por su cuenta.
 */

export type DespuesDe =
  | "corte"
  | "corte-agregado"
  | "a-mano"
  | "caja"
  | "caja-para-cobrar"
  | "vaciar"
  | "no-vaciar";

export type CampoDeVuelta = "buscador" | "recibido";

export function focoDespuesDe(
  que: DespuesDe,
  venta: { medio: string; partido: boolean },
): CampoDeVuelta {
  /*
   * La caja abierta desde el cobro vuelve al cobro, pero **al campo de con
   * cuánto paga y no al botón**: un doble clic o dos Ctrl+Enter seguidos
   * abrían la caja con el primero y cobraban con el segundo, sin haber
   * cargado la plata (crítica de QA).
   */
  if (que === "caja-para-cobrar" && venta.medio === "efectivo" && !venta.partido) {
    return "recibido";
  }
  return "buscador";
}
