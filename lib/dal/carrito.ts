import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { api, apiInterna, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * El carrito lo lleva Go (backend/internal/checkout, tanda 6): el de la
 * sesión o, sin sesión, el de la cookie `mjbj_carrito`, que pone Go cuando lo
 * crea y las acciones copian al navegador. Esto queda como envoltorio con los
 * nombres de siempre.
 */
export const COOKIE_CARRITO = "mjbj_carrito";

export type ItemCarrito = Esquemas["ItemCarrito"];
export type CorteEnCarrito = Esquemas["CorteEnCarrito"];
export type Carrito = Esquemas["Carrito"];

/*
 * Se re-exporta desde acá, que es donde lo busca todo el mundo, pero la
 * constante vive en `lib/carrito-vacio.ts`: este módulo es `server-only` y el
 * proveedor del carrito, que corre en el navegador, también la necesita.
 */
export { CARRITO_VACIO } from "@/lib/carrito-vacio";

/**
 * Carrito de quien está navegando. **No lo crea**: crearlo desde una lectura
 * dejaría una fila por visita. Memoizado por pedido.
 */
export const obtenerCarrito = cache(
  async (): Promise<Carrito> => datos(await (await api()).GET("/api/v1/carrito")),
);

/**
 * Pasa el carrito armado sin sesión a la cuenta de quien acaba de entrar (lo
 * llaman ingresar y registrarse). Va con el secreto interno y el id de la
 * sesión nueva: el cliente de `api()` de este pedido ya se armó con la cookie
 * de antes de entrar.
 */
export async function adoptarCarritoAnonimo(userId: string): Promise<void> {
  const almacen = await cookies();
  const token = almacen.get(COOKIE_CARRITO)?.value;
  if (!token) return;

  const r = await apiInterna.POST("/api/v1/interno/carrito/adoptar", {
    body: { userId, token: token.slice(0, 64) },
  });
  if (r.response.ok) almacen.delete(COOKIE_CARRITO);
}
