"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { avisosWhatsapp } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";

export interface EstadoAviso {
  error?: string;
  ok?: string;
}

/**
 * Prende o apaga un aviso automático.
 *
 * Solo administración: cada aviso que se prende le manda mensajes a todos los
 * clientes que lleguen a ese estado, y fuera de la ventana de 24 h cada uno es
 * una conversación que Meta factura. No es una preferencia de pantalla.
 */
export async function cambiarAviso(
  _previo: EstadoAviso,
  formData: FormData,
): Promise<EstadoAviso> {
  await requireStaffRole("admin");

  const parsed = z
    .object({
      id: z.string().uuid(),
      activo: z.enum(["si", "no"]),
    })
    .safeParse({
      id: formData.get("id"),
      activo: formData.get("activo"),
    });

  if (!parsed.success) return { error: "No pudimos cambiar el aviso." };

  await db
    .update(avisosWhatsapp)
    .set({ activo: parsed.data.activo === "si", updatedAt: new Date() })
    .where(eq(avisosWhatsapp.id, parsed.data.id));

  revalidatePath("/admin/whatsapp/configuracion");

  return {
    ok:
      parsed.data.activo === "si"
        ? "Aviso activado."
        : "Aviso desactivado.",
  };
}

/** Edita el texto que se manda dentro de la ventana de 24 h. */
export async function guardarTextoAviso(
  _previo: EstadoAviso,
  formData: FormData,
): Promise<EstadoAviso> {
  await requireStaffRole("admin");

  const parsed = z
    .object({
      id: z.string().uuid(),
      textoLibre: z.string().trim().max(1000),
    })
    .safeParse({
      id: formData.get("id"),
      textoLibre: formData.get("textoLibre"),
    });

  if (!parsed.success) return { error: "Revisá el texto." };

  await db
    .update(avisosWhatsapp)
    .set({
      textoLibre: parsed.data.textoLibre || null,
      updatedAt: new Date(),
    })
    .where(eq(avisosWhatsapp.id, parsed.data.id));

  revalidatePath("/admin/whatsapp/configuracion");
  return { ok: "Texto guardado." };
}
