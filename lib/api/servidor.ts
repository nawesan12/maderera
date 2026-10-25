import "server-only";

import createClient from "openapi-fetch";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { paths } from "./tipos";

/**
 * El cliente de la API de Go para el lado del servidor de Next (Server
 * Components y server actions). Ver docs/go/PLAN.md, «Cómo cambia Next».
 *
 * Le pasa a Go lo que Go necesita saber de quien pide: la cookie de sesión,
 * la IP (para los límites de intentos) y el navegador. Next y Go están en la
 * misma red de Docker y Go solo cree el X-Forwarded-For de una IP privada
 * (internal/plataforma), así que el que manda Next vale.
 *
 * Los tipos de cada ruta salen del contrato OpenAPI: si Go cambia una
 * respuesta, esto deja de compilar.
 */
export const API_URL = process.env.API_URL ?? "http://127.0.0.1:8080";

/**
 * Las cabeceras que Go necesita de quien pide. Se leen **antes** de armar el
 * cliente, a propósito: openapi-fetch con middlewares genera un id al azar
 * (Math.random) antes de llamarlos, y con cacheComponents eso, antes de leer
 * la petición, rompe el prerender. Leyendo primero, la página ya es dinámica.
 */
async function cabecerasDelPedido(): Promise<Record<string, string>> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  const out: Record<string, string> = {};
  const cookie = c.toString();
  if (cookie) out.cookie = cookie;
  const ip = h.get("x-forwarded-for") ?? h.get("x-real-ip");
  if (ip) out["x-forwarded-for"] = ip;
  const agente = h.get("user-agent");
  if (agente) out["user-agent"] = agente;
  return out;
}

/**
 * Un cliente por pedido (cache de React), con las cabeceras de ese pedido.
 *
 *   const { data } = await (await api()).GET("/api/v1/sesion");
 *
 * Sin caché: es la respuesta de esta persona en este momento. En desarrollo
 * Next avisa («uncached data») en las páginas que la esperan fuera de un
 * <Suspense>: es cierto —esa navegación no es instantánea— y ya pasaba con
 * las consultas a la base, que Next no veía. Ver docs/go/progreso.md.
 */
export const api = cache(async () =>
  createClient<paths>({ baseUrl: API_URL, cache: "no-store", headers: await cabecerasDelPedido() }),
);

/**
 * El cliente **sin la sesión**, para lo que Next guarda en su caché compartida
 * (cachearPublico): la portada, el catálogo, las fichas a precio de público.
 *
 * No manda la cookie a propósito, y las rutas que dependen de la lista se
 * piden con `publico=true`: una respuesta con los precios de un profesional
 * guardada en esa caché se le serviría a cualquiera. No lee nada de la
 * petición, así que sirve también en el prerender del build.
 */
export const apiPublica = createClient<paths>({ baseUrl: API_URL, cache: "no-store" });

/**
 * Lo que devolvió la API, o un error si no. Para las lecturas: en la API un
 * error es de verdad (la base, un bug), y una página que lo tape mostraría un
 * catálogo vacío como si lo estuviera.
 */
export function datos<T>(r: { data?: T; error?: unknown; response: Response }): T {
  if (r.data === undefined) {
    throw new Error(`La API respondió ${r.response.status} en ${new URL(r.response.url).pathname}`);
  }
  return r.data;
}

/**
 * Para mandar un formulario con archivos (multipart) como llegó a la server
 * action: openapi-fetch lo serializa como JSON si no se le dice otra cosa.
 *
 *   { body: soloCampos(formData) as never, ...comoFormulario }
 */
export const comoFormulario = { bodySerializer: (b: unknown) => b as FormData };

/**
 * El formulario sin los campos que agrega Next (`$ACTION_REF_1`, `$ACTION_1:0`):
 * el validador de la API rechaza las partes que el contrato no declara.
 */
export function soloCampos(formData: FormData): FormData {
  const limpio = new FormData();
  for (const [clave, valor] of formData) if (!clave.startsWith("$")) limpio.append(clave, valor);
  return limpio;
}

/** El problem+json de la API (RFC 9457), con los errores por campo. */
export interface Problema {
  title: string;
  status: number;
  detail?: string;
  errores?: Record<string, string>;
}

/** El primer mensaje para mostrar de un problema: el de un campo, o el general. */
export function mensajeDe(p: Problema | undefined, porDefecto = "Algo falló. Probá de nuevo en un momento."): string {
  if (!p) return porDefecto;
  const deCampo = p.errores ? Object.values(p.errores)[0] : undefined;
  return deCampo ?? p.detail ?? p.title ?? porDefecto;
}

/**
 * Pasa al navegador las cookies que puso Go (la de sesión, al entrar o al
 * registrarse). Solo sirve dentro de una server action o un route handler,
 * que es donde Next deja escribir cookies.
 *
 * **El valor se decodifica antes de guardarlo**: Next lo vuelve a pasar por
 * encodeURIComponent al escribirlo, y la cookie de Go ya viene codificada
 * (la firma lleva `=` como `%3D`). Sin esto quedaría `%253D` y la firma no
 * verificaría nunca.
 */
export async function copiarCookies(respuesta: Response): Promise<void> {
  const almacen = await cookies();
  for (const linea of respuesta.headers.getSetCookie()) {
    const [par, ...atributos] = linea.split(";").map((p) => p.trim());
    const igual = par.indexOf("=");
    const nombre = par.slice(0, igual);
    const valor = decodeURIComponent(par.slice(igual + 1));
    const opciones: Parameters<typeof almacen.set>[2] = { path: "/" };
    for (const a of atributos) {
      const [clave, v] = a.split("=");
      switch (clave.toLowerCase()) {
        case "max-age":
          opciones.maxAge = Number(v);
          break;
        case "httponly":
          opciones.httpOnly = true;
          break;
        case "secure":
          opciones.secure = true;
          break;
        case "samesite":
          opciones.sameSite = v.toLowerCase() as "lax" | "strict" | "none";
          break;
        case "path":
          opciones.path = v;
          break;
      }
    }
    if (opciones.maxAge !== undefined && opciones.maxAge < 0) almacen.delete(nombre);
    else almacen.set(nombre, valor, opciones);
  }
}
