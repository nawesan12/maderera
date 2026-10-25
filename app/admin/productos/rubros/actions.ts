"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/* Los rubros del catálogo. Los guarda la API de Go (backend/internal/productos). */

export interface EstadoRubros {
  error?: string;
  ok?: string;
}

function refrescar() {
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/admin/productos/rubros");
  revalidatePath("/admin/productos");
  revalidatePath("/catalogo");
}

export async function guardarRubro(_previo: EstadoRubros, formData: FormData): Promise<EstadoRubros> {
  const r = await (await api()).POST("/api/v1/admin/rubros", {
    body: { categoryId: String(formData.get("categoryId") ?? ""), name: String(formData.get("name") ?? "") },
  });
  if (r.error) return { error: mensajeDe(r.error as Problema, "Revisá los datos.") };
  refrescar();
  return { ok: "Rubro agregado." };
}

export async function alternarRubro(_previo: EstadoRubros, formData: FormData): Promise<EstadoRubros> {
  const activo = formData.get("activo") === "si";
  const r = await (await api()).POST("/api/v1/admin/rubros/{id}/activo", {
    params: { path: { id: String(formData.get("id") ?? "") } },
    body: { activo },
  });
  if (r.response.status === 400) return { error: "Revisá el nombre del rubro: no puede quedar vacío." };
  if (r.error) return { error: mensajeDe(r.error as Problema, "Ese rubro no existe.") };
  refrescar();
  return { ok: activo ? "Rubro reactivado." : "Rubro dado de baja." };
}

export async function engancharPorTexto(_previo: EstadoRubros, formData: FormData): Promise<EstadoRubros> {
  const r = await (await api()).POST("/api/v1/admin/rubros/{id}/enganchar", {
    params: { path: { id: String(formData.get("id") ?? "") } },
  });
  if (!r.data) return { error: "Ese rubro ya no existe." };
  refrescar();
  return { ok: r.data.ok };
}
