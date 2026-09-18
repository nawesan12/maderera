import "server-only";
import { unstable_cache } from "next/cache";

/**
 * Caché de contenido público, compartido entre visitas.
 *
 * Todas las rutas de este sitio son dinámicas y no por capricho: el layout lee
 * la sesión y el presupuesto para el menú, así que cada carga se arma de nuevo.
 * Eso está bien —el menú tiene que decir el nombre de quien entró— pero
 * arrastraba consigo consultas que no dependen de nadie: los datos del negocio,
 * las sucursales, las categorías, los testimonios.
 *
 * `unstable_cache` guarda **el resultado de la consulta**, no la página, así que
 * funciona igual en una ruta dinámica. La página se sigue armando por visita;
 * lo que deja de repetirse es el viaje a la base.
 *
 * **Cada entrada tiene etiqueta y vencimiento.** La etiqueta la invalida el
 * panel cuando alguien edita —es lo que hace que un cambio se vea al instante—
 * y el vencimiento es la red de seguridad: si algún día se agrega una pantalla
 * de edición y nadie se acuerda de invalidar, el sitio se corrige solo en cinco
 * minutos en vez de mostrar algo viejo para siempre.
 *
 * **Nada que dependa de quién mira puede pasar por acá.** Precios de lista,
 * carrito, sesión y cuenta corriente quedan afuera a propósito: este caché se
 * comparte entre todas las visitas, y meter ahí un precio de profesional sería
 * mostrárselo al público.
 */

/**
 * **Lo que entra y sale de acá viaja como JSON.** Un `Date` guardado vuelve
 * convertido en texto, y el `Date` del tipo es una mentira que TypeScript no
 * puede ver: compila igual y explota al llamar `.toISOString()` o `.getTime()`
 * sobre lo que ya es un string. Cada función que cachee fechas tiene que
 * volver a armarlas al salir; hay ejemplos en `contenido.ts` y `profesionales.ts`.
 */

/**
 * Un día. Es una red de seguridad, no el mecanismo de actualización.
 *
 * Lo que mantiene el sitio al día es la **invalidación por etiqueta**: las
 * acciones del panel avisan qué cambió y el contenido nuevo se ve enseguida.
 * Este número es para el caso que no debería pasar —una pantalla de edición
 * nueva que se olvide de invalidar—, y entonces el sitio se corrige solo en un
 * día en lugar de mostrar algo viejo para siempre.
 *
 * **Estaba en cinco minutos y eso costaba plata todos los días.** El vencimiento
 * de una entrada de caché le pisa el de la página que la usa: Next se queda con
 * el más corto de los dos. La portada declara treinta días y quedaba en cinco
 * minutos igual, o sea unos 288 rearmados diarios —por ruta y por región— de
 * páginas que nadie tocó. Cada uno de esos rearmados es tiempo de CPU que se
 * factura.
 */
const RED_DE_SEGURIDAD = 86_400;

export const ETIQUETAS = {
  ajustes: "ajustes-del-sitio",
  sucursales: "sucursales",
  catalogo: "catalogo",
  contenido: "contenido",
  eventos: "eventos",
} as const;

export function cachearPublico<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  clave: string[],
  etiqueta: string,
): (...args: A) => Promise<R> {
  return unstable_cache(fn, clave, {
    tags: [etiqueta],
    revalidate: RED_DE_SEGURIDAD,
  });
}
