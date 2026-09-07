import { NextResponse } from "next/server";
import { staffOrNull } from "@/lib/dal/session";
import type { SessionUser } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";

/**
 * La guardia de los endpoints del mostrador.
 *
 * `requireStaff()` redirige, y en un endpoint eso significa que el `fetch`
 * recibe **el HTML del login con status 200**. La cola de sincronización daría
 * esa respuesta por buena y borraría una venta que nunca se guardó. Acá se
 * contesta 401, que es lo que la cola sabe leer: retener todo y pedir que
 * alguien vuelva a entrar.
 *
 * **Ser personal no alcanza: tiene que ser personal del mostrador.** La página
 * rebota bien a depósito y al aserradero, pero estos endpoints son la copia
 * local de la caja y llevan más que la pantalla: el padrón de clientes entero
 * —razón social, CUIT, domicilio y límite de crédito— y las dos listas de
 * precios. Se comprobó con un usuario de depósito: `/mostrador` lo mandaba a su
 * pantalla y `GET /api/mostrador/clientes` le devolvía la cartera completa.
 *
 * El par no se escribe acá: sale de `ACCESO["/mostrador"]`, la misma lista con
 * la que decide la página. Dos listas se separan; una sola, no.
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

  /*
   * 403 y no 401, porque no son el mismo problema: el 401 se arregla volviendo
   * a entrar y esto no se arregla con la misma persona volviendo a entrar. La
   * cola lo trata igual que al 401 —retiene todo y pide sesión— y eso es lo
   * correcto: la venta no se pierde, y quien tiene que entrar es otro.
   */
  if (!puedeEntrar("/mostrador", usuario.staffRole)) {
    return NextResponse.json(
      {
        error: "rol",
        detalle: "Este puesto es del mostrador. Entrá con un usuario de ventas.",
      },
      { status: 403, headers: SIN_CACHE },
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
