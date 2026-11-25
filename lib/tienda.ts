/**
 * Los dos interruptores de la tienda online (migración 00093 del backend).
 *
 * La primera entrega del sitio va sin tienda: la clienta tiene que cargar el
 * inventario antes de vender en línea. **Los precios no los esconde esto**:
 * con la tienda apagada la API de Go ya no los devuelve (ver
 * `backend/internal/catalogo/tienda.go`). Esto decide qué se dibuja en su
 * lugar —«Consultar por WhatsApp» en vez de «Agregar al presupuesto»— y qué
 * enlaces no tiene sentido mostrar, como el carrito.
 *
 * La disponibilidad sí la esconde la pantalla: el stock de producción está en
 * cero hasta que se cargue, y mostrarlo diría «sin stock» en todo.
 */
export interface Tienda {
  /** Precios, carrito y compra en el sitio. */
  activa: boolean;
  /** «Hay en Casa Central / Aserradero» y los filtros por stock. */
  stockVisible: boolean;
}

/**
 * Lee los interruptores de los ajustes del sitio. Un ajuste que no está cuenta
 * como encendido, igual que en Go: es lo que hacía el sitio antes.
 */
export function leerTienda(ajustes: Record<string, string>): Tienda {
  const encendido = (clave: string) => (clave in ajustes ? ajustes[clave] === "si" : true);
  return { activa: encendido("tienda_activa"), stockVisible: encendido("stock_visible") };
}

/** La tienda de antes: lo que se usa si no se pudieron leer los ajustes. */
export const TIENDA_ENCENDIDA: Tienda = { activa: true, stockVisible: true };
