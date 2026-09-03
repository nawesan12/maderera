import { NextResponse } from "next/server";
import { staffOrNull } from "@/lib/dal/session";
import type { SessionUser } from "@/lib/dal/session";

/**
 * La guardia de los endpoints del mostrador.
 *
 * `requireStaff()` redirige, y en un endpoint eso significa que el `fetch`
 * recibe **el HTML del login con status 200**. La cola de sincronización daría
 * esa respuesta por buena y borraría una venta que nunca se guardó. Acá se
 * contesta 401, que es lo que la cola sabe leer: retener todo y pedir que
 * alguien vuelva a entrar.
 */
export async function conStaff<T>(
  hacer: (usuario: SessionUser) => Promise<T>,
): Promise<NextResponse> {
  const usuario = await staffOrNull();

  if (!usuario) {
    return NextResponse.json(
      { error: "sesion", detalle: "Iniciá sesión para seguir." },
      { status: 401, headers: SIN_CACHE },
    );
  }

  const datos = await hacer(usuario);
  return NextResponse.json(datos, { headers: SIN_CACHE });
}

/**
 * Nada de esto se guarda en ningún intermediario.
 *
 * Depende de quién pregunta y cambia todo el tiempo; la copia buena vive en
 * IndexedDB, no en el caché del navegador. Dos cachés del mismo dato son dos
 * verdades.
 */
export const SIN_CACHE = { "Cache-Control": "private, no-store" } as const;

/** El `?desde=` de un delta, o null para pedir todo. */
export function leerDesde(url: URL): Date | null {
  const crudo = url.searchParams.get("desde");
  if (!crudo) return null;

  const fecha = new Date(crudo);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
