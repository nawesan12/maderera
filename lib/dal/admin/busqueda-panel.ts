import "server-only";

import { api, datos } from "@/lib/api/servidor";

/*
 * El buscador del panel lo resuelve la API de Go (backend/internal/buscador):
 * clientes, pedidos, presupuestos, comprobantes, cortes y proveedores, solo
 * de las pantallas a las que entra el rol.
 */

export interface ResultadoDePanel {
  id: string;
  tipo: string;
  titulo: string;
  detalle: string;
  href: string;
}

export async function buscarEnElPanel(termino: string): Promise<ResultadoDePanel[]> {
  const q = termino.trim().slice(0, 120);
  if (q.length < 2) return [];
  return datos(await (await api()).GET("/api/v1/admin/buscar", { params: { query: { q } } }));
}
