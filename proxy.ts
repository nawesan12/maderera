import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * En Next.js 16 el middleware se llama Proxy.
 *
 * Acá solo se mira si existe la cookie de sesión: es un chequeo optimista para
 * evitarle a la gente sin login el viaje hasta el panel. NO valida la sesión ni
 * consulta el rol, porque el proxy corre en cada navegación —incluidas las
 * prefetch— y una consulta a la base en ese punto se paga en cada request.
 *
 * La verificación real (¿la sesión es válida?, ¿es personal de la empresa?) vive
 * en `requireStaff()` de `lib/dal/session.ts`, pegada al dato y sin atajos.
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    const url = new URL("/ingresar", request.url);
    url.searchParams.set("volver", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // La ruta pedida, para que un layout de servidor pueda decidir con ella. Un
  // layout no la recibe: solo ve sus `params`, y `/admin/cortes/formato` y
  // `/admin/cobros` le llegan igual. El aserradero entra a lo primero y no a lo
  // segundo, y esa decisión se toma con la ruta en la mano.
  const cabeceras = new Headers(request.headers);
  cabeceras.set("x-ruta", request.nextUrl.pathname);

  return NextResponse.next({ request: { headers: cabeceras } });
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/atencion/:path*",
    "/taller/:path*",
    "/mi-cuenta/:path*",
  ],
};
