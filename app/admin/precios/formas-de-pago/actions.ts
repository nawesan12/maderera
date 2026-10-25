"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/* Los escalones de descuento por medio de pago. Los guarda la API de Go (solo el admin). */

export interface EstadoDescuento {
  error?: string;
  ok?: string;
}

export async function guardarDescuentoDePago(_previo: EstadoDescuento, formData: FormData): Promise<EstadoDescuento> {
  const id = String(formData.get("id") ?? "");
  const r = await (await api()).POST("/api/v1/admin/precios/descuentos", {
    body: {
      ...(id ? { id } : {}),
      medio: String(formData.get("medio") ?? ""),
      desdeMonto: String(formData.get("desdeMonto") ?? "") || "0",
      porcentaje: String(formData.get("porcentaje") ?? ""),
      etiqueta: String(formData.get("etiqueta") ?? ""),
      activo: formData.get("activo") === "on",
    },
  });
  if (r.error) return { error: mensajeDe(r.error as Problema, "Revisá los datos.") };
  updateTag(ETIQUETAS.contenido);
  revalidatePath("/admin/precios/formas-de-pago");
  revalidatePath("/carrito/confirmar");
  revalidatePath("/");
  return { ok: "Descuento guardado." };
}
