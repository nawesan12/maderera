"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { avisosEmail } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

export interface EstadoAvisoEmail {
  error?: string;
  ok?: string;
}

/** Prende o apaga un aviso por correo. */
export async function cambiarAvisoEmail(
  _previo: EstadoAvisoEmail,
  formData: FormData,
): Promise<EstadoAvisoEmail> {
  await requireStaff();

  const parsed = z
    .object({ id: z.string().uuid(), activo: z.enum(["si", "no"]) })
    .safeParse({ id: formData.get("id"), activo: formData.get("activo") });

  if (!parsed.success) return { error: "Datos inválidos." };

  await db
    .update(avisosEmail)
    .set({ activo: parsed.data.activo === "si", updatedAt: new Date() })
    .where(eq(avisosEmail.id, parsed.data.id));

  revalidatePath("/admin/avisos");

  return {
    ok: parsed.data.activo === "si" ? "Aviso activado." : "Aviso apagado.",
  };
}

/** Cambia el asunto y el encabezado de un aviso. */
export async function guardarTextoAvisoEmail(
  _previo: EstadoAvisoEmail,
  formData: FormData,
): Promise<EstadoAvisoEmail> {
  await requireStaff();

  const parsed = z
    .object({
      id: z.string().uuid(),
      // El asunto es lo que se ve en la bandeja antes de abrir; vacío hace que
      // el correo parezca spam.
      asunto: z.string().trim().min(3, "El asunto no puede quedar vacío.").max(120),
      encabezado: z.string().trim().max(160).optional(),
    })
    .safeParse({
      id: formData.get("id"),
      asunto: formData.get("asunto"),
      encabezado: (formData.get("encabezado") as string) || undefined,
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá el texto." };
  }

  await db
    .update(avisosEmail)
    .set({
      asunto: parsed.data.asunto,
      encabezado: parsed.data.encabezado ?? null,
      updatedAt: new Date(),
    })
    .where(eq(avisosEmail.id, parsed.data.id));

  revalidatePath("/admin/avisos");

  return { ok: "Texto guardado." };
}
