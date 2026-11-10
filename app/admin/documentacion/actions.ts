"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, comoFormulario, mensajeDe, soloCampos, type Problema } from "@/lib/api/servidor";

/*
 * La documentación técnica. La guarda la API de Go
 * (backend/internal/contenido/documentos.go): valida el tipo y la firma del
 * archivo, lo sube y deja la línea en la bitácora. Acá queda revalidar.
 */

export interface EstadoDocumento {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/admin/documentacion");
  revalidatePath("/documentacion");
  revalidatePath("/profesionales");
}

export async function subirDocumento(_previo: EstadoDocumento, formData: FormData): Promise<EstadoDocumento> {
  const r = await (await api()).POST("/api/v1/admin/documentos", {
    body: soloCampos(formData) as never,
    ...comoFormulario,
  });
  if (r.error) return { error: mensajeDe(r.error as Problema, "Revisá los datos.") };
  refrescar();
  return { ok: "Documento publicado." };
}

export async function cambiarVisibilidad(_previo: EstadoDocumento, formData: FormData): Promise<EstadoDocumento> {
  const soloProfesionales = formData.get("soloProfesionales") === "si";
  const r = await (await api()).POST("/api/v1/admin/documentos/{id}/visibilidad", {
    params: { path: { id: String(formData.get("id") ?? "") } },
    body: { soloProfesionales },
  });
  if (r.error) {
    return { error: mensajeDe(r.error as Problema, "No pudimos identificar ese documento. Recargá la pantalla y probá de nuevo.") };
  }
  refrescar();
  return { ok: soloProfesionales ? "Ahora solo lo ven los profesionales." : "Ahora lo ve cualquiera." };
}

async function activar(formData: FormData, activo: boolean, ok: string): Promise<EstadoDocumento> {
  const r = await (await api()).POST("/api/v1/admin/documentos/{id}/activo", {
    params: { path: { id: String(formData.get("id") ?? "") } },
    body: { activo },
  });
  if (r.error) {
    return { error: mensajeDe(r.error as Problema, "No encontramos ese documento. Puede que ya lo hayan dado de baja.") };
  }
  refrescar();
  return { ok };
}

export async function borrarDocumento(_previo: EstadoDocumento, formData: FormData): Promise<EstadoDocumento> {
  return activar(formData, false, "Documento dado de baja.");
}

export async function restaurarDocumento(_previo: EstadoDocumento, formData: FormData): Promise<EstadoDocumento> {
  return activar(formData, true, "El documento vuelve a estar en línea.");
}

/**
 * A qué productos y categorías se ata un documento: la ficha de cada uno lo
 * muestra. La ficha sale de la caché del catálogo, así que se invalida.
 */
export async function guardarDestinos(
  id: string,
  productos: string[],
  categorias: string[],
): Promise<EstadoDocumento> {
  const r = await (await api()).PUT("/api/v1/admin/documentos/{id}/destinos", {
    params: { path: { id } },
    body: { productos, categorias },
  });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo guardar.") };
  refrescar();
  updateTag(ETIQUETAS.catalogo);
  return { ok: "Guardado." };
}

/** Productos por nombre, para atarles un documento. */
export async function buscarProductosParaDocumento(consulta: string): Promise<{ id: string; nombre: string }[]> {
  const q = consulta.trim().slice(0, 80);
  if (q.length < 2) return [];
  const r = await (await api()).GET("/api/v1/admin/productos", { params: { query: { busqueda: q } } });
  return (r.data ?? []).slice(0, 12).map((p) => ({ id: p.id, nombre: p.name }));
}
