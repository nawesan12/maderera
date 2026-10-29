"use server";

import { revalidatePath, updateTag } from "next/cache";
import { api, comoFormulario, mensajeDe, soloCampos, type Problema } from "@/lib/api/servidor";
import { ETIQUETAS } from "@/lib/cache-publico";

/*
 * La lista de precios de un proveedor: la planilla que mande cada uno, leída
 * con su perfil. Lee, aparea y aplica la API de Go (backend/internal/compras,
 * con el lector de internal/planilla).
 */

export interface FilaPrevia {
  codigo: string;
  descripcion: string;
  costo: number;
  precioSugerido: number;
  /** A qué variante nuestra corresponde. Null si no se pudo aparear. */
  variantId: string | null;
  nuestro: string | null;
  precioActual: number | null;
}

export interface VistaPreviaProveedor {
  filas: FilaPrevia[];
  problemas: { fila: number; motivo: string }[];
  /** Cuántas se van a actualizar y cuántas quedan sin aparear. */
  apareadas: number;
  sinAparear: number;
  /** Los encabezados que trae el archivo, para poder armar el perfil. */
  columnas: string[];
  error?: string;
}

/** Lee el archivo del proveedor y muestra qué va a pasar, sin tocar nada. */
export async function previsualizarLista(formData: FormData): Promise<VistaPreviaProveedor> {
  const r = await (await api()).POST("/api/v1/admin/compras/lista-proveedor/vista-previa", {
    body: soloCampos(formData) as never,
    ...comoFormulario,
  });
  if (!r.data) {
    return {
      filas: [],
      problemas: [],
      apareadas: 0,
      sinAparear: 0,
      columnas: [],
      error: mensajeDe(r.error as Problema | undefined),
    };
  }
  return r.data;
}

export interface EstadoLista {
  error?: string;
  ok?: string;
}

/** Aplica la lista: guarda el perfil, los códigos y los precios nuevos. */
export async function aplicarLista(_previo: EstadoLista, formData: FormData): Promise<EstadoLista> {
  const campos: Record<string, string> = {};
  for (const [clave, valor] of formData) {
    if (!clave.startsWith("$") && typeof valor === "string") campos[clave] = valor;
  }
  const r = await (await api()).POST("/api/v1/admin/compras/lista-proveedor/aplicar", { body: campos });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá el perfil.") };
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/admin/precios");
  revalidatePath(`/admin/proveedores/${r.data.supplierId}`);
  return { ok: r.data.ok };
}
