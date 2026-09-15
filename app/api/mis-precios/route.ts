import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { listaVigente } from "@/lib/dal/precios-sesion";
import { listarProductos } from "@/lib/dal/catalog";
import { vistaDePrecio } from "@/lib/dal/precios-sesion";

/**
 * Los precios de quien pide, para las páginas que se sirven estáticas.
 *
 * La portada y el catálogo salen del CDN con **precio de público**, porque leer
 * la sesión en el servidor obliga a rearmar la página en cada visita. Quien
 * tiene lista propia la recibe por acá y el navegador cambia los números en el
 * lugar. Ver `PreciosPropios`.
 *
 * **Las dos reglas que sostienen esto:**
 *
 * 1. La lista sale de `listaVigente()`, que la resuelve del lado del servidor
 *    con la cookie de sesión. Nunca de un parámetro de la URL ni de nada que
 *    mande el navegador: eso convertiría el precio mayorista en algo que se
 *    consigue adivinando una dirección.
 * 2. Sin sesión, o con la lista general, **no se devuelve nada**. Un cuerpo
 *    vacío es la respuesta correcta para el público: no hay ningún precio
 *    distinto que contarle, y así tampoco se cachea nada personal.
 *
 * Se declara privada en la cabecera: es por persona y no puede quedar guardada
 * en el CDN ni en un proxy del camino.
 */
export async function GET() {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ precios: {} });

  /*
   * La vista va aunque la lista sea la general: un responsable inscripto sin
   * lista propia igual mira los precios sin IVA, y esa preferencia también se
   * pierde al servir la página estática.
   */
  const [lista, vista] = await Promise.all([listaVigente(), vistaDePrecio()]);

  if (!lista.esDiferenciada) {
    return NextResponse.json(
      { precios: {}, vista },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const productos = await listarProductos();

  const precios: Record<
    string,
    { desde: string | null; anterior: string | null; descuento: number | null }
  > = {};
  for (const p of productos) {
    precios[p.slug] = {
      desde: p.precioDesde,
      anterior: p.precioAnterior,
      descuento: p.descuento,
    };
  }

  return NextResponse.json(
    { lista: lista.nombre, precios, vista },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
