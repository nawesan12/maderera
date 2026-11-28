"use server";

import { buscarEnElPanel } from "@/lib/dal/admin/busqueda-panel";
import { requireStaff } from "@/lib/dal/session";

export interface ResultadoBusqueda {
  id: string;
  tipo: string;
  titulo: string;
  detalle: string;
  href: string;
}

/**
 * El buscador del encabezado (⌘K).
 *
 * Clientes, pedidos, presupuestos, comprobantes, recibos, remitos, cheques,
 * productos, cortes y proveedores: quien atiende escribe el apellido o el
 * número que le están dictando y llega, sin tener que saber en qué sección
 * vive esa cosa. Lo busca todo Go (`backend/internal/buscador`), los
 * productos también: Next los buscaba solo por el nombre, sin el código ni
 * la medida (mes simulado, M2S1-087).
 */
export async function buscarEnPanel(
  termino: string,
): Promise<ResultadoBusqueda[]> {
  const texto = termino.trim();
  if (texto.length < 2) return [];

  await requireStaff();
  return buscarEnElPanel(texto);
}
