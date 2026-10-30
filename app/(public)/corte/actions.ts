"use server";

import { revalidatePath } from "next/cache";
import { api, copiarCookies, mensajeDe, type Problema } from "@/lib/api/servidor";
import { COOKIE_CARRITO } from "@/lib/dal/carrito";
import { encenderSenal } from "@/lib/senal-cliente";

export interface EstadoCorte {
  error?: string;
  ok?: string;
}

async function despues(r: { data?: EstadoCorte; error?: unknown; response: Response }, porDefecto: string): Promise<EstadoCorte> {
  await copiarCookies(r.response);
  if (r.response.headers.getSetCookie().some((c) => c.startsWith(`${COOKIE_CARRITO}=`))) await encenderSenal();
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, porDefecto) };
  revalidatePath("/carrito");
  revalidatePath("/carrito/confirmar");
  return r.data;
}

/**
 * Guarda en el carrito un corte armado en el sitio. **Todo se vuelve a
 * calcular en Go** (backend/internal/checkout, con el motor de cortes): la
 * placa con la lista de quien compra, el plano y el presupuesto, con el freno
 * por IP de siempre. El precio nunca viaja en el formulario.
 */
export async function agregarCorteAlCarrito(datos: {
  variantId: string;
  mitad?: "largo" | "ancho" | null;
  cantoDescripcion?: string | null;
  piezas: unknown[];
}): Promise<EstadoCorte> {
  const r = await (await api()).POST("/api/v1/carrito/cortes", { body: datos as Record<string, unknown> });
  return despues(r, "Revisá las medidas: tienen que ser números en milímetros.");
}

/** Saca un corte del carrito de quien pide. */
export async function quitarCorteDelCarrito(id: string): Promise<EstadoCorte> {
  const r = await (await api()).DELETE("/api/v1/carrito/cortes/{id}", { params: { path: { id: String(id).slice(0, 64) } } });
  return despues(r, "No se pudo quitar.");
}
