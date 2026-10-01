import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getSession } from "@/lib/dal/session";
import { obtenerCarrito } from "@/lib/dal/carrito";
import { listaVigente, vistaDePrecio, type VistaDePrecio } from "@/lib/dal/precios-sesion";
import { listarProductos, preciosPropiosPorVariante } from "@/lib/dal/catalog";
import { placasCortables } from "@/lib/dal/cortes-publico";
import { SENAL_ESTADO } from "@/lib/senal-cliente";
import { degradar } from "@/lib/degradar";

/**
 * Lo que las páginas públicas saben de quien está mirando, resuelto en el
 * servidor y en el mismo pedido.
 *
 * **Por qué existe.** Las páginas del sitio salen ya armadas —una sola versión
 * para todo el mundo, con precio de público y sin nombre en el menú— y hasta
 * ahora el navegador las corregía después con `/api/estado` y
 * `/api/mis-precios`. Eso se veía: el profesional leía primero el precio de
 * público y la barra le decía «Ingresar» antes de saludarlo.
 *
 * Con Cache Components la página sigue saliendo armada, pero los huecos que
 * dependen de la persona —el saludo, el contador, cada precio— se completan en
 * el servidor y llegan **en la misma respuesta**, por streaming, detrás de un
 * `<Suspense>` cuyo respaldo es lo que ve el público. Ver
 * `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`.
 *
 * **Nada de esto puede ir bajo `use cache`.** Es lo que se resuelve por
 * persona: guardarlo en un caché compartido sería mostrarle a cualquiera el
 * precio de un profesional. Todo lo de acá es por pedido; lo que se repite
 * entre pedidos —la lista de precios, los productos— ya está cacheado más
 * abajo, por lista.
 */

/** Lo que el encabezado necesita: el nombre del menú y el contador. */
export interface EstadoDelVisitante {
  sesion: { nombre: string; esStaff: boolean } | null;
  cantidadItems: number;
  /**
   * Con qué señal se resolvió esto.
   *
   * El layout no se vuelve a armar al navegar dentro del sitio, así que si la
   * señal del navegador cambia por detrás —se inició sesión en otra pestaña,
   * se cerró— lo que dice el encabezado quedó de otra persona. El navegador
   * compara esta marca con la cookie para darse cuenta. Ver
   * `queHacerConLaSenal` en `lib/estado-context.tsx`.
   */
  senal: string | null;
}

const NADIE: EstadoDelVisitante = { sesion: null, cantidadItems: 0, senal: null };

/**
 * El nombre y el contador del encabezado.
 *
 * **Sin la cookie señal no toca la base.** Es la misma regla que antes cumplía
 * el navegador: quien nunca entró ni agregó nada —casi todo el tráfico— no
 * tiene nada que buscar. Ahora la cumple el servidor, que es donde está la
 * consulta.
 */
export async function estadoDelVisitante(): Promise<EstadoDelVisitante> {
  const senal = (await cookies()).get(SENAL_ESTADO)?.value ?? null;
  if (!senal) return NADIE;

  // Si algo falla, el menú queda como el de alguien sin sesión: de menos por
  // un instante, nunca de más. El acceso no se decide acá.
  return degradar(
    "lo que el encabezado sabe de quien mira",
    async () => {
      const [sesion, carrito] = await Promise.all([getSession(), obtenerCarrito()]);
      return {
        sesion: sesion
          ? { nombre: sesion.name, esStaff: sesion.role === "staff" }
          : null,
        cantidadItems: carrito.cantidadItems,
        senal,
      };
    },
    { ...NADIE, senal },
  );
}

/** El precio de un producto en la lista de quien mira, cuando no es la general. */
export interface PrecioPropio {
  desde: string | null;
  anterior: string | null;
  descuento: number | null;
}

