"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { listarStock } from "@/lib/dal/admin/inventory";

/*
 * La transferencia entre sucursales. La hace la API de Go
 * (backend/internal/stock): toma el candado de las dos sucursales y controla
 * contra lo disponible, sin mover lo reservado para clientes.
 */

export interface EstadoTransferencia {
  error?: string;
  ok?: string;
}

export async function transferirStock(_previo: EstadoTransferencia, formData: FormData): Promise<EstadoTransferencia> {
  const nota = String(formData.get("nota") ?? "");
  const r = await (await api()).POST("/api/v1/admin/stock/transferencia", {
    body: {
      variantId: String(formData.get("variantId") ?? ""),
      origenId: String(formData.get("origenId") ?? ""),
      destinoId: String(formData.get("destinoId") ?? ""),
      cantidad: String(formData.get("cantidad") ?? ""),
      ...(nota ? { nota } : {}),
    },
  });
  if (!r.response.ok) {
    return { error: mensajeDe(r.error as Problema | undefined, "No se pudo registrar la transferencia.") };
  }
  revalidatePath("/admin/stock");
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/stock");
  revalidatePath("/catalogo");
  return { ok: "Transferencia registrada." };
}

/** Una medida encontrada por nombre, medida o código. */
export interface MedidaEncontrada {
  id: string;
  producto: string;
  medida: string;
  sku: string;
  codigo: string;
}

/**
 * Buscar medidas para elegirlas (la transferencia, las etiquetas). Antes la
 * pantalla mandaba al navegador el catálogo entero y filtraba ahí; con miles
 * de medidas, la búsqueda la hace Go y vuelve solo lo que coincide.
 */
export async function buscarMedidas(texto: string): Promise<MedidaEncontrada[]> {
  const busqueda = texto.trim().slice(0, 200);
  if (busqueda.length < 2) return [];
  const { filas } = await listarStock({ busqueda }, 12);
  return filas.map((f) => ({
    id: f.variantId,
    producto: f.productName,
    medida: f.label,
    sku: f.sku,
    codigo: f.codigoBarras ?? f.sku,
  }));
}
