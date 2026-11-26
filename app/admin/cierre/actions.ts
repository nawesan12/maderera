"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

export interface EstadoDelCierre {
  error?: string;
}

/**
 * Cierra o reabre el mes. El candado lo pone la base (backend/db/migraciones/
 * 00221): con el mes cerrado no se carga, cambia ni borra nada con fecha de
 * ese mes, así lo que tiene el estudio no cambia.
 */
export async function cerrarElMes(_previo: EstadoDelCierre, formData: FormData): Promise<EstadoDelCierre> {
  const periodo = String(formData.get("periodo") ?? "");
  if (!/^\d{4}-\d{2}$/.test(periodo)) return { error: "No entendimos el mes." };
  const cerrado = formData.get("cerrado") === "si";
  const r = await (await api()).POST("/api/v1/admin/cierre/cerrado", { body: { periodo, cerrado } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  revalidatePath("/admin/cierre");
  return {};
}
