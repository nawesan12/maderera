"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Las facturas de compra. Las carga la API de Go (backend/internal/compras):
 * la factura y la deuda en el mismo acto, y el total sumado, no tipeado.
 */

export interface EstadoFacturaCompra {
  error?: string;
  ok?: string;
  id?: string;
}

export interface DatosFacturaCompra {
  supplierId: string;
  tipo: string;
  puntoVenta: number;
  numero: number;
  fechaEmision: string;
  cae?: string;
  neto: number;
  iva21: number;
  iva105: number;
  iva27: number;
  exento: number;
  percepciones: number;
  observaciones?: string;
}

export async function cargarFacturaDeCompra(datos: DatosFacturaCompra): Promise<EstadoFacturaCompra> {
  const r = await (await api()).POST("/api/v1/admin/compras/facturas", { body: { ...datos } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  revalidatePath("/admin/compras/facturas");
  revalidatePath("/admin/arca/libro-iva-compras");
  revalidatePath(`/admin/proveedores/${r.data.supplierId}`);
  return { ok: r.data.ok, id: r.data.id };
}
