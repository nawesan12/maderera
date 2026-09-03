/**
 * Lado navegador de `lib/senal-cliente.ts`.
 *
 * Vive aparte porque aquel importa `server-only`: la cookie la escribe el
 * servidor y la lee el navegador, y son dos mundos que no comparten módulo.
 */
export const SENAL_ESTADO = "mjbj_estado";

/** ¿Hay algo que traer? Si no, no se molesta al servidor. */
export function haySenal(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => c.startsWith(`${SENAL_ESTADO}=`));
}
