import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  blogCategories,
  blogPosts,
  siteSettings,
  testimonials,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

/** Contenido editable, para el panel. */

export interface ArticuloAdmin {
  id: string;
  slug: string;
  titulo: string;
  resumen: string;
  contenido: string;
  imagenUrl: string | null;
  categoryId: string | null;
  categoria: string | null;
  autor: string | null;
  estado: string;
  publicadoAt: Date | null;
  minutosLectura: number;
  destacado: boolean;
  updatedAt: Date;
}

export async function listarArticulosAdmin(): Promise<ArticuloAdmin[]> {
  await requireStaff();

  return db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      titulo: blogPosts.titulo,
      resumen: blogPosts.resumen,
      contenido: blogPosts.contenido,
      imagenUrl: blogPosts.imagenUrl,
      categoryId: blogPosts.categoryId,
      categoria: blogCategories.nombre,
      autor: blogPosts.autor,
      estado: blogPosts.estado,
      publicadoAt: blogPosts.publicadoAt,
      minutosLectura: blogPosts.minutosLectura,
      destacado: blogPosts.destacado,
      updatedAt: blogPosts.updatedAt,
    })
    .from(blogPosts)
    .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
    .orderBy(desc(blogPosts.updatedAt));
}

export async function listarCategoriasAdmin() {
  await requireStaff();

  return db
    .select({
      id: blogCategories.id,
      slug: blogCategories.slug,
      nombre: blogCategories.nombre,
      notas: sql<number>`(
        select count(*)::int from blog_posts p
        where p.category_id = blog_categories.id
      )`,
    })
    .from(blogCategories)
    .orderBy(asc(blogCategories.orden), asc(blogCategories.nombre));
}

export async function listarTestimoniosAdmin() {
  await requireStaff();

  return db
    .select()
    .from(testimonials)
    .orderBy(desc(testimonials.activo), asc(testimonials.orden));
}

export async function listarAjustes() {
  await requireStaff();

  return db
    .select()
    .from(siteSettings)
    .orderBy(asc(siteSettings.clave));
}
