import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { listaVigente } from "@/lib/dal/precios-sesion";
import { placasCortables } from "@/lib/dal/cortes-publico";

/**
 * Las placas con el precio del profesional, para el armador de cortes.
 *
 * Es el hermano de `/api/mis-precios` y existe por lo mismo: la pantalla de
 * corte se sirve de la caché a precio de público —un solo HTML para todo el
 * mundo, sin armarla en cada visita— y quien tiene lista propia recibe por acá
 * lo suyo y el navegador cambia los números.
 *
 * **Va aparte y no adentro de `/api/mis-precios` a propósito.** Ese se pide en
 * cada pantalla del sitio; esto solo hace falta en `/corte`, que es una entre
 * muchas. Meterlo ahí sería cobrarle la consulta de las placas a todas las
 * visitas de un profesional para que la use una de cada veinte.
 *
 * Las dos reglas de siempre: la lista sale de la cookie del lado del servidor,
 * nunca de la URL; y sin lista diferenciada no se devuelve nada, porque no hay
 * nada distinto que contar.
 */
export async function GET() {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ placas: {} });

  const lista = await listaVigente();

  if (!lista.esDiferenciada) {
    return NextResponse.json(
      { placas: {} },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const placas = await placasCortables();

  /*
   * El precio de la placa **y su tarifa de corte**.
   *
   * La tarifa —cuánto sale la pasada de sierra y el metro de tapacanto— también
   * depende de la lista, así que corregir solo el precio de la placa dejaría el
   * presupuesto a medias: el material con el precio del profesional y el corte
   * con el de público.
   */
  const porVariante: Record<
    string,
    { precio: number; precioPorPasada: number; precioPorMetroCanto: number }
  > = {};

  for (const p of placas) {
    porVariante[p.variantId] = {
      precio: p.precio,
      precioPorPasada: p.precioPorPasada,
      precioPorMetroCanto: p.precioPorMetroCanto,
    };
  }

  return NextResponse.json(
    { lista: lista.nombre, placas: porVariante },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
