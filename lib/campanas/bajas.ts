import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bajasDeCorreo } from "@/lib/db/schema";
import { normalizarCorreo } from "./baja";

/** Ver `bajas_de_correo`: la baja es por dirección y no vence. */
export async function darDeBaja(email: string, origen: "enlace" | "cuenta" | "panel"): Promise<void> {
  await db
    .insert(bajasDeCorreo)
    .values({ email: normalizarCorreo(email), origen })
    .onConflictDoNothing();
}

export async function volverARecibir(email: string): Promise<void> {
  await db.delete(bajasDeCorreo).where(eq(bajasDeCorreo.email, normalizarCorreo(email)));
}

export async function estaDadoDeBaja(email: string): Promise<boolean> {
  const [fila] = await db
    .select({ email: bajasDeCorreo.email })
    .from(bajasDeCorreo)
    .where(eq(bajasDeCorreo.email, normalizarCorreo(email)))
    .limit(1);
  return Boolean(fila);
}
