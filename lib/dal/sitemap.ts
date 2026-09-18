import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { categories, events, products } from "@/lib/db/schema";

/**
 * Lo que va al sitemap, y solo eso.
 *
 * Consulta propia y no reutiliza los listados del catálogo a propósito:
 * `listarProductos` trae precios, stock y fotos por producto, que para armar
 * una lista de URLs es traer media base al pedo. Acá alcanza con el slug y la
 * fecha del último cambio.
 */

export interface RutaSitemap {
  ruta: string;
  actualizada: Date;
}

/**
 * Lo mismo, con la fecha en texto.
 *
 * Es lo que realmente sale del caché: `unstable_cache` guarda JSON, y un `Date`
 * que entra vuelve convertido en string. El tipo lo dice para que nadie llame a
 * `.getTime()` sobre algo que ya no es una fecha; las funciones exportadas las
 * rearman antes de devolverlas.
 */
interface RutaGuardada {
  ruta: string;
  actualizada: string;
}

const conFechas = (filas: RutaGuardada[]): RutaSitemap[] =>
  filas.map((f) => ({ ruta: f.ruta, actualizada: new Date(f.actualizada) }));

/*
 * Las tres consultas van cacheadas y con etiqueta.
 *
 * El sitemap es lo primero que pide cualquier rastreador y lo piden todos: sin
 * caché, cada visita de un bot son tres recorridas a la base para armar una
 * lista de direcciones que cambia cuando se publica un producto, no cuando
 * alguien la mira. La etiqueta hace que un producto nuevo aparezca enseguida
 * igual, que es la razón por la que esto no se generaba en el build.
 */
const catalogoCacheado = cachearPublico(
  async (): Promise<RutaGuardada[]> => {
    const filas = await db
      .select({ slug: products.slug, actualizada: products.updatedAt })
      .from(products)
      .where(eq(products.active, true))
      .orderBy(desc(products.updatedAt));

    return filas.map((f) => ({
      ruta: `/catalogo/${f.slug}`,
      actualizada: f.actualizada.toISOString(),
    }));
  },
  ["sitemap-catalogo"],
  ETIQUETAS.catalogo,
);

export async function rutasDelCatalogo(): Promise<RutaSitemap[]> {
  return conFechas(await catalogoCacheado());
}

/**
 * Las categorías van como filtro del catálogo, que es la URL que existe.
 *
 * La fecha es la del producto más nuevo de la categoría: una categoría no
 * cambia por sí sola, cambia cuando entra o se actualiza algo adentro.
 */
const categoriasCacheadas = cachearPublico(
  async (): Promise<RutaGuardada[]> => {
    const filas = await db
      .select({
        slug: categories.slug,
        actualizada: sql<Date>`max(${products.updatedAt})`,
      })
      .from(categories)
      .innerJoin(
        products,
        and(eq(products.categoryId, categories.id), eq(products.active, true)),
      )
      .where(eq(categories.active, true))
      .groupBy(categories.slug);

    return filas.map((f) => ({
      ruta: `/catalogo?cat=${f.slug}`,
      actualizada: new Date(f.actualizada).toISOString(),
    }));
  },
  ["sitemap-categorias"],
  ETIQUETAS.catalogo,
);

export async function rutasDeCategorias(): Promise<RutaSitemap[]> {
  return conFechas(await categoriasCacheadas());
}

/**
 * Solo los eventos que todavía no pasaron.
 *
 * Un evento vencido sigue existiendo en el sitio, pero pedirle a Google que lo
 * indexe es pedirle que mande gente a una charla de hace tres meses.
 */
const eventosCacheados = cachearPublico(
  async (): Promise<RutaGuardada[]> => {
    const filas = await db
      .select({
        slug: events.slug,
        actualizada: events.updatedAt,
      })
      .from(events)
      .where(
        and(eq(events.estado, "publicado"), gte(events.inicia, new Date())),
      );

    return filas.map((f) => ({
      ruta: `/eventos/${f.slug}`,
      actualizada: f.actualizada.toISOString(),
    }));
  },
  ["sitemap-eventos"],
  ETIQUETAS.eventos,
);

export async function rutasDeEventos(): Promise<RutaSitemap[]> {
  return conFechas(await eventosCacheados());
}
