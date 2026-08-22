"use server";

import { listarProductosAdmin } from "@/lib/dal/admin/products";

export interface ResultadoBusqueda {
  id: string;
  titulo: string;
  detalle: string;
  href: string;
}

/**
 * Busca productos para el buscador del encabezado.
 *
 * Hoy solo mira el catálogo. Cuando pedidos, presupuestos y clientes dejen de
 * ser datos de ejemplo, se suman acá y el resultado pasa a agruparse por tipo.
 */
export async function buscarEnPanel(
  termino: string,
): Promise<ResultadoBusqueda[]> {
  const texto = termino.trim();
  if (texto.length < 2) return [];

  const productos = await listarProductosAdmin({ busqueda: texto });

  return productos.slice(0, 8).map((p) => ({
    id: p.id,
    titulo: p.name,
    detalle: [p.categoryName, p.brand, `${p.variantes} medidas`]
      .filter(Boolean)
      .join(" · "),
    href: `/admin/productos/${p.id}`,
  }));
}
