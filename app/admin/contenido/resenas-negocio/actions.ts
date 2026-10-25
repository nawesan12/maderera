"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Las reseñas del negocio. Las guarda la API de Go
 * (backend/internal/contenido/negocio.go) con su línea en la bitácora; acá
 * queda revalidar.
 */

export interface EstadoResena {
  error?: string;
  ok?: string;
}

function refrescar() {
  updateTag(ETIQUETAS.contenido);
  revalidatePath("/admin/contenido/resenas-negocio");
  revalidatePath("/");
}

export async function guardarResenaDelNegocio(_previo: EstadoResena, formData: FormData): Promise<EstadoResena> {
  const id = String(formData.get("id") ?? "");
  const fecha = String(formData.get("fecha") ?? "").trim();
  const body = {
    autor: String(formData.get("autor") ?? ""),
    estrellas: Number(formData.get("estrellas") ?? 5),
    texto: String(formData.get("texto") ?? ""),
    publicada: formData.get("publicada") === "on",
    ...(fecha ? { fecha } : {}),
  };
  const cliente = await api();
  const r = id
    ? await cliente.PUT("/api/v1/admin/contenido/negocio/{id}", { params: { path: { id } }, body })
    : await cliente.POST("/api/v1/admin/contenido/negocio", { body });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  refrescar();
  return { ok: r.data.publicada ? "Publicada." : "Guardada, sin publicar." };
}

export async function publicarResena(id: string, publicada: boolean): Promise<EstadoResena> {
  const r = await (await api()).POST("/api/v1/admin/contenido/negocio/{id}/publicar", {
    params: { path: { id } },
    body: { publicada },
  });
  if (r.error) return { error: "No se pudo actualizar." };
  refrescar();
  return { ok: publicada ? "Publicada." : "Sacada del sitio." };
}

export async function borrarResenaDelNegocio(id: string): Promise<EstadoResena> {
  const r = await (await api()).DELETE("/api/v1/admin/contenido/negocio/{id}", { params: { path: { id } } });
  if (!r.response.ok) return { error: "No se pudo borrar." };
  refrescar();
  return { ok: "Borrada." };
}

export async function traerDeGoogle(): Promise<EstadoResena> {
  const r = await (await api()).POST("/api/v1/admin/contenido/negocio/google");
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo hablar con Google.") };
  refrescar();
  const { nuevas, traidas } = r.data;
  return {
    ok:
      nuevas > 0
        ? `Llegaron ${nuevas} reseñas nuevas. Revisalas y publicá las que quieras mostrar.`
        : `Google devolvió ${traidas} reseñas y ya estaban todas cargadas.`,
  };
}
