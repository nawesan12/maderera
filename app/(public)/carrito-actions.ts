"use server";

import { revalidatePath } from "next/cache";
import { api, copiarCookies, mensajeDe, type Problema } from "@/lib/api/servidor";
import { COOKIE_CARRITO } from "@/lib/dal/carrito";
import { encenderSenal } from "@/lib/senal-cliente";

/**
 * Las acciones del carrito: las hace Go (backend/internal/checkout, tanda 6)
 * con las mismas validaciones y mensajes. Acá queda lo que es de Next: la
 * cookie del carrito (Go la pone cuando lo crea y se copia al navegador), la
 * señal del encabezado y qué se vuelve a dibujar.
 */
export interface EstadoCarrito {
  error?: string;
  ok?: string;
}

/**
 * Qué hay que volver a dibujar después de tocar el carrito: solo las dos
 * pantallas que lo muestran (antes era `revalidatePath("/", "layout")`, que
 * tiraba el caché de todo el sitio en cada agregar).
 */
function refrescar() {
  revalidatePath("/carrito");
  revalidatePath("/carrito/confirmar");
}

export interface ItemParaAgregar {
  variantId?: string;
  descripcion: string;
  unidad?: string;
  cantidad: number | string;
  presentacion?: "media_largo" | "media_ancho" | null;
  origen?: string;
  notas?: string;
}

/**
 * Lo que contestó Go, con la cookie del carrito si se creó: desde ahí hay
 * algo que mostrar en el encabezado, y el HTML del sitio viene del CDN sin
 * saberlo (la señal hace que el navegador lo pregunte).
 */
async function despues(r: { data?: EstadoCarrito; error?: unknown; response: Response }, porDefecto: string): Promise<EstadoCarrito> {
  await copiarCookies(r.response);
  if (r.response.headers.getSetCookie().some((c) => c.startsWith(`${COOKIE_CARRITO}=`))) await encenderSenal();
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, porDefecto) };
  refrescar();
  return r.data;
}

/** Agrega algo al presupuesto en curso; la misma medida suma cantidad. */
export async function agregarAlCarrito(datos: ItemParaAgregar): Promise<EstadoCarrito> {
  const r = await (await api()).POST("/api/v1/carrito/items", { body: { ...datos } });
  return despues(r, "No se pudo agregar.");
}

/** Agrega varias líneas de una sola vez: la calculadora manda todo junto. */
export async function agregarVarios(items: ItemParaAgregar[]): Promise<EstadoCarrito> {
  const r = await (await api()).POST("/api/v1/carrito/items/varios", { body: { items } });
  return despues(r, "No se pudo agregar.");
}

/** Cambia la cantidad de un renglón propio; cero o menos lo quita. */
export async function cambiarCantidad(itemId: string, cantidad: number): Promise<EstadoCarrito> {
  const r = await (await api()).PATCH("/api/v1/carrito/items/{id}", {
    params: { path: { id: itemId } },
    body: { cantidad: Number.isFinite(cantidad) ? cantidad : null },
  });
  return despues(r, "No se pudo cambiar.");
}

export async function quitarDelCarrito(itemId: string): Promise<EstadoCarrito> {
  const r = await (await api()).DELETE("/api/v1/carrito/items/{id}", { params: { path: { id: itemId } } });
  return despues(r, "No se pudo quitar.");
}

export async function vaciarCarrito(): Promise<EstadoCarrito> {
  return despues(await (await api()).DELETE("/api/v1/carrito"), "No se pudo vaciar.");
}

/** Pone las líneas al precio de lista de hoy. */
export async function actualizarPrecios(): Promise<EstadoCarrito> {
  return despues(await (await api()).POST("/api/v1/carrito/precios"), "No se pudieron actualizar los precios.");
}
