import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { mensajes } from "@/lib/db/schema";
import { staffOrNull } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { leerMedioPrivado } from "@/lib/whatsapp/medios";

/**
 * Los adjuntos de las conversaciones, solo para quien puede abrir la bandeja.
 *
 * Una foto del DNI, el plano de una casa, un audio con la dirección: es lo que
 * manda la gente por WhatsApp, y no puede quedar en una URL pública. Se pide
 * por el id del **mensaje** —no del archivo— y se responde 404 a todo lo que
 * no sea el personal de la bandeja, igual que los comprobantes: un 401 o 403
 * le confirmaría a quien prueba ids que ese mensaje existe.
 *
 * Las cabeceras impiden que el archivo se interprete como otra cosa: un
 * documento que mandó un tercero se abre con `nosniff`, sin poder ejecutar
 * nada (`sandbox`), y nunca se guarda en un caché compartido.
 */

/** Lo que el navegador puede mostrar adentro de la bandeja; el resto se descarga. */
const EN_LINEA = /^(image\/(jpeg|png|webp)|audio\/|video\/(mp4|3gpp)|application\/pdf)/;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const noEncontrado = () => new Response("No encontrado", { status: 404 });

  const sesion = await staffOrNull();
  if (!sesion || !puedeEntrar("/admin/whatsapp", sesion.staffRole)) return noEncontrado();

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return noEncontrado();

  const [mensaje] = await db
    .select({ referencia: mensajes.mediaUrl, mime: mensajes.mediaMime, nombre: mensajes.mediaNombre })
    .from(mensajes)
    .where(eq(mensajes.id, id))
    .limit(1);
  if (!mensaje?.referencia) return noEncontrado();

  const archivo = await leerMedioPrivado(mensaje.referencia);
  if (!archivo) return noEncontrado();

  const tipo = (mensaje.mime || archivo.mime).split(";")[0].trim();
  const nombre = (mensaje.nombre ?? "archivo").replace(/[^\w.\- ]+/g, "_").slice(0, 120);

  return new Response(new Uint8Array(archivo.contenido), {
    headers: {
      "Content-Type": EN_LINEA.test(tipo) ? tipo : "application/octet-stream",
      "Content-Disposition": `${EN_LINEA.test(tipo) ? "inline" : "attachment"}; filename="${nombre}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      // El visor de PDF del navegador no abre adentro de un `sandbox`: para
      // los PDF alcanza con el tipo fijo y `nosniff`.
      ...(tipo === "application/pdf"
        ? {}
        : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox" }),
    },
  });
}
