"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { eventRegistrations, events } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { parsearImporte } from "@/lib/formato";
import { enviarRecordatorios } from "@/lib/notificaciones/eventos";

export interface EstadoEvento {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/admin/eventos");
  revalidatePath("/eventos");
  revalidatePath("/profesionales");
}

/** Convierte un título en slug: es lo que va en la URL pública. */
function aSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/**
 * Alta de un evento.
 *
 * Nace en borrador: publicar es una decisión aparte. Cargar la fecha, el lugar
 * y el precio de una capacitación lleva varios minutos, y un evento a medio
 * cargar visible en el sitio es peor que ninguno.
 */
export async function crearEvento(
  _previo: EstadoEvento,
  formData: FormData,
): Promise<EstadoEvento> {
  await requireStaff();

  const parsed = z
    .object({
      titulo: z.string().trim().min(4, "Poné un título.").max(160),
      resumen: z.string().trim().max(300).optional(),
      descripcion: z.string().trim().max(4000).optional(),
      lugar: z.string().trim().max(200).optional(),
      inicia: z.string().min(1, "Falta la fecha."),
      termina: z.string().optional(),
      cupo: z.coerce.number().int().min(0).max(10000),
      precio: z.string().optional(),
      soloProfesionales: z.boolean(),
    })
    .safeParse({
      titulo: formData.get("titulo"),
      resumen: (formData.get("resumen") as string) || undefined,
      descripcion: (formData.get("descripcion") as string) || undefined,
      lugar: (formData.get("lugar") as string) || undefined,
      inicia: formData.get("inicia"),
      termina: (formData.get("termina") as string) || undefined,
      cupo: formData.get("cupo") ?? 0,
      precio: (formData.get("precio") as string) || undefined,
      soloProfesionales: formData.get("soloProfesionales") === "on",
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const inicia = new Date(parsed.data.inicia);
  if (Number.isNaN(inicia.getTime())) return { error: "La fecha no es válida." };

  const precio = parsed.data.precio ? parsearImporte(parsed.data.precio) : 0;
  if (!Number.isFinite(precio) || precio < 0) {
    return { error: "Revisá el precio." };
  }

  // Slug único: dos capacitaciones con el mismo nombre en años distintos son
  // habituales, y la URL no puede chocar.
  let slug = aSlug(parsed.data.titulo);
  const [existente] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.slug, slug))
    .limit(1);

  if (existente) slug = `${slug}-${inicia.getFullYear()}${inicia.getMonth() + 1}`;

  await db.insert(events).values({
    slug,
    titulo: parsed.data.titulo,
    resumen: parsed.data.resumen ?? null,
    descripcion: parsed.data.descripcion ?? null,
    lugar: parsed.data.lugar ?? null,
    inicia,
    termina: parsed.data.termina ? new Date(parsed.data.termina) : null,
    cupo: parsed.data.cupo,
    precio: precio.toFixed(2),
    soloProfesionales: parsed.data.soloProfesionales,
    estado: "borrador",
  });

  refrescar();

  return { ok: "Evento creado como borrador. Revisalo y publicalo." };
}

export async function cambiarEstadoEvento(
  _previo: EstadoEvento,
  formData: FormData,
): Promise<EstadoEvento> {
  await requireStaff();

  const parsed = z
    .object({
      id: z.string().uuid(),
      estado: z.enum(["borrador", "publicado", "cerrado", "cancelado"]),
    })
    .safeParse({ id: formData.get("id"), estado: formData.get("estado") });

  if (!parsed.success) return { error: "Datos inválidos." };

  await db
    .update(events)
    .set({ estado: parsed.data.estado, updatedAt: new Date() })
    .where(eq(events.id, parsed.data.id));

  refrescar();

  const TEXTO: Record<string, string> = {
    borrador: "Volvió a borrador: ya no se ve en el sitio.",
    publicado: "Publicado. Ya se puede ver y anotar.",
    cerrado: "Cerrado: no se aceptan más inscripciones.",
    cancelado: "Cancelado. Avisale a los anotados.",
  };

  return { ok: TEXTO[parsed.data.estado] };
}

/** Toma asistencia: quién vino y quién no. */
export async function marcarAsistencia(
  _previo: EstadoEvento,
  formData: FormData,
): Promise<EstadoEvento> {
  await requireStaff();

  const parsed = z
    .object({
      id: z.string().uuid(),
      estado: z.enum(["asistio", "ausente", "confirmada", "cancelada"]),
    })
    .safeParse({ id: formData.get("id"), estado: formData.get("estado") });

  if (!parsed.success) return { error: "Datos inválidos." };

  await db
    .update(eventRegistrations)
    .set({ estado: parsed.data.estado, updatedAt: new Date() })
    .where(eq(eventRegistrations.id, parsed.data.id));

  refrescar();

  return { ok: "Listo." };
}

/**
 * Manda los recordatorios de los eventos de mañana.
 *
 * Va como botón y no como tarea programada porque este sistema todavía no tiene
 * un proceso periódico. Un botón que alguien aprieta el día anterior es peor que
 * un cron, y muchísimo mejor que nada: en una capacitación gratuita el
 * recordatorio es la diferencia entre media sala y una sala.
 */
export async function mandarRecordatorios(
  _previo: EstadoEvento,
): Promise<EstadoEvento> {
  await requireStaff();

  const enviados = await enviarRecordatorios();

  refrescar();

  return {
    ok:
      enviados > 0
        ? `Salieron ${enviados} recordatorio${enviados === 1 ? "" : "s"}.`
        : "No hay eventos mañana con gente sin avisar.",
  };
}
