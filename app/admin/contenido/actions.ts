"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Los ajustes del sitio y la moderación de reseñas. Los hace la API de Go
 * (backend/internal/contenido), que exige el rol del admin; acá queda volver
 * a armar lo que Next tiene guardado.
 */

export interface EstadoContenido {
  error?: string;
  ok?: string;
}

function refrescar() {
  updateTag(ETIQUETAS.ajustes);
  updateTag(ETIQUETAS.contenido);
  revalidatePath("/admin/contenido");
  revalidatePath("/");
}

export async function guardarAjuste(_previo: EstadoContenido, formData: FormData): Promise<EstadoContenido> {
  const clave = String(formData.get("clave") ?? "");
  const r = await (await api()).PUT("/api/v1/admin/contenido/ajustes/{clave}", {
    params: { path: { clave } },
    body: { valor: String(formData.get("valor") ?? "") },
  });
  if (r.error) return { error: mensajeDe(r.error as Problema, "No se pudo guardar.") };
  refrescar();
  return { ok: "Guardado." };
}

export async function moderarResena(_previo: EstadoContenido, formData: FormData): Promise<EstadoContenido> {
  const estado = String(formData.get("estado") ?? "") as "publicada" | "rechazada" | "pendiente";
  const motivo = String(formData.get("motivo") ?? "").trim();
  const r = await (await api()).POST("/api/v1/admin/contenido/resenas/{id}/moderar", {
    params: { path: { id: String(formData.get("id") ?? "") } },
    body: { estado, ...(motivo ? { motivo } : {}) },
  });
  if (!r.data) {
    return {
      error: mensajeDe(r.error as Problema, "No pudimos identificar esa reseña. Recargá la pantalla y probá de nuevo."),
    };
  }
  refrescar();
  if (r.data.slug) revalidatePath(`/catalogo/${r.data.slug}`);
  updateTag(ETIQUETAS.catalogo);
  return {
    ok:
      estado === "publicada"
        ? "Reseña publicada."
        : estado === "rechazada"
          ? "Reseña rechazada. No se muestra en el sitio."
          : "Reseña vuelta a pendiente.",
  };
}
