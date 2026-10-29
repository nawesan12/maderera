"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/* Los vendedores de salón y de calle. Los guarda la API de Go (backend/internal/clientes). */

export interface EstadoVendedor {
  error?: string;
  ok?: string;
}

export async function guardarVendedor(_previo: EstadoVendedor, formData: FormData): Promise<EstadoVendedor> {
  const r = await (await api()).POST("/api/v1/admin/vendedores", {
    body: {
      id: (formData.get("id") as string | null) || undefined,
      nombre: (formData.get("nombre") as string | null) ?? "",
      tipo: (formData.get("tipo") as string | null) ?? undefined,
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  revalidatePath("/admin/clientes/vendedores");
  return { ok: r.data.ok };
}

export async function alternarVendedor(id: string): Promise<EstadoVendedor> {
  const r = await (await api()).POST("/api/v1/admin/vendedores/{id}/alternar", { params: { path: { id } } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Ese vendedor ya no está.") };
  revalidatePath("/admin/clientes/vendedores");
  return { ok: r.data.ok };
}
