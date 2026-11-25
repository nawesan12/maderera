// cachearPublico sin unstable_cache: fuera de Next no hay caché incremental,
// y se mide lo mismo que en Go, que no cachea. Es lo que cuesta un pedido
// cuando la caché de Next no tiene la página.
export const ETIQUETAS = { catalogo: "catalogo", contenido: "contenido", eventos: "eventos", ajustes: "ajustes", sucursales: "sucursales" } as const;
export function cachearPublico<A extends unknown[], R>(fn: (...a: A) => Promise<R>, _clave: string[], _etiqueta: string) {
  return fn;
}