/**
 * Todos los precios de la lista propia, por slug, **una vez por pedido**.
 *
 * Vive en la memoria del servidor y no viaja entero: cada tarjeta toma el suyo
 * y en el HTML queda solo el precio de lo que se muestra. Antes el navegador
 * bajaba el mapa del catálogo completo, que con el catálogo real son cientos
 * de kilobytes.
 */
const preciosPropiosDelPedido = cache(
  async (): Promise<Record<string, PrecioPropio> | null> => {
    const lista = await listaVigente();
    if (!lista.esDiferenciada) return null;

    const productos = await listarProductos();
    const porSlug: Record<string, PrecioPropio> = {};
    for (const p of productos) {
      porSlug[p.slug] = {
        desde: p.precioDesde,
        anterior: p.precioAnterior,
        descuento: p.descuento,
      };
    }
    return porSlug;
  },
);

/**
 * Lo que una tarjeta del catálogo necesita saber de quien mira.
 *
 * `propio` es null para el público y para todo producto que la lista propia no
 * tenga cargado: en los dos casos se muestra el precio que vino con la página.
 * Si algo falla, también: el lado seguro es el precio de público.
 */
export async function precioDeTarjeta(
  slug: string,
): Promise<{ propio: PrecioPropio | null; vista: VistaDePrecio }> {
  return degradar(
    "el precio de quien mira",
    async () => {
      const [mapa, vista] = await Promise.all([preciosPropiosDelPedido(), vistaDePrecio()]);
      return { propio: mapa?.[slug] ?? null, vista };
    },
    { propio: null, vista: "final" as VistaDePrecio },
  );
}

/** Lo que el selector de medida de una ficha necesita saber de quien mira. */
export interface PreciosDeFicha {
  /** Por id de variante, solo las de esta ficha. Vacío para el público. */
  porVariante: Record<string, string>;
  vista: VistaDePrecio;
}

/**
 * Los precios propios de las medidas de un producto.
 *
 * Se filtra a las variantes de la ficha: el mapa completo vive en el caché del
 * servidor y no tiene por qué viajar.
 */
export async function preciosDeFicha(variantIds: string[]): Promise<PreciosDeFicha> {
  return degradar(
    "los precios de la ficha para quien mira",
    async () => {
      const [mapa, vista] = await Promise.all([preciosPropiosPorVariante(), vistaDePrecio()]);
      const porVariante: Record<string, string> = {};
      for (const id of variantIds) if (mapa[id]) porVariante[id] = mapa[id];
      return { porVariante, vista };
    },
    { porVariante: {}, vista: "final" as VistaDePrecio },
  );
}

/** El precio propio de una placa y de su corte, por id de variante. */
export type PreciosDePlaca = Record<
  string,
  { precio: number; precioPorPasada: number; precioPorMetroCanto: number }
>;

/**
 * Las placas de `/corte` con la lista de quien mira.
 *
 * **El precio de la placa y su tarifa de corte.** La tarifa —cuánto sale la
 * pasada de sierra y el metro de tapacanto— también depende de la lista, así
 * que corregir solo el material dejaría el presupuesto a medias: la placa con
 * el precio del profesional y el corte con el de público.
 *
 * Vacío para el público y para quien no tiene lista propia. Lo que se cobra no
 * sale de acá en ningún caso: al agregar el corte al carrito el servidor
 * vuelve a buscar la placa y a presupuestar con la lista real.
 */
export async function preciosDePlacas(): Promise<PreciosDePlaca> {
  return degradar(
    "los precios de las placas para quien mira",
    async () => {
      const lista = await listaVigente();
      if (!lista.esDiferenciada) return {};
      const porVariante: PreciosDePlaca = {};
      for (const p of await placasCortables()) {
        porVariante[p.variantId] = {
          precio: p.precio,
          precioPorPasada: p.precioPorPasada,
          precioPorMetroCanto: p.precioPorMetroCanto,
        };
      }
      return porVariante;
    },
    {},
  );
}
