import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversaciones } from "@/lib/db/schema";
import { staffOrNull } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { proveedorWhatsapp } from "@/lib/whatsapp";
import { enviarYRegistrar, ERROR_TOPE } from "@/lib/whatsapp/envio";
import { topeAlcanzado } from "@/lib/whatsapp/gasto";
import { guardarMedioPrivado, limpiarMime, tipoParaEnviar } from "@/lib/whatsapp/medios";
import { ventanaAbierta } from "@/lib/whatsapp/ventana";

/**
 * Mandar una foto o un archivo desde la bandeja.
 *
 * Es una ruta y no una Server Action por el tamaño: las acciones tienen un
 * tope de 1 MB de cuerpo, y la foto de un mueble terminado ya pesa más. El
 * tope de acá es el de Caddy (25 MB); WhatsApp admite documentos más grandes,
 * pero no hay nada que la maderera mande que los necesite.
 *
 * El archivo se sube a Meta y sale por id, y se guarda una copia privada para
 * que la conversación lo siga mostrando.
 */

const TOPES: Record<"image" | "document" | "audio" | "video", number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 25 * 1024 * 1024,
};

function error(texto: string, status = 400) {
  return NextResponse.json({ error: texto }, { status });
}

/** JPG y PNG por su firma, no por lo que dice el navegador. */
function esImagenDeVerdad(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return false;
}

export async function POST(request: Request) {
  const sesion = await staffOrNull();
  if (!sesion || !puedeEntrar("/admin/whatsapp", sesion.staffRole)) return error("No autorizado.", 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("No llegó el archivo.");
  }

  const archivo = form.get("archivo");
  const conversacionId = String(form.get("conversacionId") ?? "");
  const epigrafe = String(form.get("epigrafe") ?? "").trim().slice(0, 1024);
  const citado = String(form.get("citado") ?? "").trim() || null;

  if (!(archivo instanceof File) || archivo.size === 0) return error("Elegí un archivo.");
  if (!/^[0-9a-f-]{36}$/i.test(conversacionId)) return error("Conversación inválida.");

  const [conversacion] = await db.select().from(conversaciones).where(eq(conversaciones.id, conversacionId)).limit(1);
  if (!conversacion) return error("No encontramos esa conversación.", 404);

  if (!ventanaAbierta(conversacion.ultimoEntranteAt)) {
    return NextResponse.json(
      {
        error: "Pasaron más de 24 horas desde su último mensaje: un archivo suelto no se puede mandar. Usá un mensaje preparado.",
        requierePlantilla: true,
      },
      { status: 409 },
    );
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  let mime = limpiarMime(archivo.type || "application/octet-stream");
  let clase = tipoParaEnviar(mime);
  // Una «imagen» que no es JPG ni PNG de verdad va como documento.
  if (clase === "image" && !esImagenDeVerdad(bytes, mime)) {
    clase = "document";
    if (!mime.startsWith("image/")) mime = "application/octet-stream";
  }

  if (bytes.byteLength > TOPES[clase]) {
    const mb = Math.round(TOPES[clase] / 1024 / 1024);
    return error(
      clase === "image"
        ? `WhatsApp no acepta fotos de más de ${mb} MB. Mandala como documento o achicala.`
        : `El archivo pesa más de ${mb} MB.`,
      413,
    );
  }

  // Con el tope del mes pasado, ni se sube: la pantalla pide confirmar.
  const confirmarTope = form.get("confirmarTope") === "si";
  if (!confirmarTope && (await topeAlcanzado())) {
    return NextResponse.json({ error: ERROR_TOPE.texto, requiereConfirmacionTope: true }, { status: 409 });
  }

  const nombre = archivo.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "archivo";
  const subido = await proveedorWhatsapp().subirMedia(bytes, mime, nombre);
  if (subido.error || !subido.id) return error(subido.error?.texto ?? "WhatsApp no aceptó el archivo.", 502);

  const guardado = await guardarMedioPrivado(bytes, mime);

  const resultado = await enviarYRegistrar({
    conversacionId: conversacion.id,
    waJid: conversacion.waJid,
    mensaje: { tipo: "media", clase, media: { id: subido.id }, epigrafe, nombreArchivo: nombre, citado },
    registro: {
      cuerpo: epigrafe,
      citado,
      media: { referencia: guardado.referencia, tipo: clase, mime, nombre, bytes: guardado.bytes, mediaId: subido.id },
    },
    origen: "panel",
    enviadoPorUserId: sesion.userId,
    confirmarTope: true,
  });

  if (resultado.error) {
    return NextResponse.json(
      {
        error: resultado.error.texto,
        requierePlantilla: resultado.error.accion === "plantilla",
        requiereConfirmacionTope: resultado.error.accion === "tope",
      },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, mensajeId: resultado.mensajeId });
}
