import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  blogCategories,
  blogPosts,
  categories,
  events,
  products,
} from "@/lib/db/schema";

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

export async function rutasDelCatalogo(): Promise<RutaSitemap[]> {
  const filas = await db
    .select({ slug: products.slug, actualizada: products.updatedAt })
    .from(products)
    .where(eq(products.active, true))
    .orderBy(desc(products.updatedAt));

  return filas.map((f) => ({
    ruta: `/catalogo/${f.slug}`,
    actualizada: f.actualizada,
  }));
}

/**
 * Las categorías van como filtro del catálogo, que es la URL que existe.
 *
 * La fecha es la del producto más nuevo de la categoría: una categoría no
 * cambia por sí sola, cambia cuando entra o se actualiza algo adentro.
 */
export async function rutasDeCategorias(): Promise<RutaSitemap[]> {
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
    actualizada: new Date(f.actualizada),
  }));
}

export async function rutasDelBlog(): Promise<RutaSitemap[]> {
  const [notas, categoriasDelBlog] = await Promise.all([
    db
      .select({
        slug: blogPosts.slug,
        actualizada: blogPosts.updatedAt,
      })
      .from(blogPosts)
      .where(eq(blogPosts.estado, "publicado")),
    db
      .select({
        slug: blogCategories.slug,
        actualizada: sql<Date>`max(${blogPosts.updatedAt})`,
      })
      .from(blogCategories)
      .innerJoin(
        blogPosts,
        and(
          eq(blogPosts.categoryId, blogCategories.id),
          eq(blogPosts.estado, "publicado"),
        ),
      )
      .groupBy(blogCategories.slug),
  ]);

  return [
    ...notas.map((f) => ({ ruta: `/blog/${f.slug}`, actualizada: f.actualizada })),
    ...categoriasDelBlog.map((f) => ({
      ruta: `/blog?categoria=${f.slug}`,
      actualizada: new Date(f.actualizada),
    })),
  ];
}

/**
 * Solo los eventos que todavía no pasaron.
 *
 * Un evento vencido sigue existiendo en el sitio, pero pedirle a Google que lo
 * indexe es pedirle que mande gente a una charla de hace tres meses.
 */
export async function rutasDeEventos(): Promise<RutaSitemap[]> {
  const filas = await db
    .select({
      slug: events.slug,
      actualizada: events.updatedAt,
    })
    .from(events)
    .where(and(eq(events.estado, "publicado"), gte(events.inicia, new Date())));

  return filas.map((f) => ({
    ruta: `/eventos/${f.slug}`,
    actualizada: f.actualizada,
  }));
}
