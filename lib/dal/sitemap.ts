import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { events } from "@/lib/db/schema";

/**
 * Lo que va al sitemap, y solo eso.
 *
 * Consulta propia y no reutiliza los listados del catálogo a propósito:
 * `listarProductos` trae precios, stock y fotos por producto, que para armar
 * una lista de URLs es traer media base al pedo. Acá alcanza con el slug, la
 * fecha del último cambio y las fotos.
 */

export interface RutaSitemap {
  ruta: string;
  actualizada: Date;
  /** Fotos de la página, para el sitemap de imágenes. */
  imagenes?: string[];
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
  imagenes?: string[];
}

const conFechas = (filas: RutaGuardada[]): RutaSitemap[] =>
  filas.map((f) => ({ ...f, actualizada: new Date(f.actualizada) }));

/*
 * Las consultas van cacheadas y con etiqueta.
 *
 * El sitemap es lo primero que pide cualquier rastreador y lo piden todos: sin
 * caché, cada visita de un bot son varias recorridas a la base para armar una
 * lista de direcciones que cambia cuando se publica un producto, no cuando
 * alguien la mira. La etiqueta hace que un producto nuevo aparezca enseguida
 * igual, que es la razón por la que esto no se generaba en el build.
 */

/**
 * Las fichas, con la fecha de su último cambio **de verdad**.
 *
 * `products.updated_at` solo se mueve cuando se edita la ficha; un cambio de
 * precio toca la lista de precios y uno de medida, la variante. Para Google
 * los tres son «la página cambió», y es lo que tiene que decir `lastmod`: se
 * toma el más reciente de los tres.
 *
 * Las fotos van en el orden de la galería: la primera es la que Google usa
 * para el resultado de imágenes.
 */
const catalogoCacheado = cachearPublico(
  async (): Promise<RutaGuardada[]> => {
    const { rows } = await db.execute<{
      slug: string;
      actualizada: string | Date;
      imagenes: string[] | null;
    }>(sql`
      select
        p.slug,
        greatest(
          p.updated_at,
          coalesce((select max(v.updated_at) from product_variants v where v.product_id = p.id), p.updated_at),
          coalesce((
            select max(pli.updated_at)
            from price_list_items pli
            join product_variants v on v.id = pli.variant_id
            where v.product_id = p.id
          ), p.updated_at)
        ) as actualizada,
        (
          select array_agg(i.url order by i.sort_order, i.created_at)
          from product_images i
          where i.product_id = p.id
        ) as imagenes
      from products p
      where p.active
      order by actualizada desc
    `);

    return rows.map((f) => ({
      ruta: `/catalogo/${f.slug}`,
      actualizada: new Date(f.actualizada).toISOString(),
      imagenes: (f.imagenes ?? []).slice(0, 10),
    }));
  },
  ["sitemap-catalogo-v2"],
  ETIQUETAS.catalogo,
);

export async function rutasDelCatalogo(): Promise<RutaSitemap[]> {
  return conFechas(await catalogoCacheado());
}

/**
 * Las categorías y sus rubros, como filtro del catálogo: es la URL que existe.
 *
 * La fecha es la del producto más nuevo adentro: una categoría no cambia por
 * sí sola, cambia cuando entra o se actualiza algo. Solo las que tienen algún
 * producto activo: una categoría vacía es una grilla sin nada.
 */
const categoriasCacheadas = cachearPublico(
  async (): Promise<RutaGuardada[]> => {
    const { rows } = await db.execute<{
      categoria: string;
      rubro: string | null;
      actualizada: string | Date;
      imagen: string | null;
    }>(sql`
      select
        c.slug as categoria,
        null::text as rubro,
        max(p.updated_at) as actualizada,
        max(c.image) as imagen
      from categories c
      join products p on p.category_id = c.id and p.active
      where c.active
      group by c.slug
      union all
      select
        c.slug as categoria,
        s.slug as rubro,
        max(p.updated_at) as actualizada,
        null as imagen
      from subcategories s
      join categories c on c.id = s.category_id and c.active
      join products p on p.subcategory_id = s.id and p.active
      where s.active
      group by c.slug, s.slug
    `);

    return rows.map((f) => ({
      ruta: f.rubro
        ? `/catalogo?cat=${f.categoria}&rubro=${f.rubro}`
        : `/catalogo?cat=${f.categoria}`,
      actualizada: new Date(f.actualizada).toISOString(),
      imagenes: f.imagen ? [f.imagen] : [],
    }));
  },
  ["sitemap-categorias-v2"],
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
        imagen: events.imagenUrl,
      })
      .from(events)
      .where(
        and(eq(events.estado, "publicado"), gte(events.inicia, new Date())),
      );

    return filas.map((f) => ({
      ruta: `/eventos/${f.slug}`,
      actualizada: f.actualizada.toISOString(),
      imagenes: f.imagen ? [f.imagen] : [],
    }));
  },
  ["sitemap-eventos-v2"],
  ETIQUETAS.eventos,
);

export async function rutasDeEventos(): Promise<RutaSitemap[]> {
  return conFechas(await eventosCacheados());
}
