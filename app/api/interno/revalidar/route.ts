import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { ETIQUETAS } from "@/lib/cache-publico";

/**
 * El aviso del backend en Go de que algo cambió y hay que volver a armar lo
 * cacheado (ver backend/internal/revalidar).
 *
 * Lo que cambia desde una server action se revalida ahí mismo. Esta ruta es
 * para lo que Go cambia por su cuenta —un webhook, una tarea, el mostrador
 * offline—: Go encola el aviso en la misma transacción del cambio y su
 * worker lo manda acá, con `Authorization: Bearer <REVALIDAR_SECRETO>`.
 *
 * Como /api/tareas: sin secreto configurado la ruta no existe (404), y se
 * compara en tiempo constante.
 */
const VALIDAS = new Set<string>(Object.values(ETIQUETAS));

export async function POST(request: NextRequest) {
  const secreto = process.env.REVALIDAR_SECRETO?.trim();
  if (!secreto) return new NextResponse(null, { status: 404 });

  const recibido = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!igualesEnTiempoConstante(recibido, secreto)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const cuerpo = (await request.json().catch(() => null)) as { etiquetas?: unknown; rutas?: unknown } | null;
  const etiquetas = Array.isArray(cuerpo?.etiquetas) ? cuerpo.etiquetas.filter((e): e is string => typeof e === "string") : [];
  const rutas = Array.isArray(cuerpo?.rutas) ? cuerpo.rutas.filter((r): r is string => typeof r === "string" && r.startsWith("/")) : [];

  // Una etiqueta que no existe es un error de quien la mandó: mejor que falle
  // a la vista (el worker la reintenta y queda en el registro) que en silencio.
  const desconocidas = etiquetas.filter((e) => !VALIDAS.has(e));
  if (desconocidas.length > 0) {
    return NextResponse.json({ error: `Etiquetas desconocidas: ${desconocidas.join(", ")}` }, { status: 400 });
  }

  for (const e of etiquetas) revalidateTag(e, { expire: 0 });
  for (const r of rutas) revalidatePath(r);
  return NextResponse.json({ etiquetas: etiquetas.length, rutas: rutas.length });
}

function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
