import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { SENAL_ESTADO } from "@/lib/senal-navegador";

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
    const salida = NextResponse.redirect(url);
    // Si quedó una señal prendida sin sesión detrás, se apaga acá: el sitio
    // público la usa para decidir si preguntar por el encabezado, y una señal
    // colgada es un pedido inútil en cada carga.
    salida.cookies.delete(SENAL_ESTADO);
    return salida;
  }

  // La ruta pedida, para que un layout de servidor pueda decidir con ella. Un
  // layout no la recibe: solo ve sus `params`, y `/admin/cortes/formato` y
  // `/admin/cobros` le llegan igual. El aserradero entra a lo primero y no a lo
  // segundo, y esa decisión se toma con la ruta en la mano.
  const cabeceras = new Headers(request.headers);
  cabeceras.set("x-ruta", request.nextUrl.pathname);

  const salida = NextResponse.next({ request: { headers: cabeceras } });

  // La señal que hace que el sitio público pregunte por el encabezado.
  //
  // La prende el login, pero acá se vuelve a prender por las sesiones que ya
  // estaban abiertas cuando esto se puso —para esas nunca hubo login que la
  // encendiera— y por si se perdió sola: la cookie de sesión dura más. Sin
  // esto, alguien con la sesión abierta veía "Ingresar" en el menú hasta
  // volver a entrar. Cuesta una cabecera; no es una decisión de acceso.
  if (!request.cookies.has(SENAL_ESTADO)) {
    salida.cookies.set(SENAL_ESTADO, "1", {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 60,
      secure: process.env.NODE_ENV === "production",
    });
  }

  return salida;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/atencion/:path*",
    "/taller/:path*",
    "/mi-cuenta/:path*",
  ],
};
