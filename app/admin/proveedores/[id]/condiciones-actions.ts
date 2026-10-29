"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Las condiciones de pago y los convenios del proveedor. Los guarda la API de
 * Go (backend/internal/compras).
 */

export interface EstadoCondicion {
  error?: string;
  ok?: string;
}

/** Los campos de un FormData como texto, sin los que agrega Next. */
function comoTexto(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [clave, valor] of formData) {
    if (!clave.startsWith("$") && typeof valor === "string") out[clave] = valor;
  }
  return out;
}

/** Una condición de pago del proveedor, por escrito. */
export async function guardarCondicion(_previo: EstadoCondicion, formData: FormData): Promise<EstadoCondicion> {
  const { supplierId = "", ...campos } = comoTexto(formData);
  const r = await (await api()).POST("/api/v1/admin/proveedores/{id}/condiciones", {
    params: { path: { id: supplierId } },
    body: campos,
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  revalidatePath(`/admin/proveedores/${supplierId}`);
  return { ok: r.data.ok };
}

export async function borrarCondicion(id: string, supplierId: string): Promise<EstadoCondicion> {
  const r = await (await api()).DELETE("/api/v1/admin/proveedores/{id}/condiciones/{condicion}", {
    params: { path: { id: supplierId, condicion: id } },
  });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined) };
  revalidatePath(`/admin/proveedores/${supplierId}`);
  return { ok: "Borrada." };
}

/** Los convenios en prosa: lo pactado que no entra en una fila. */
export async function guardarConvenios(supplierId: string, convenios: string): Promise<EstadoCondicion> {
  const r = await (await api()).PUT("/api/v1/admin/proveedores/{id}/convenios", {
    params: { path: { id: supplierId } },
    body: { convenios },
  });
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined) };
  revalidatePath(`/admin/proveedores/${supplierId}`);
  return { ok: "Convenios guardados." };
}
