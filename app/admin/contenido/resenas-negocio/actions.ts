"use server";

import { revalidatePath, updateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { businessReviews } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { ETIQUETAS } from "@/lib/cache-publico";
import { sincronizarResenasDeGoogle } from "@/lib/google/resenas";

export interface EstadoResena {
  error?: string;
  ok?: string;
}

function refrescar() {
  updateTag(ETIQUETAS.contenido);
  revalidatePath("/admin/contenido/resenas-negocio");
  revalidatePath("/");
}

const esquema = z.object({
  id: z.string().uuid().optional(),
  autor: z.string().trim().min(2, "Poné quién la escribió.").max(120),
  estrellas: z.coerce.number().int().min(1).max(5),
  texto: z.string().trim().min(10, "Copiá el texto de la reseña.").max(1500),
  fecha: z.string().trim().optional(),
  publicada: z.boolean(),
});

/**
 * Carga o edita una reseña del negocio.
 *
 * Las que se copian de Google entran por acá: el equipo elige cuáles pone al
 * frente en vez de mostrar las cinco que Google devuelve, que no siempre son
 * las que uno pondría.
 */
export async function guardarResenaDelNegocio(
  _previo: EstadoResena,
  formData: FormData,
): Promise<EstadoResena> {
  const usuario = await requireStaff();

  const parsed = esquema.safeParse({
    id: (formData.get("id") as string) || undefined,
    autor: formData.get("autor"),
    estrellas: formData.get("estrellas") ?? 5,
    texto: formData.get("texto"),
    fecha: (formData.get("fecha") as string) || undefined,
    publicada: formData.get("publicada") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = parsed.data;
  const valores = {
    autor: d.autor,
    estrellas: d.estrellas,
    texto: d.texto,
    // Al mediodía, como el resto de las fechas que se cargan sin hora.
    fecha: d.fecha ? new Date(`${d.fecha}T12:00:00`) : new Date(),
    publicada: d.publicada,
    updatedAt: new Date(),
  };

  if (d.id) {
    await db
      .update(businessReviews)
      .set(valores)
      .where(eq(businessReviews.id, d.id));
  } else {
    await db.insert(businessReviews).values(valores);
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: d.id ? "editar" : "crear",
    entidad: "resena",
    entidadId: d.id ?? null,
    descripcion: `Reseña del negocio de ${d.autor}${d.publicada ? " (publicada)" : ""}`,
  });

  refrescar();
  return { ok: d.publicada ? "Publicada." : "Guardada, sin publicar." };
}

/** Publica o esconde una reseña, sin abrir el formulario. */
export async function publicarResena(
  id: string,
  publicada: boolean,
): Promise<EstadoResena> {
  const usuario = await requireStaff();

  const parsed = z
    .object({ id: z.string().uuid(), publicada: z.boolean() })
    .safeParse({ id, publicada });

  if (!parsed.success) return { error: "No se pudo actualizar." };

  await db
    .update(businessReviews)
    .set({ publicada: parsed.data.publicada, updatedAt: new Date() })
    .where(eq(businessReviews.id, parsed.data.id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "resena",
    entidadId: parsed.data.id,
    descripcion: parsed.data.publicada
      ? "Publicó una reseña del negocio"
      : "Sacó del sitio una reseña del negocio",
  });

  refrescar();
  return { ok: parsed.data.publicada ? "Publicada." : "Sacada del sitio." };
}

export async function borrarResenaDelNegocio(
  id: string,
): Promise<EstadoResena> {
  const usuario = await requireStaff();

  await db.delete(businessReviews).where(eq(businessReviews.id, id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "eliminar",
    entidad: "resena",
    entidadId: id,
    descripcion: "Borró una reseña del negocio",
  });

  refrescar();
  return { ok: "Borrada." };
}

/**
 * Trae las reseñas nuevas de Google.
 *
 * Sin claves configuradas no falla: lo dice y no hace nada. Las que trae quedan
 * sin publicar hasta que alguien las lea.
 */
export async function traerDeGoogle(): Promise<EstadoResena> {
  const usuario = await requireStaff();

  const resultado = await sincronizarResenasDeGoogle();

  if (resultado.error) return { error: resultado.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "resena",
    descripcion: `Trajo ${resultado.nuevas} reseñas nuevas de Google`,
  });

  refrescar();

  return {
    ok:
      resultado.nuevas > 0
        ? `Llegaron ${resultado.nuevas} reseñas nuevas. Revisalas y publicá las que quieras mostrar.`
        : `Google devolvió ${resultado.traidas} reseñas y ya estaban todas cargadas.`,
  };
}
