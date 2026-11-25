/**
 * Las etiquetas de la caché pública (ver `lib/cache-publico.ts`). Aparte y sin
 * `server-only` para poder probarlas.
 */
export const ETIQUETAS = {
  ajustes: "ajustes-del-sitio",
  sucursales: "sucursales",
  catalogo: "catalogo",
  contenido: "contenido",
  eventos: "eventos",
} as const;

/**
 * Las etiquetas finas del catálogo.
 *
 * Con una sola etiqueta, cada venta habría rearmado el catálogo entero. El
 * stock lo mueve Go —una venta, una entrega, una compra de la tienda— y su
 * aviso (backend/db/migraciones/00169) nombra solo lo que cambió: el listado
 * de esa categoría, la ficha de ese producto y el listado de «todo». Las
 * acciones del panel siguen invalidando `catalogo` entero, que también llega
 * a todas estas.
 */
export const etiquetaDeListado = (categoria?: string | null) =>
  `catalogo:${categoria && categoria !== "todos" ? categoria : "todo"}`;
export const etiquetaDeProducto = (slug: string) => `producto:${slug}`;

/**
 * Una etiqueta que el aviso de Go puede mandar a la ruta de revalidar. Las
 * finas se aceptan con cualquier slug —uno con mayúsculas o una eñe no puede
 * dejar el aviso entero fallando—, pero con tope de largo y sin espacios.
 */
export function esEtiquetaValida(e: string): boolean {
  return (
    (Object.values(ETIQUETAS) as string[]).includes(e) ||
    /^(catalogo|producto):\S{1,200}$/.test(e)
  );
}
