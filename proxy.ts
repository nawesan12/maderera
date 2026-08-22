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

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/atencion/:path*", "/mi-cuenta/:path*"],
};
