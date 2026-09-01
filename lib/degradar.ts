import "server-only";

/**
 * Ejecuta algo que el encabezado necesita, pero sin lo cual el sitio todavía
 * sirve.
 *
 * Está para los layouts. Un error dentro de un layout **no** lo captura el
 * `error.tsx` de su propio nivel: sube, y termina en `global-error.tsx`, que
 * reemplaza el documento entero y queda sin marca, sin menú y sin forma de
 * volver. Se comprobó apagando la base: todas las rutas del sitio y del panel
 * caían en esa pantalla pelada, así que las dos pantallas de error cuidadas no
 * se veían nunca.
 *
 * Con esto, si falla el teléfono de la barra o el contador del presupuesto, el
 * encabezado se dibuja igual y el error queda contenido en la página, que sí
 * tiene su pantalla propia.
 *
 * **No sirve para nada que decida acceso.** Envolver la comprobación que deja
 * entrar a alguien convertiría una falla de base en un permiso concedido. En el
 * layout público la sesión sí va envuelta, pero porque ahí no decide nada: solo
 * pone el nombre en el menú, y el respaldo —sin sesión— muestra de menos. Quién
 * puede ver qué lo resuelve cada página con su propio control.
 *
 * @param que  Nombre corto para el registro del servidor.
 * @param leer Lo que se intenta.
 * @param porDefecto Con qué seguir si falla.
 */
export async function degradar<T>(
  que: string,
  leer: () => Promise<T>,
  porDefecto: T,
): Promise<T> {
  try {
    return await leer();
  } catch (error) {
    // Al registro del servidor y no a la pantalla: al visitante no le sirve, y
    // el mensaje de un error de base puede nombrar tablas y columnas.
    console.error(`[degradado] no se pudo leer ${que}:`, error);
    return porDefecto;
  }
}
