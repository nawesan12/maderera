"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  blogCategories,
  blogPosts,
  siteSettings,
  testimonials,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { guardarImagen } from "@/lib/almacenamiento";
import { markdownATexto } from "@/lib/markdown";

export interface EstadoContenido {
  error?: string;
  ok?: string;
}

function refrescar(slug?: string) {
  revalidatePath("/admin/contenido");
  revalidatePath("/blog");
  revalidatePath("/");
  if (slug) revalidatePath(`/blog/${slug}`);
}

/** Minutos de lectura a 200 palabras por minuto, el promedio en castellano. */
function minutosDeLectura(texto: string): number {
  const palabras = texto.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(palabras / 200));
}

function aSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

const esquema = z.object({
  id: z.string().uuid().optional(),
  titulo: z.string().trim().min(5, "El título es muy corto.").max(160),
  resumen: z
    .string()
    .trim()
    .max(300, "El resumen no puede pasar de 300 caracteres.")
    .optional(),
  contenido: z.string().trim().min(20, "Falta el cuerpo de la nota."),
  categoryId: z.string().uuid().optional(),
  autor: z.string().trim().max(120).optional(),
  metaDescripcion: z.string().trim().max(300).optional(),
  destacado: z.boolean(),
  publicar: z.boolean(),
});

/**
 * Alta y edición de una nota.
 *
 * El slug se calcula del título al crear y **no se recalcula al editar**: una
 * URL publicada, compartida e indexada no puede cambiar porque alguien corrigió
 * una palabra del título. Para cambiarla hay que crear otra nota.
 *
 * El resumen se completa solo con las primeras líneas si se deja vacío: es lo
 * que se ve en la tarjeta del listado y en el resultado de Google, y una nota
 * sin resumen se ve rota en los dos lados.
 */
