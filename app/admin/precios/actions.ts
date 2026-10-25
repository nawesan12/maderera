"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, comoFormulario, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Los precios del panel. Los cambia la API de Go (backend/internal/precios):
 * cada cambio queda en el historial (los masivos y las importaciones, en un
 * lote), y la planilla se lee y se compara con la base allá. Acá queda pasar
 * los formularios y revalidar.
 */

export interface EstadoPrecios {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/admin/precios");
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/catalogo");
}

const texto = (formData: FormData, campo: string) => String(formData.get(campo) ?? "");

export async function editarPrecio(_previo: EstadoPrecios, formData: FormData): Promise<EstadoPrecios> {
  const r = await (await api()).POST("/api/v1/admin/precios/editar", {
    body: { variantId: texto(formData, "variantId"), priceListId: texto(formData, "priceListId"), precio: texto(formData, "precio") },
  });
  if (r.error) return { error: mensajeDe(r.error as Problema, "Revisá el precio.") };
  refrescar();
  return { ok: "Precio actualizado." };
}

export async function ajustarPrecios(_previo: EstadoPrecios, formData: FormData): Promise<EstadoPrecios> {
  const r = await (await api()).POST("/api/v1/admin/precios/ajuste", {
    body: {
      porcentaje: texto(formData, "porcentaje"),
      categoria: texto(formData, "categoria"),
      rubro: texto(formData, "rubro"),
      listaSlug: texto(formData, "listaSlug") || "ambas",
      base: texto(formData, "base") || "precio",
      redondeo: texto(formData, "redondeo") || "ninguno",
      motivo: texto(formData, "motivo"),
    },
  });
  // «No se encontraron precios» llega como 422, pero el ajuste ya corrió:
  // se revalida igual.
  refrescar();
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  return { ok: r.data.ok };
}

export interface FilaPrevia {
  linea: number;
  sku: string;
  producto?: string;
  medida?: string;
  generalActual?: string;
  generalNuevo?: string;
  profesionalActual?: string;
  profesionalNuevo?: string;
  estado: "cambia" | "igual" | "sin-sku" | "error";
  detalle?: string;
}

export interface VistaPreviaImportacion {
  filas: FilaPrevia[];
  cambian: number;
  iguales: number;
  problemas: number;
  error?: string;
}

export async function previsualizarImportacion(formData: FormData): Promise<VistaPreviaImportacion> {
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { filas: [], cambian: 0, iguales: 0, problemas: 0, error: "Elegí un archivo." };
  }
  const datos = new FormData();
  datos.append("archivo", archivo);
  const r = await (await api()).POST("/api/v1/admin/precios/importar/previa", { body: datos as never, ...comoFormulario });
  if (!r.data) {
    return { filas: [], cambian: 0, iguales: 0, problemas: 0, error: mensajeDe(r.error as Problema | undefined, "No se pudo leer la planilla.") };
  }
  return r.data;
}

export async function confirmarImportacion(_previo: EstadoPrecios, formData: FormData): Promise<EstadoPrecios> {
  const crudo = formData.get("cambios");
  if (typeof crudo !== "string" || crudo.length === 0) return { error: "No hay cambios para aplicar." };
  let cambios: { sku: string; generalNuevo?: string; profesionalNuevo?: string }[];
  try {
    cambios = JSON.parse(crudo);
  } catch {
    return { error: "No hay cambios para aplicar." };
  }
  if (!Array.isArray(cambios) || cambios.length === 0) return { error: "No hay cambios para aplicar." };
  const r = await (await api()).POST("/api/v1/admin/precios/importar", { body: { cambios } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No hay cambios para aplicar.") };
  refrescar();
  return { ok: r.data.ok };
}
