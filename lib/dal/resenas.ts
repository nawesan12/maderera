import "server-only";

import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { api, apiPublica, datos } from "@/lib/api/servidor";

/**
 * Las reseñas de productos.
 *
 * Las arma la API de Go (backend/internal/contenido): solo las publicadas se
 * ven en el sitio, una por producto y compra, y solo de un pedido entregado.
 */

export interface ResenaPublicada {
  id: string;
  nombre: string;
  estrellas: number;
  texto: string;
  fecha: Date;
}

export interface ResumenDeResenas {
  promedio: number;
  cantidad: number;
  reparto: Record<number, number>;
}

const resenasCacheadas = cachearPublico(
  async (productId: string) =>
    datos(await apiPublica.GET("/api/v1/contenido/productos/{id}/resenas", { params: { path: { id: productId } } })),
  ["resenas", "producto"],
  ETIQUETAS.catalogo,
);

/** Las publicadas de un producto, las 50 más nuevas. */
export async function resenasDelProducto(productId: string): Promise<ResenaPublicada[]> {
  const filas = await resenasCacheadas(productId);
  return filas.map((f) => ({ ...f, fecha: new Date(f.fecha) }));
}

/** El promedio y el reparto por estrellas, o null si no hay ninguna publicada. */
export const resumenDeResenas = cachearPublico(
  async (productId: string): Promise<ResumenDeResenas | null> =>
    datos(await apiPublica.GET("/api/v1/contenido/productos/{id}/resumen", { params: { path: { id: productId } } })) ??
    null,
  ["resenas", "resumen"],
  ETIQUETAS.catalogo,
);

export interface ProductoResenable {
  productId: string;
  slug: string;
  nombre: string;
  orderId: string;
  numeroPedido: string;
  yaResenado: boolean;
}

/** Lo que quien pide compró en pedidos entregados, con si ya lo reseñó. */
export async function productosQuePuedoResenar(): Promise<ProductoResenable[]> {
  const r = await (await api()).GET("/api/v1/contenido/mis-resenas");
  if (r.response.status === 401) return [];
  return datos(r);
}
