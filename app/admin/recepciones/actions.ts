"use server";

import { revalidatePath, updateTag } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { ETIQUETAS } from "@/lib/cache-publico";
import { buscarParaRecibir } from "@/lib/dal/admin/recepciones";

/*
 * Las recepciones de mercadería. Las carga, las confirma (entra el stock con
 * el candado de lib/inventario/locks.ts, se mezcla el costo y sube la deuda)
 * y las anula la API de Go (backend/internal/compras).
 */

export interface EstadoRecepcion {
  error?: string;
  ok?: string;
  id?: string;
}

export interface DatosRecepcion {
  supplierId: string;
  branchId: string;
  numeroRemito?: string;
  fecha?: string;
  gastos?: number;
  notas?: string;
  lineas: { variantId: string; cantidad: number; costoUnitario: number; alicuotaIva: number }[];
}

function refrescar(id?: string) {
  revalidatePath("/admin/recepciones");
  revalidatePath("/admin/stock");
  if (id) revalidatePath(`/admin/recepciones/${id}`);
}

/** Crea la recepción **en borrador**: no toca stock ni costo. */
export async function crearRecepcion(datos: DatosRecepcion): Promise<EstadoRecepcion> {
  const r = await (await api()).POST("/api/v1/admin/recepciones", { body: { ...datos } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  refrescar(r.data.id);
  return { ok: r.data.ok, id: r.data.id };
}

/** Confirmar: entra el stock, se mezcla el costo y sube la deuda. */
export async function confirmarRecepcion(id: string): Promise<EstadoRecepcion> {
  const r = await (await api()).POST("/api/v1/admin/recepciones/{id}/confirmar", { params: { path: { id } } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  // El stock cambió y el catálogo público muestra disponibilidad.
  updateTag(ETIQUETAS.catalogo);
  refrescar(id);
  return { ok: `Recepción confirmada: ${r.data.lineas} renglones, $${r.data.neto.toFixed(2)} netos.` };
}

export async function anularRecepcion(id: string, motivo: string): Promise<EstadoRecepcion> {
  const r = await (await api()).POST("/api/v1/admin/recepciones/{id}/anular", {
    params: { path: { id } },
    body: { motivo },
  });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined) };
  updateTag(ETIQUETAS.catalogo);
  refrescar(id);
  return { ok: "Recepción anulada. El stock volvió atrás; el costo promedio no se toca." };
}

/** Buscador del formulario de carga. */
export async function buscarMercaderia(texto: string) {
  return buscarParaRecibir(texto);
}
