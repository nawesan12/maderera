import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { correrTarea, esTarea } from "@/lib/tareas";

/**
 * Dispara una tarea programada. Lo llama el contenedor `cron` del servidor
 * (ver `servidor/cron/crontab`), con `Authorization: Bearer <TAREAS_SECRETO>`.
 *
 * - **Sin `TAREAS_SECRETO` configurado, la ruta no existe** (404): en una
 *   copia sin cron, o en Vercel, nadie puede dispararlas desde afuera.
 * - El secreto se compara en tiempo constante, sobre los hash para que las
 *   longitudes coincidan: comparar con `===` deja medir cuántos caracteres
 *   acertó quien prueba.
 * - Una tarea que ya corrió en su período contesta 200 con `ya-corrio`: para
 *   el cron no es un error, es el candado haciendo su trabajo.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tarea: string }> },
) {
  const secreto = process.env.TAREAS_SECRETO?.trim();
  if (!secreto) return new NextResponse(null, { status: 404 });

  const recibido = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!igualesEnTiempoConstante(recibido, secreto)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { tarea } = await params;
  if (!esTarea(tarea)) {
    return NextResponse.json({ error: `No existe la tarea «${tarea}».` }, { status: 404 });
  }

  const corrida = await correrTarea(tarea);
  return NextResponse.json(corrida, { status: corrida.estado === "error" ? 500 : 200 });
}

function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
