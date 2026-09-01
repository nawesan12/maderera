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

/** Cinco minutos: lo que se tolera ver desactualizado si falla la invalidación. */
const RED_DE_SEGURIDAD = 300;

export const ETIQUETAS = {
  ajustes: "ajustes-del-sitio",
  sucursales: "sucursales",
  catalogo: "catalogo",
  contenido: "contenido",
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
