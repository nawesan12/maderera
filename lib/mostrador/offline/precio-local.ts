/**
 * El precio que le toca a una variante, resuelto en el navegador.
 *
 * Es el `coalesce(precio_propio, precio_general)` del buscador del mostrador (Go)
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

/** Clave `${priceListId}:${variantId}` → la oferta vigente de ese precio. */
export type OfertasLocales = Map<string, { anterior: number; hasta: number }>;

/**
 * El precio de antes de una oferta, para tacharlo (M2S2-030). Sale de la misma
 * lista que dio el precio en `precioLocal`, y solo mientras la oferta sigue:
 * la copia puede tener una que venció hace minutos y el servidor todavía no
 * devolvió el precio.
 */
export function anteriorLocal(
  precios: PreciosLocales,
  ofertas: OfertasLocales,
  variantId: string,
  listaId: string | null,
  generalId: string | null,
  ahora: number = Date.now(),
): number | null {
  let clave: string | null = null;
  if (listaId) {
    const propio = precios.get(clavePrecio(listaId, variantId));
    if (propio !== undefined && propio > 0) clave = clavePrecio(listaId, variantId);
  }
  if (!clave && generalId && precios.has(clavePrecio(generalId, variantId))) {
    clave = clavePrecio(generalId, variantId);
  }
  const oferta = clave ? ofertas.get(clave) : undefined;
  if (!oferta || !(oferta.hasta > ahora)) return null;
  const precio = precios.get(clave!) ?? 0;
  return oferta.anterior > precio ? oferta.anterior : null;
}
