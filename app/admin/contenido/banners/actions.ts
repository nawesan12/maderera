"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, comoFormulario, mensajeDe, soloCampos, type Problema } from "@/lib/api/servidor";

/*
 * Los banners del sitio. Los guarda la API de Go (backend/internal/contenido)
 * con su imagen y su línea en la bitácora; acá queda revalidar.
 */

export interface EstadoBanner {
  error?: string;
  ok?: string;
}

function refrescar() {
  updateTag(ETIQUETAS.contenido);
  revalidatePath("/admin/contenido/banners");
  revalidatePath("/");
  revalidatePath("/catalogo");
}

export async function guardarBanner(_previo: EstadoBanner, formData: FormData): Promise<EstadoBanner> {
  const id = String(formData.get("id") ?? "");
  const cliente = await api();
  const r = id
    ? await cliente.PUT("/api/v1/admin/contenido/banners/{id}", { params: { path: { id } }, body: soloCampos(formData) as never, ...comoFormulario })
    : await cliente.POST("/api/v1/admin/contenido/banners", { body: soloCampos(formData) as never, ...comoFormulario });
  if (r.error) return { error: mensajeDe(r.error as Problema, "Revisá los datos.") };
  refrescar();
  return { ok: "Banner guardado." };
}

export async function borrarBanner(id: string): Promise<EstadoBanner> {
  const r = await (await api()).DELETE("/api/v1/admin/contenido/banners/{id}", { params: { path: { id } } });
  if (r.error) return { error: mensajeDe(r.error as Problema, "Ese banner ya no está.") };
  refrescar();
  return { ok: "Banner borrado." };
}
