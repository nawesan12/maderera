/**
 * El precio que le toca a una variante, resuelto en el navegador.
 *
 * Es el `coalesce(precio_propio, precio_general)` de `lib/mostrador/buscar.ts`
 * escrito en TypeScript: la lista del cliente si tiene precio cargado para esa
 * variante, y la general como respaldo.
 *
 * **El respaldo no es un detalle.** Una lista profesional rara vez tiene todos
 * los artículos cargados, y un mostrador que muestra la mitad del catálogo "sin
 * precio" a un cliente que sí tiene lista es peor que mostrarle el de público.
 */

/** Clave `${priceListId}:${variantId}` → precio. */
export type PreciosLocales = Map<string, number>;

export function clavePrecio(priceListId: string, variantId: string): string {
  return `${priceListId}:${variantId}`;
}

export function precioLocal(
  precios: PreciosLocales,
  variantId: string,
  listaId: string | null,
  generalId: string | null,
): number {
  if (listaId) {
    const propio = precios.get(clavePrecio(listaId, variantId));
    if (propio !== undefined && propio > 0) return propio;
  }

  if (generalId) {
    const general = precios.get(clavePrecio(generalId, variantId));
    if (general !== undefined) return general;
  }

  return 0;
}
