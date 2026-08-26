"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { technicalDocuments } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { guardarAdjunto } from "@/lib/almacenamiento";

export interface EstadoDocumento {
  error?: string;
  ok?: string;
}

/** Formatos que tiene sentido publicar como documentación técnica. */
const TIPOS = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["text/csv", "csv"],
]);

function refrescar() {
  revalidatePath("/admin/documentacion");
  revalidatePath("/documentacion");
  revalidatePath("/profesionales");
}

/**
 * Sube un documento técnico.
 *
 * `soloProfesionales` viene marcado por defecto: la documentación detallada es
 * parte del valor del acceso profesional, y publicarla entera de entrada le
 * saca sentido a pedirlo. Se destilda a conciencia para lo que sirve como
 * material de posicionamiento.
 */
export async function subirDocumento(
  _previo: EstadoDocumento,
  formData: FormData,
): Promise<EstadoDocumento> {
  await requireStaff();

  const parsed = z
    .object({
      titulo: z.string().trim().min(3, "Poné un título.").max(160),
      descripcion: z.string().trim().max(400).optional(),
      categoria: z.string().trim().min(2).max(60),
      soloProfesionales: z.boolean(),
    })
    .safeParse({
      titulo: formData.get("titulo"),
      descripcion: (formData.get("descripcion") as string) || undefined,
      categoria: (formData.get("categoria") as string) || "general",
      soloProfesionales: formData.get("soloProfesionales") === "on",
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const archivo = formData.get("archivo");

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: "Adjuntá el archivo." };
  }

  const formato = TIPOS.get(archivo.type);

  if (!formato) {
    return { error: "Subí un PDF, una planilla o una imagen." };
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const guardado = await guardarAdjunto(bytes, archivo.type, "tecnica");

  if (!guardado.url) {
    return { error: guardado.error ?? "No pudimos guardar el archivo." };
  }

  await db.insert(technicalDocuments).values({
    ...parsed.data,
    descripcion: parsed.data.descripcion ?? null,
    url: guardado.url,
    formato,
    tamanoBytes: archivo.size,
  });

  refrescar();

  return { ok: "Documento publicado." };
}

export async function cambiarVisibilidad(
  _previo: EstadoDocumento,
  formData: FormData,
): Promise<EstadoDocumento> {
  await requireStaff();

  const parsed = z
    .object({ id: z.string().uuid(), soloProfesionales: z.enum(["si", "no"]) })
    .safeParse({
      id: formData.get("id"),
      soloProfesionales: formData.get("soloProfesionales"),
    });

  if (!parsed.success) return { error: "Datos inválidos." };

  await db
    .update(technicalDocuments)
    .set({
      soloProfesionales: parsed.data.soloProfesionales === "si",
      updatedAt: new Date(),
    })
    .where(eq(technicalDocuments.id, parsed.data.id));

  refrescar();

  return {
    ok:
      parsed.data.soloProfesionales === "si"
        ? "Ahora solo lo ven los profesionales."
        : "Ahora lo ve cualquiera.",
  };
}

export async function borrarDocumento(
  _previo: EstadoDocumento,
  formData: FormData,
): Promise<EstadoDocumento> {
  await requireStaff();

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Documento inválido." };

  // Se da de baja en vez de borrarse: el archivo puede estar enlazado desde un
  // pliego o un correo, y una URL que deja de existir es un enlace roto en el
  // documento de otro.
  await db
    .update(technicalDocuments)
    .set({ activo: false, updatedAt: new Date() })
    .where(eq(technicalDocuments.id, id.data));

  refrescar();

  return { ok: "Documento dado de baja." };
}
