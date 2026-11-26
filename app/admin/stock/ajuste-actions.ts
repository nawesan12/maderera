"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { leerCantidad } from "@/lib/unidades";

/*
 * El ajuste rápido de la grilla de stock: suma o resta en una sucursal. Lo
 * hace la API de Go (backend/internal/stock), con el candado del stock y su
 * movimiento.
 */

export interface EstadoAjuste {
  error?: string;
  ok?: string;
}

export type MotivoDeAjuste =
  | "ingreso"
  | "rotura"
  | "conteo"
  | "devolucion"
  | "faltante"
  | "correccion"
  | "otro"
  | "taller"
  | "reposicion";

/**
 * Suma o resta `cantidad`. Con `contado`, deja el galpón en ese número: la
 * diferencia la calcula Go con el candado tomado. `pedido` es el PED- de una
 * reposición a un cliente.
 */
export async function ajustarStock(
  variantId: string,
  branchSlug: string,
  cantidad: number,
  extra: { contado?: number; motivo?: MotivoDeAjuste; pedido?: string } = {},
): Promise<EstadoAjuste> {
  const n = leerCantidad(cantidad);
  if (!Number.isFinite(n)) return { error: "La cantidad tiene que ser un número, sin letras." };
  if (extra.contado !== undefined && !(Number.isFinite(extra.contado) && extra.contado >= 0)) {
    return { error: "Lo contado tiene que ser un número, cero o más." };
  }
  const r = await (await api()).POST("/api/v1/admin/stock/ajuste", { body: { variantId, branchSlug, cantidad: n, ...extra } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "La cantidad tiene que ser un número, sin letras.") };
  if (!r.data.ok) return {};
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/admin/stock");
  revalidatePath("/admin");
  revalidatePath("/catalogo");
  revalidatePath("/stock");
  if (extra.pedido) revalidatePath("/admin/pedidos", "layout");
  return { ok: r.data.ok };
}
