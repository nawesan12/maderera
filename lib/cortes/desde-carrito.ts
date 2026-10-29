import "server-only";

import createClient from "openapi-fetch";
import { cookies, headers } from "next/headers";
import { API_URL, datos } from "@/lib/api/servidor";
import type { paths, Esquemas } from "@/lib/api/tipos";
import { presentacionDeMitad, type Presentacion } from "@/lib/ventas/forma-de-venta";

/**
 * Los cortes del carrito, listos para convertirse en pedido.
 *
 * **Se recalcula todo, y lo recalcula Go** (/api/v1/cortes/carrito): vuelve a
 * buscar la placa con la lista de quien compra, a acomodar las piezas con el
 * disco configurado y a presupuestar. Es una ruta interna —solo el servidor de
 * Next, con el secreto— que además lleva la cookie de quien compra, porque la
 * lista es la suya. La confirmación del pedido (tanda 6) sigue en TS y consume
 * esto adentro de su transacción.
 */
export interface LineaDeCorte {
  /** Si el material es media placa: descuenta 0,5 por placa del plano. */
  presentacion?: Presentacion;
  variantId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
}

export type CorteResuelto = Omit<Esquemas["CorteResuelto"], "lineas" | "mitad"> & {
  mitad: "largo" | "ancho" | null;
  lineas: LineaDeCorte[];
};

export async function resolverCortesDelCarrito(
  cartId: string,
): Promise<{ resueltos: CorteResuelto[]; error?: string }> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  const cabeceras: Record<string, string> = { Authorization: `Bearer ${process.env.API_SECRETO_INTERNO ?? ""}` };
  const cookie = c.toString();
  if (cookie) cabeceras.cookie = cookie;
  const ip = h.get("x-forwarded-for") ?? h.get("x-real-ip");
  if (ip) cabeceras["x-forwarded-for"] = ip;

  const cliente = createClient<paths>({ baseUrl: API_URL, cache: "no-store", headers: cabeceras });
  const r = datos(await cliente.POST("/api/v1/cortes/carrito", { body: { cartId } }));
  if (r.error) return { resueltos: [], error: r.error };

  return {
    resueltos: r.resueltos.map((corte) => {
      const mitad = (corte.mitad as "largo" | "ancho" | null) ?? null;
      return {
        ...corte,
        mitad,
        lineas: corte.lineas.map(({ esMaterial, ...l }) => ({
          ...(esMaterial ? { presentacion: presentacionDeMitad(mitad) } : {}),
          ...l,
        })),
      };
    }),
  };
}