export async function guardarArticulo(
  _previo: EstadoContenido,
  formData: FormData,
): Promise<EstadoContenido> {
  await requireStaff();

  const parsed = esquema.safeParse({
    id: (formData.get("id") as string) || undefined,
    titulo: formData.get("titulo"),
    resumen: (formData.get("resumen") as string) || undefined,
    contenido: formData.get("contenido"),
    categoryId: (formData.get("categoryId") as string) || undefined,
    autor: (formData.get("autor") as string) || undefined,
    metaDescripcion: (formData.get("metaDescripcion") as string) || undefined,
    destacado: formData.get("destacado") === "on",
    publicar: formData.get("publicar") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;
  const resumen = datos.resumen || markdownATexto(datos.contenido, 220);

  let imagenUrl: string | null = null;
  const imagen = formData.get("imagen");

  if (imagen instanceof File && imagen.size > 0) {
    const guardada = await guardarImagen(imagen, "nota");
    if (guardada.error) return { error: guardada.error };
    imagenUrl = guardada.url ?? null;
  }

  const comunes = {
    titulo: datos.titulo,
    resumen,
    contenido: datos.contenido,
    categoryId: datos.categoryId ?? null,
    autor: datos.autor ?? "Maderera Juan B. Justo",
    metaDescripcion: datos.metaDescripcion ?? null,
    destacado: datos.destacado,
    minutosLectura: minutosDeLectura(datos.contenido),
    estado: datos.publicar ? ("publicado" as const) : ("borrador" as const),
    updatedAt: new Date(),
  };

  if (datos.id) {
    const [actual] = await db
      .select({ slug: blogPosts.slug, publicadoAt: blogPosts.publicadoAt })
      .from(blogPosts)
      .where(eq(blogPosts.id, datos.id))
      .limit(1);

    if (!actual) return { error: "La nota no existe." };

    await db
      .update(blogPosts)
      .set({
        ...comunes,
        ...(imagenUrl ? { imagenUrl } : {}),
        // La fecha de publicación se fija la primera vez y no se mueve: es la
        // que se muestra y la que ordena el listado.
        publicadoAt:
          datos.publicar && !actual.publicadoAt ? new Date() : actual.publicadoAt,
      })
      .where(eq(blogPosts.id, datos.id));

    refrescar(actual.slug);
    return { ok: datos.publicar ? "Nota publicada." : "Guardada como borrador." };
  }

  let slug = aSlug(datos.titulo);

  const [existente] = await db
    .select({ id: blogPosts.id })
    .from(blogPosts)
    .where(eq(blogPosts.slug, slug))
    .limit(1);

  if (existente) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  await db.insert(blogPosts).values({
    ...comunes,
    slug,
    imagenUrl,
    publicadoAt: datos.publicar ? new Date() : null,
  });

  refrescar(slug);

  return {
    ok: datos.publicar
      ? "Nota publicada. Ya se ve en el blog."
      : "Guardada como borrador.",
  };
}

export async function cambiarEstadoArticulo(
  _previo: EstadoContenido,
  formData: FormData,
): Promise<EstadoContenido> {
  await requireStaff();

  const parsed = z
    .object({
      id: z.string().uuid(),
      estado: z.enum(["borrador", "publicado", "archivado"]),
    })
    .safeParse({ id: formData.get("id"), estado: formData.get("estado") });

  if (!parsed.success) return { error: "Datos inválidos." };

  const [actual] = await db
    .select({ slug: blogPosts.slug, publicadoAt: blogPosts.publicadoAt })
    .from(blogPosts)
    .where(eq(blogPosts.id, parsed.data.id))
    .limit(1);

  await db
    .update(blogPosts)
    .set({
      estado: parsed.data.estado,
      publicadoAt:
        parsed.data.estado === "publicado" && !actual?.publicadoAt
          ? new Date()
          : (actual?.publicadoAt ?? null),
      updatedAt: new Date(),
    })
    .where(eq(blogPosts.id, parsed.data.id));

  refrescar(actual?.slug);

  const TEXTO: Record<string, string> = {
    publicado: "Publicada. Ya se ve en el blog.",
    borrador: "Volvió a borrador: dejó de verse.",
    archivado: "Archivada.",
  };

  return { ok: TEXTO[parsed.data.estado] };
}

export async function crearCategoria(
  _previo: EstadoContenido,
  formData: FormData,
): Promise<EstadoContenido> {
  await requireStaff();

  const nombre = z
    .string()
    .trim()
    .min(3, "El nombre es muy corto.")
    .max(60)
    .safeParse(formData.get("nombre"));

  if (!nombre.success) {
    return { error: nombre.error.issues[0]?.message ?? "Revisá el nombre." };
  }

  await db
    .insert(blogCategories)
    .values({ slug: aSlug(nombre.data), nombre: nombre.data })
    .onConflictDoNothing({ target: blogCategories.slug });

  refrescar();

  return { ok: "Categoría creada." };
}

export async function guardarTestimonio(
  _previo: EstadoContenido,
  formData: FormData,
): Promise<EstadoContenido> {
  await requireStaff();

  const parsed = z
    .object({
      nombre: z.string().trim().min(3, "Falta el nombre.").max(120),
      rol: z.string().trim().max(120).optional(),
      texto: z.string().trim().min(20, "El testimonio es muy corto.").max(600),
    })
    .safeParse({
      nombre: formData.get("nombre"),
      rol: (formData.get("rol") as string) || undefined,
      texto: formData.get("texto"),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const iniciales = parsed.data.nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  await db.insert(testimonials).values({
    ...parsed.data,
    rol: parsed.data.rol ?? null,
    iniciales,
  });

  refrescar();

  return { ok: "Testimonio agregado." };
}

/**
 * Da de baja un testimonio.
 *
 * Se desactiva en vez de borrarse: son personas reales y conviene poder
 * reponerlo si se sacó por error.
 */
export async function bajaTestimonio(
  _previo: EstadoContenido,
  formData: FormData,
): Promise<EstadoContenido> {
  await requireStaff();

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Testimonio inválido." };

  const [actual] = await db
    .select({ activo: testimonials.activo })
    .from(testimonials)
    .where(eq(testimonials.id, id.data))
    .limit(1);

  await db
    .update(testimonials)
    .set({ activo: !actual?.activo })
    .where(eq(testimonials.id, id.data));

  refrescar();

  return { ok: actual?.activo ? "Ya no se muestra." : "Vuelve a mostrarse." };
}

export async function guardarAjuste(
  _previo: EstadoContenido,
  formData: FormData,
): Promise<EstadoContenido> {
  await requireStaff();

  const parsed = z
    .object({ clave: z.string().min(1).max(60), valor: z.string().max(500) })
    .safeParse({
      clave: formData.get("clave"),
      valor: formData.get("valor") ?? "",
    });

  if (!parsed.success) return { error: "Datos inválidos." };

  await db
    .update(siteSettings)
    .set({ valor: parsed.data.valor, updatedAt: new Date() })
    .where(eq(siteSettings.clave, parsed.data.clave));

  refrescar();

  return { ok: "Guardado." };
}
