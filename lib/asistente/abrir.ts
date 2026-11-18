/**
 * Abrir el asistente desde cualquier lado (hallazgo 27 del comité,
 * 18/11/2026).
 *
 * Era un círculo naranja flotante, al lado del WhatsApp, que no decía qué era
 * y tapaba el botón principal de la ficha. Ahora no flota: se abre desde el
 * buscador del catálogo, el menú del celular y la página de «no existe», con
 * el personaje y su nombre a la vista. Ninguno de esos lugares conoce al
 * panel —vive una sola vez, en el layout público—, así que se hablan por un
 * evento del documento y no por un contexto que habría que subir hasta el
 * layout.
 */
export const EVENTO_ABRIR_ASISTENTE = "mjbj:abrir-asistente";

/** Lo que dice cada entrada, igual en todas: quien lo vio una vez lo reconoce. */
export const ETIQUETA_ASISTENTE = "Te ayudo a elegir";

export function abrirAsistente(): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new Event(EVENTO_ABRIR_ASISTENTE));
}
