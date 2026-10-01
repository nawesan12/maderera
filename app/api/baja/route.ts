import { NextResponse, type NextRequest } from "next/server";
import { secretoDeBajas, verificarBaja } from "@/lib/campanas/baja";
import { darDeBaja } from "@/lib/campanas/bajas";

/**
 * La baja con un clic (RFC 8058), la que dispara el botón «Anular
 * suscripción» de Gmail o Yahoo arriba del mensaje.
 *
 * Es un POST a propósito: los programas que revisan los enlaces de un correo
 * —antivirus, vistas previas— hacen GET, y si un GET diera de baja, la gente
 * se iría de la lista sin haber tocado nada. Por eso el GET solo lleva a la
 * página, donde hay que confirmar.
 */
export async function POST(request: NextRequest) {
  const e = request.nextUrl.searchParams.get("e") ?? "";
  const t = request.nextUrl.searchParams.get("t") ?? "";
  const email = verificarBaja(e, t, secretoDeBajas());
  if (!email) return new NextResponse("Enlace inválido.", { status: 400 });
  await darDeBaja(email, "enlace");
  return new NextResponse("Listo: no vas a recibir más novedades.", { status: 200 });
}

export async function GET(request: NextRequest) {
  const destino = new URL("/baja", request.nextUrl.origin);
  destino.search = request.nextUrl.search;
  return NextResponse.redirect(destino, 303);
}
