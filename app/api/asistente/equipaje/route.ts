import { NextResponse } from "next/server";
import { cacheLife, cacheTag } from "next/cache";
import { equipajeDelAsistente } from "@/app/(public)/asistente-actions";
import { ETIQUETAS } from "@/lib/cache-publico";

/**
 * Lo que el asistente sabe sin preguntarle a nadie.
 *
 * **Por qué dejó de ser una acción de servidor.** Rubros, sucursales, zonas de
 * envío y formas de pago son **iguales para todo el mundo**: no dependen de la
 * sesión ni de la lista de precios. Como acción viajaba por POST, y un POST no
 * se cachea nunca: cada persona que abría el panel del asistente pagaba una
 * vuelta al servidor. Como GET se arma una vez y se sirve hecho.
 *
 * Lo que **no** se movió acá es la búsqueda de productos: el precio depende de
 * la lista de quien mira, así que cachearla sería servirle a cualquiera el
 * precio de un profesional. Esa sigue siendo una acción, a propósito.
 */
export async function GET() {
  return NextResponse.json(await equipajeCacheado());
}

/**
 * Hecho una vez, y rehecho cuando cambia lo que lleva.
 *
 * Antes quedaba una hora fija en la red de Vercel: un horario corregido en el
 * panel podía tardar una hora en llegar al asistente. Ahora lleva las mismas
 * etiquetas que los datos de los que sale —los rubros son del catálogo; las
 * sucursales y las zonas de envío, de `sucursales`— y el panel, al guardar,
 * invalida la etiqueta: el cambio se ve en el acto. Las formas de pago están
 * escritas en el código y cambian con un despliegue.
 */
async function equipajeCacheado() {
  "use cache";
  cacheLife("max");
  cacheTag(ETIQUETAS.catalogo, ETIQUETAS.sucursales);
  return equipajeDelAsistente();
}
