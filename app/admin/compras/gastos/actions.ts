"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Los gastos del negocio. Los anota la API de Go (backend/internal/compras):
 * si es efectivo, también sale de la caja del turno que lo contiene.
 */

export interface EstadoGasto {
  error?: string;
  ok?: string;
  aviso?: string;
}

export interface DatosGasto {
  fecha: string;
  categoria: string;
  descripcion: string;
  importe: number;
  medio: "efectivo" | "transferencia" | "debito" | "credito" | "cheque";
  circuito?: "blanco" | "negro";
  branchId?: string;
  supplierId?: string;
  notas?: string;
  /** La factura del gasto: entra al libro IVA compras con su crédito fiscal. */
  factura?: { tipo: string; puntoVenta: number; numero: number; iva21: number; iva105: number; iva27: number };
}

export async function cargarGasto(datos: DatosGasto): Promise<EstadoGasto> {
  const r = await (await api()).POST("/api/v1/admin/compras/gastos", { body: { ...datos } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  revalidatePath("/admin/compras/gastos");
  revalidatePath("/admin/caja");
  revalidatePath("/admin/arca/libro-iva-compras");
  if (datos.supplierId) revalidatePath(`/admin/proveedores/${datos.supplierId}`);
  return { ok: r.data.ok, aviso: r.data.aviso };
}
