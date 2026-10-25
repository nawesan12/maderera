"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, comoFormulario, mensajeDe, soloCampos, type Problema } from "@/lib/api/servidor";

/*
 * Las promociones bancarias. Las guarda la API de Go
 * (backend/internal/contenido) con su logo y su línea en la bitácora; acá
 * queda revalidar.
 */

export interface EstadoPromo {
  error?: string;
  ok?: string;
}

function refrescar() {
  updateTag(ETIQUETAS.contenido);
  revalidatePath("/admin/contenido/promociones");
  revalidatePath("/");
}

export async function guardarPromo(_previo: EstadoPromo, formData: FormData): Promise<EstadoPromo> {
  const id = String(formData.get("id") ?? "");
  const cliente = await api();
  const r = id
    ? await cliente.PUT("/api/v1/admin/contenido/promos/{id}", { params: { path: { id } }, body: soloCampos(formData) as never, ...comoFormulario })
    : await cliente.POST("/api/v1/admin/contenido/promos", { body: soloCampos(formData) as never, ...comoFormulario });
  if (r.error) return { error: mensajeDe(r.error as Problema, "Revisá los datos.") };
  refrescar();
  return { ok: "Promoción guardada." };
}

export async function borrarPromo(id: string): Promise<EstadoPromo> {
  const r = await (await api()).DELETE("/api/v1/admin/contenido/promos/{id}", { params: { path: { id } } });
  if (r.error) return { error: mensajeDe(r.error as Problema, "Esa promoción ya no está.") };
  refrescar();
  return { ok: "Promoción borrada." };
}
