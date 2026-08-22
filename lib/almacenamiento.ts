import "server-only";

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Guardado de archivos subidos.
 *
 * En desarrollo escribe en `public/subidas`, que Next sirve directamente. En
 * producción usa Vercel Blob, porque el sistema de archivos de un servidor
 * serverless no persiste entre despliegues: una foto subida el martes
 * desaparecería con el deploy del miércoles.
 *
 * Las páginas no saben cuál de los dos está activo: piden guardar y reciben una
 * URL.
 */

const CARPETA_LOCAL = path.join(process.cwd(), "public", "subidas");

/** Formatos que aceptamos. El navegador puede mentir, así que además se mira el contenido. */
const TIPOS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

const TAMANO_MAXIMO = 8 * 1024 * 1024;

/** Firmas de archivo, para no confiar en la extensión ni en el content-type. */
function detectarFormato(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  const cabecera = new TextDecoder().decode(bytes.slice(0, 12));
  if (cabecera.startsWith("RIFF") && cabecera.includes("WEBP")) return "webp";
  if (cabecera.includes("ftypavif")) return "avif";
  return null;
}

export interface ResultadoSubida {
  url?: string;
  error?: string;
}

export async function guardarImagen(
  archivo: File,
  prefijo = "producto",
): Promise<ResultadoSubida> {
  if (archivo.size === 0) return { error: "El archivo está vacío." };

  if (archivo.size > TAMANO_MAXIMO) {
    return {
      error: `La imagen pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB. El máximo son 8 MB.`,
    };
  }

  if (!TIPOS.has(archivo.type)) {
    return { error: "Subí una imagen en JPG, PNG, WebP o AVIF." };
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const formato = detectarFormato(bytes);

  if (!formato) {
    // Coincide la extensión pero el contenido no es una imagen: es la vía por
    // la que alguien sube otra cosa renombrada.
    return { error: "El archivo no parece ser una imagen válida." };
  }

  const nombre = `${prefijo}-${randomUUID()}.${formato}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const subido = await put(nombre, Buffer.from(bytes), {
      access: "public",
      contentType: archivo.type,
    });
    return { url: subido.url };
  }

  await mkdir(CARPETA_LOCAL, { recursive: true });
  await writeFile(path.join(CARPETA_LOCAL, nombre), bytes);

  return { url: `/subidas/${nombre}` };
}

/** Borra una imagen subida. Los errores no interrumpen: es limpieza. */
export async function borrarImagen(url: string): Promise<void> {
  try {
    if (url.startsWith("/subidas/")) {
      await unlink(path.join(CARPETA_LOCAL, path.basename(url)));
      return;
    }

    if (process.env.BLOB_READ_WRITE_TOKEN && url.includes("blob.vercel-storage")) {
      const { del } = await import("@vercel/blob");
      await del(url);
    }
  } catch {
    // Si el archivo ya no está, el objetivo igual se cumplió.
  }
}

/** Extensiones de los adjuntos que puede mandar alguien por WhatsApp. */
const EXTENSIONES_ADJUNTO = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
  ["audio/ogg", "ogg"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/amr", "amr"],
  ["video/mp4", "mp4"],
  ["video/3gpp", "3gp"],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xlsx",
  ],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  ["text/plain", "txt"],
  ["text/csv", "csv"],
]);

/** 16 MB: el tope que maneja WhatsApp para documentos y video. */
const TAMANO_MAXIMO_ADJUNTO = 16 * 1024 * 1024;

/**
 * Guarda un adjunto de WhatsApp.
 *
 * Va aparte de `guardarImagen` porque acá el contenido no lo elige nadie de la
 * casa: es lo que mandó un cliente desde su teléfono, y puede ser el PDF de un
 * plano, un audio explicando una medida o la foto de una pared. Lo que sí se
 * mantiene es no confiar en el content-type declarado para armar el nombre del
 * archivo, y no guardar nunca con una extensión ejecutable.
 *
 * A diferencia de una subida del panel, si el tipo no está en la lista el
 * archivo igual se guarda como `.bin`: perder el adjunto de un cliente porque
 * mandó un formato raro es peor que guardarlo sin poder previsualizarlo.
 */
export async function guardarAdjunto(
  bytes: Uint8Array,
  mime: string,
  prefijo = "whatsapp",
): Promise<ResultadoSubida> {
  if (bytes.byteLength === 0) return { error: "El archivo llegó vacío." };

  if (bytes.byteLength > TAMANO_MAXIMO_ADJUNTO) {
    return {
      error: `El archivo pesa ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB y no lo podemos guardar.`,
    };
  }

  const limpio = mime.split(";")[0].trim().toLowerCase();
  const extension = EXTENSIONES_ADJUNTO.get(limpio) ?? "bin";
  const nombre = `${prefijo}-${randomUUID()}.${extension}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const subido = await put(nombre, Buffer.from(bytes), {
      access: "public",
      contentType: limpio,
    });
    return { url: subido.url };
  }

  await mkdir(CARPETA_LOCAL, { recursive: true });
  await writeFile(path.join(CARPETA_LOCAL, nombre), bytes);

  return { url: `/subidas/${nombre}` };
}
