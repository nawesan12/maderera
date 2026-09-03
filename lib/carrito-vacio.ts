import type { Carrito } from "@/lib/dal/carrito";

/**
 * El presupuesto vacío, canónico. También es el respaldo cuando la lectura
 * falla, y con lo que arranca el sitio que se sirve del CDN.
 *
 * Vive fuera de `lib/dal/carrito.ts` porque ese módulo es `server-only` y esto
 * lo necesita el proveedor del carrito, que corre en el navegador. El tipo sí
 * puede venir de allá: los tipos se borran al compilar.
 */
export const CARRITO_VACIO: Carrito = {
  id: null,
  items: [],
  cantidadItems: 0,
  subtotal: 0,
  conPrecioDesactualizado: 0,
  ahorroPorVolumen: 0,
  listaDiferenciada: null,
};
