"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { buscarParaRecibir } from "@/lib/dal/admin/recepciones";

/*
 * Las órdenes de compra. Las crea, las numera (OC-n, con candado) y las
 * mueve la API de Go (backend/internal/compras).
 */

export interface EstadoOrden {
  error?: string;
  ok?: string;
  id?: string;
}

export interface DatosOrden {
  supplierId: string;
  branchId: string;
  fechaPrometida?: string;
  notas?: string;
  lineas: { variantId: string; descripcion: string; cantidad: number; costoUnitario: number; alicuotaIva: number }[];
}

function refrescar(id?: string) {
  revalidatePath("/admin/compras/ordenes");
  revalidatePath("/admin/recepciones");
  if (id) revalidatePath(`/admin/compras/ordenes/${id}`);
}

export async function crearOrdenDeCompra(datos: DatosOrden): Promise<EstadoOrden> {
  const r = await (await api()).POST("/api/v1/admin/compras/ordenes", { body: { ...datos } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  refrescar(r.data.id);
  return { ok: r.data.ok, id: r.data.id };
}

/** Marca la orden como enviada al proveedor: desde acá cuenta en lo pendiente. */
export async function marcarOrdenEnviada(id: string): Promise<EstadoOrden> {
  const r = await (await api()).POST("/api/v1/admin/compras/ordenes/{id}/enviada", { params: { path: { id } } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  refrescar(id);
  return { ok: r.data.ok };
}

export async function anularOrdenDeCompra(id: string, motivo: string): Promise<EstadoOrden> {
  const r = await (await api()).POST("/api/v1/admin/compras/ordenes/{id}/anular", {
    params: { path: { id } },
    body: { motivo },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  refrescar(id);
  return { ok: r.data.ok };
}

/** Crea una recepción en borrador con lo que falta de la orden. */
export async function recibirDeLaOrden(purchaseOrderId: string, numeroRemito: string): Promise<EstadoOrden> {
  const r = await (await api()).POST("/api/v1/admin/compras/ordenes/{id}/recibir", {
    params: { path: { id: purchaseOrderId } },
    body: { numeroRemito },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  refrescar(purchaseOrderId);
  revalidatePath(`/admin/recepciones/${r.data.id}`);
  return { ok: r.data.ok, id: r.data.id };
}

/** El mismo buscador que usa la carga de recepciones. */
export async function buscarParaPedir(texto: string) {
  return buscarParaRecibir(texto);
}
