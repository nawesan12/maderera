import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  blogCategories,
  blogPosts,
  siteSettings,
  testimonials,
} from "@/lib/db/schema";
import { coincideBusqueda } from "@/lib/busqueda";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";

/**
 * Contenido público del sitio.
 *
 * Todo lo de acá es candidato natural a `use cache` con `cacheTag("blog")` —no
 * cambia entre visitantes ni depende de la sesión—, pero eso exige activar
 * `cacheComponents`, que es una decisión de todo el proyecto y todavía no se
 * tomó (ver §3.2 del plan). Mientras tanto se consulta en cada request, que
 * para media docena de notas no cuesta nada.
 */

export interface ArticuloListado {
  id: string;
  slug: string;
  titulo: string;
  resumen: string;
  imagenUrl: string | null;
  categoria: string | null;
  categoriaSlug: string | null;
  autor: string | null;
  publicadoAt: Date | null;
  minutosLectura: number;
  destacado: boolean;
}

async function consultarArticulos(
  filtros: { categoria?: string; busqueda?: string; limite?: number } = {},
): Promise<ArticuloListado[]> {
  const condiciones = [eq(blogPosts.estado, "publicado")];

  if (filtros.categoria && filtros.categoria !== "todos") {
    condiciones.push(eq(blogCategories.slug, filtros.categoria));
  }

  if (filtros.busqueda) {
    const coincidencia = coincideBusqueda(filtros.busqueda, [
      blogPosts.titulo,
      blogPosts.resumen,
    ]);
    if (coincidencia) condiciones.push(coincidencia);
  }

  const consulta = db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      titulo: blogPosts.titulo,
      resumen: blogPosts.resumen,
      imagenUrl: blogPosts.imagenUrl,
      categoria: blogCategories.nombre,
      categoriaSlug: blogCategories.slug,
      autor: blogPosts.autor,
      publicadoAt: blogPosts.publicadoAt,
      minutosLectura: blogPosts.minutosLectura,
      destacado: blogPosts.destacado,
    })
    .from(blogPosts)
    .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
    .where(and(...condiciones))
    // Los destacados primero y después por fecha: es el orden que espera quien
    // entra al blog sin buscar nada en particular.
    .orderBy(desc(blogPosts.destacado), desc(blogPosts.publicadoAt));

  return filtros.limite ? consulta.limit(filtros.limite) : consulta;
}

const articulosCacheados = cachearPublico(
  consultarArticulos,
  ["blog", "articulos"],
  ETIQUETAS.contenido,
);

/**
 * Las notas publicadas.
 *
 * El caché se aplica **solo cuando no hay término de búsqueda**. Cachear la
 * búsqueda guardaría una entrada por cada cosa que alguien escriba en el
 * buscador: un caché que crece sin techo para ahorrar una consulta. Sin texto
 * —que es como se piden desde la portada y desde el blog— la combinación de
 * categoría y límite es un puñado de claves, y esas sí valen la pena.
 */
export async function listarArticulos(
  filtros: { categoria?: string; busqueda?: string; limite?: number } = {},
): Promise<ArticuloListado[]> {
  if (filtros.busqueda) return consultarArticulos(filtros);
  return (await articulosCacheados(filtros)).map(conFecha);
}

/**
 * Devuelve la nota con `publicadoAt` hecho un `Date` de verdad.
 *
 * El caché guarda JSON, así que la fecha vuelve como texto aunque el tipo diga
 * `Date`. Sin esto, la página de la nota rompe al formatearla —pasó, y en el
 * build: "toISOString is not a function"—.
 */
function conFecha<T extends { publicadoAt: Date | null }>(fila: T): T {
  return fila.publicadoAt
    ? { ...fila, publicadoAt: new Date(fila.publicadoAt) }
    : fila;
}

export interface ArticuloCompleto extends ArticuloListado {
  contenido: string;
  metaTitulo: string | null;
  metaDescripcion: string | null;
}

const articuloCacheado = cachearPublico(
  async (slug: string): Promise<ArticuloCompleto | null> => {
    const [fila] = await db
      .select({
        id: blogPosts.id,
        slug: blogPosts.slug,
        titulo: blogPosts.titulo,
        resumen: blogPosts.resumen,
        contenido: blogPosts.contenido,
        imagenUrl: blogPosts.imagenUrl,
        categoria: blogCategories.nombre,
        categoriaSlug: blogCategories.slug,
        autor: blogPosts.autor,
        publicadoAt: blogPosts.publicadoAt,
        minutosLectura: blogPosts.minutosLectura,
        destacado: blogPosts.destacado,
        metaTitulo: blogPosts.metaTitulo,
        metaDescripcion: blogPosts.metaDescripcion,
        estado: blogPosts.estado,
      })
      .from(blogPosts)
      .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
      .where(eq(blogPosts.slug, slug))
      .limit(1);

    // Un borrador no se ve por URL directa aunque alguien la adivine: publicar
    // es la decisión, no tener el enlace.
    if (!fila || fila.estado !== "publicado") return null;

    return fila;
  },
  ["blog", "articulo"],
  ETIQUETAS.contenido,
);

