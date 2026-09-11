"use server";

import { listarProductosAdmin } from "@/lib/dal/admin/products";
import { buscarEnElPanel } from "@/lib/dal/admin/busqueda-panel";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";

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
 * Mira el catálogo y, además, clientes, pedidos, presupuestos, comprobantes,
 * cortes y proveedores: quien atiende escribe el apellido o el número que le
 * están dictando y llega, sin tener que saber en qué sección de las sesenta
 * vive esa cosa.
 *
 * El orden de los productos va al final: el resto son cosas que tienen a
 * alguien esperando del otro lado.
 */
export async function buscarEnPanel(
  termino: string,
): Promise<ResultadoBusqueda[]> {
  const texto = termino.trim();
  if (texto.length < 2) return [];

  const { staffRole } = await requireStaff();

  const [delNegocio, productos] = await Promise.all([
    buscarEnElPanel(texto),
    puedeEntrar("/admin/productos", staffRole)
      ? listarProductosAdmin({ busqueda: texto })
      : Promise.resolve([]),
  ]);

  return [
    ...delNegocio,
    ...productos.slice(0, 4).map((p) => ({
      id: p.id,
      tipo: "Producto",
      titulo: p.name,
      detalle: [p.categoryName, p.brand, `${p.variantes} medidas`]
        .filter(Boolean)
        .join(" · "),
      href: `/admin/productos/${p.id}`,
    })),
  ];
}
