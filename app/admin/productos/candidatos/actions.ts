"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/**
 * Cambia desde cuántos meses sin venta se señala un producto. Solo el admin,
 * y queda en la bitácora (lo hace la API de Go): es un parámetro que cambia
 * qué ve todo el equipo en esta pantalla.
 */
export async function cambiarMesesSinVender(meses: number) {
  if (!Number.isInteger(meses)) return { error: "Poné un número de meses entre 1 y 60." };
  const r = await (await api()).PUT("/api/v1/admin/productos-candidatos", { body: { meses } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Poné un número de meses entre 1 y 60.") };
  revalidatePath("/admin/productos/candidatos");
  return { ok: r.data.ok };
}
