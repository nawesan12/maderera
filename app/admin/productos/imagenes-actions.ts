"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, comoFormulario, mensajeDe, type Problema } from "@/lib/api/servidor";

/* Las fotos del producto. Las guarda la API de Go (backend/internal/productos). */

export interface ResultadoImagen {
  error?: string;
  url?: string;
  id?: string;
}

function refrescar(productId?: string) {
  revalidatePath("/admin/productos");
  if (productId) revalidatePath(`/admin/productos/${productId}`);
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/catalogo");
}

export async function subirImagen(formData: FormData): Promise<ResultadoImagen> {
  const archivo = formData.get("archivo");
  const productId = formData.get("productId");
  if (!(archivo instanceof File)) return { error: "Elegí una imagen." };
  if (typeof productId !== "string" || !productId) return { error: "Falta el producto." };
  const datos = new FormData();
  datos.append("archivo", archivo);
  const r = await (await api()).POST("/api/v1/admin/productos/{id}/imagenes", {
    params: { path: { id: productId } },
    body: datos as never,
    ...comoFormulario,
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo guardar la imagen.") };
  refrescar(productId);
  return { url: r.data.url, id: r.data.id };
}

export async function eliminarImagen(imagenId: string): Promise<ResultadoImagen> {
  const r = await (await api()).DELETE("/api/v1/admin/imagenes/{id}", { params: { path: { id: imagenId } } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Esa imagen ya no está.") };
  refrescar(r.data.productId);
  return {};
}

export async function hacerPrincipal(imagenId: string): Promise<ResultadoImagen> {
  const r = await (await api()).POST("/api/v1/admin/imagenes/{id}/principal", { params: { path: { id: imagenId } } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Esa imagen ya no está.") };
  refrescar(r.data.productId);
  return {};
}
