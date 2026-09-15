/**
 * Lado navegador de `lib/senal-cliente.ts`.
 *
 * Vive aparte porque aquel importa `server-only`: la cookie la escribe el
 * servidor y la lee el navegador, y son dos mundos que no comparten módulo.
 */
export const SENAL_ESTADO = "mjbj_estado";

/**
 * El valor de la señal, o null si no hay.
 *
 * Cambia en cada inicio de sesión, así que sirve de clave para lo que el
 * navegador guarde: si no es el mismo que cuando lo guardó, es de otra sesión
 * y no se usa.
 */
export function valorDeSenal(): string | null {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${SENAL_ESTADO}=`));
  return cookie ? cookie.slice(SENAL_ESTADO.length + 1) : null;
}

/** ¿Hay algo que traer? Si no, no se molesta al servidor. */
export function haySenal(): boolean {
  return valorDeSenal() !== null;
}
