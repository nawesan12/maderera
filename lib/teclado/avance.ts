/**
 * Enter pasa al campo siguiente.
 *
 * Lo pidió la clienta: «manejar todo con el teclado, cosa de pasar por los
 * inputs con el enter». En una pantalla de carga —un gasto, una factura, un
 * despiece— la mano no debería salir del teclado: Tab existe, pero nadie lo usa
 * cuando viene de un sistema donde Enter avanzaba, y menos con gente esperando
 * del otro lado del mostrador.
 *
 * Acá vive la decisión, que es lo que se puede probar sin un navegador: **qué
 * campos avanzan con Enter y cuál es el siguiente**. El enganche con el DOM está
 * en `components/admin/enter-avanza.tsx`.
 */

/**
 * Los campos por los que Enter pasa de largo.
 *
 * - En un `textarea`, Enter escribe un renglón. Es el único lugar donde la
 *   tecla ya significa otra cosa y esa otra cosa es irremplazable.
 * - En un botón, Enter lo aprieta.
 * - En una casilla o un radio, Enter envía el formulario —comportamiento del
 *   navegador— y eso es lo que espera quien ya marcó lo que tenía que marcar.
 * - En un `select`, Enter elige la opción.
 */
const TIPOS_QUE_NO_AVANZAN = new Set([
  "submit",
  "button",
  "reset",
  "checkbox",
  "radio",
  "file",
  "image",
]);

export function avanzaConEnter(campo: {
  etiqueta: string;
  tipo?: string | null;
  /** `data-enter="enviar"` deja el Enter como estaba en ese campo. */
  comportamiento?: string | null;
}): boolean {
  if (campo.comportamiento === "enviar") return false;

  const etiqueta = campo.etiqueta.toLowerCase();

  if (etiqueta !== "input") return false;

  return !TIPOS_QUE_NO_AVANZAN.has((campo.tipo ?? "text").toLowerCase());
}

/**
 * Cuál es el campo siguiente.
 *
 * Devuelve `null` en el último a propósito: ahí Enter tiene que enviar el
 * formulario, que es lo que quien carga espera después del último dato. Un
 * avance circular —volver al primero— dejaría el formulario sin forma de
 * enviarse con el teclado.
 */
export function siguienteCampo<T>(campos: T[], actual: T): T | null {
  const i = campos.indexOf(actual);
  if (i === -1) return null;
  return campos[i + 1] ?? null;
}