export const articuloPorSlug = cache(
  async (slug: string): Promise<ArticuloCompleto | null> => {
    const nota = await articuloCacheado(slug);
    return nota ? conFecha(nota) : null;
  },
);

/** Otras notas de la misma categoría, para el pie del artículo. */
async function consultarRelacionados(
  slug: string,
  categoriaSlug: string | null,
  limite = 3,
): Promise<ArticuloListado[]> {
  const condiciones = [
    eq(blogPosts.estado, "publicado"),
    ne(blogPosts.slug, slug),
  ];

  if (categoriaSlug) condiciones.push(eq(blogCategories.slug, categoriaSlug));

  const relacionados = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      titulo: blogPosts.titulo,
      resumen: blogPosts.resumen,
      imagenUrl: blogPosts.imagenUrl,
      categoria: blogCategories.nombre,
      categoriaSlug: blogCategories.slug,
      autor: blogPosts.autor,
      publicadoAt: blogPosts.publicadoAt,
      minutosLectura: blogPosts.minutosLectura,
      destacado: blogPosts.destacado,
    })
    .from(blogPosts)
    .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
    .where(and(...condiciones))
    .orderBy(desc(blogPosts.publicadoAt))
    .limit(limite);

  // Sin nada de la misma categoría, se cae a lo más reciente: un pie de
  // artículo vacío es una salida menos del sitio.
  if (relacionados.length > 0) return relacionados;

  return listarArticulos({ limite });
}

const relacionadosCacheados = cachearPublico(
  consultarRelacionados,
  ["blog", "relacionados"],
  ETIQUETAS.contenido,
);

export async function articulosRelacionados(
  slug: string,
  categoriaSlug: string | null,
  limite = 3,
): Promise<ArticuloListado[]> {
  const notas = await relacionadosCacheados(slug, categoriaSlug, limite);
  return notas.map(conFecha);
}

export interface CategoriaBlog {
  slug: string;
  nombre: string;
  cantidad: number;
}

export const categoriasDelBlog = cachearPublico(
  async function categoriasDelBlog(): Promise<CategoriaBlog[]> {
  const filas = await db
    .select({
      slug: blogCategories.slug,
      nombre: blogCategories.nombre,
      cantidad: sql<number>`(
        select count(*)::int from blog_posts p
        where p.category_id = blog_categories.id and p.estado = 'publicado'
      )`,
      orden: blogCategories.orden,
    })
    .from(blogCategories)
    .orderBy(asc(blogCategories.orden), asc(blogCategories.nombre));

  // Las categorías sin notas publicadas no se muestran: un filtro que devuelve
  // cero resultados es un filtro que no debería estar.
  return filas.filter((f) => f.cantidad > 0);
  },
  ["blog", "categorias"],
  ETIQUETAS.contenido,
);

export interface TestimonioPublico {
  id: string;
  nombre: string;
  rol: string | null;
  texto: string;
  iniciales: string | null;
}

export const listarTestimonios = cachearPublico(
  async (): Promise<TestimonioPublico[]> => {
    return db
      .select({
        id: testimonials.id,
        nombre: testimonials.nombre,
        rol: testimonials.rol,
        texto: testimonials.texto,
        iniciales: testimonials.iniciales,
      })
      .from(testimonials)
      .where(eq(testimonials.activo, true))
      .orderBy(asc(testimonials.orden));
  },
  ["testimonios-activos"],
  ETIQUETAS.contenido,
);

/*
 * `listarArticulos` queda deliberadamente fuera del caché compartido: recibe el
 * texto de búsqueda del blog, y `unstable_cache` indexa por argumento. Cachearla
 * guardaría una entrada por cada cosa que alguien escriba en el buscador, que es
 * un caché que crece sin techo para ahorrar una consulta en la página menos
 * visitada del sitio.
 */

/**
 * Ajustes del sitio, todos juntos.
 *
 * Se traen de una y memoizados por request: son media docena de filas y varias
 * pantallas consultan dos o tres, así que una consulta por ajuste sería
 * gratuito de escribir y caro de correr.
 */
/*
 * Doble memoización a propósito: `cache()` de React evita repetirla dentro de
 * una misma request, y `cachearPublico` la comparte entre visitas. Es la
 * consulta que corre en absolutamente toda página del sitio.
 */
export const ajustesDelSitio = cache(
  cachearPublico(
    async (): Promise<Record<string, string>> => {
      const filas = await db
        .select({ clave: siteSettings.clave, valor: siteSettings.valor })
        .from(siteSettings);

      return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
    },
    ["ajustes-del-sitio"],
    ETIQUETAS.ajustes,
  ),
);

export async function ajuste(clave: string, porDefecto = ""): Promise<string> {
  const ajustes = await ajustesDelSitio();
  return ajustes[clave] || porDefecto;
}
