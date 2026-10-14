import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { nombreDeSubida, rutaDeSubida } from "@/lib/almacenamiento";

/**
 * Los adjuntos de las conversaciones, guardados **fuera de lo público**.
 *
 * Hasta ahora iban a la misma carpeta que las fotos del catálogo, y esa carpeta
 * la sirve Caddy a cualquiera que tenga la dirección. El nombre llevaba un UUID
 * y no se podía adivinar, pero un enlace se reenvía, queda en el historial de
 * un navegador compartido del mostrador o en el registro de un proxy, y lo que
 * hay detrás es la foto del DNI que mandó un cliente para el crédito o el plano
 * de su casa. Una conversación privada no se protege con un nombre difícil.
 *
 * Ahora:
 *
 * - **En el servidor propio** van a `CARPETA_PRIVADA`, un volumen que solo ve
 *   la aplicación (Caddy no lo monta). En desarrollo, `.privado/` en la raíz,
 *   fuera de `public/`.
 * - **En Vercel** van a Blob como privados (`access: "private"`): sin el
 *   token de la tienda no se pueden leer.
 *
 * En los dos casos se leen solo a través de `/api/whatsapp/medios/<id>`, que
 * exige una sesión que pueda abrir la bandeja. Lo que se guarda en la base es
 * una **referencia** (`privado:<nombre>` o la URL interna de Blob), que nunca
 * llega al navegador.
 */

const CARPETA_PRIVADA =
  process.env.CARPETA_PRIVADA || path.join(process.cwd(), ".privado", "whatsapp");

const PREFIJO = "privado:";

function rutaPrivada(nombre: string): string {
  return path.join(/*turbopackIgnore: true*/ CARPETA_PRIVADA, nombre);
}

/** Extensiones por tipo. Lo que no está acá se guarda como `.bin`. */
const EXTENSIONES = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
  ["audio/ogg", "ogg"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/aac", "aac"],
  ["audio/amr", "amr"],
  ["video/mp4", "mp4"],
  ["video/3gpp", "3gp"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/msword", "doc"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["text/plain", "txt"],
  ["text/csv", "csv"],
]);

const TIPO_DE_EXTENSION = new Map([...EXTENSIONES].map(([mime, ext]) => [ext, mime]));

export function limpiarMime(mime: string | null | undefined): string {
  return (mime ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
}

/** 100 MB: el tope de WhatsApp para documentos, que es el más grande. */
export const TAMANO_MAXIMO_MEDIO = 100 * 1024 * 1024;

export interface MedioGuardado {
  referencia: string;
  bytes: number;
}

/** Guarda un adjunto y devuelve su referencia para la base. */
export async function guardarMedioPrivado(
  contenido: Uint8Array,
  mime: string | null | undefined,
): Promise<MedioGuardado> {
  if (contenido.byteLength === 0) throw new Error("El archivo llegó vacío.");
  if (contenido.byteLength > TAMANO_MAXIMO_MEDIO) {
    throw new Error(`El archivo pesa ${(contenido.byteLength / 1024 / 1024).toFixed(1)} MB y no se puede guardar.`);
  }

  const tipo = limpiarMime(mime);
  const nombre = `whatsapp-${randomUUID()}.${EXTENSIONES.get(tipo) ?? "bin"}`;

  // En el servidor propio, siempre al disco: aunque quede un token de Blob
  // cargado de la mudanza, lo privado no sale de la máquina.
  if (process.env.BLOB_READ_WRITE_TOKEN && process.env.PLATAFORMA !== "vps") {
    const { put } = await import("@vercel/blob");
    try {
      const subido = await put(`privado/${nombre}`, Buffer.from(contenido), {
        access: "private",
        contentType: tipo,
      });
      return { referencia: subido.url, bytes: contenido.byteLength };
    } catch (error) {
      // Un store de Blob creado como público no admite archivos privados
      // («Cannot use private access on a public store»). Mientras se siga en
      // Vercel con ese store, va público con un nombre imposible de adivinar
      // y **la URL igual nunca llega al navegador**: se sirve por la ruta
      // autenticada. En el servidor propio esto no corre (va al disco).
      if (!/private access/i.test(error instanceof Error ? error.message : "")) throw error;
      const subido = await put(`privado/${nombre}`, Buffer.from(contenido), {
        access: "public",
        contentType: tipo,
        addRandomSuffix: true,
      });
      return { referencia: subido.url, bytes: contenido.byteLength };
    }
  }

  await mkdir(/*turbopackIgnore: true*/ CARPETA_PRIVADA, { recursive: true });
  await writeFile(rutaPrivada(nombre), contenido);
  return { referencia: `${PREFIJO}${nombre}`, bytes: contenido.byteLength };
}

/**
 * Lee un adjunto por su referencia. `null` si no está o la referencia no es
 * de las que genera este módulo.
 */
export async function leerMedioPrivado(
  referencia: string,
): Promise<{ contenido: Uint8Array; mime: string } | null> {
  try {
    if (referencia.startsWith(PREFIJO)) {
      const nombre = nombreDeSubida(referencia.slice(PREFIJO.length));
      if (!nombre) return null;
      const contenido = await readFile(rutaPrivada(nombre));
      return { contenido: new Uint8Array(contenido), mime: mimeDeNombre(nombre) };
    }

    // Los mensajes anteriores a este cambio quedaron en la carpeta pública.
    if (referencia.startsWith("/subidas/")) {
      const nombre = nombreDeSubida(referencia.slice("/subidas/".length));
      if (!nombre) return null;
      const contenido = await readFile(rutaDeSubida(nombre));
      return { contenido: new Uint8Array(contenido), mime: mimeDeNombre(nombre) };
    }

    if (/^https:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\//.test(referencia)) {
      const { get } = await import("@vercel/blob");
      // Se prueba como privado y, si no, como público (ver `guardarMedioPrivado`).
      const respuesta =
        (await get(referencia, { access: "private" }).catch(() => null)) ??
        (await get(referencia, { access: "public" }));
      if (!respuesta || respuesta.statusCode !== 200) return null;
      const contenido = new Uint8Array(await new Response(respuesta.stream).arrayBuffer());
      return { contenido, mime: respuesta.blob.contentType ?? "application/octet-stream" };
    }
  } catch {
    return null;
  }
  return null;
}

function mimeDeNombre(nombre: string): string {
  const extension = path.extname(nombre).slice(1).toLowerCase();
  return TIPO_DE_EXTENSION.get(extension) ?? "application/octet-stream";
}

/** El tipo de mensaje de WhatsApp que corresponde a un archivo que se manda. */
export function tipoParaEnviar(mime: string): "image" | "document" | "audio" | "video" {
  const tipo = limpiarMime(mime);
  // WhatsApp solo muestra como foto JPG y PNG; un WebP o un GIF van como documento.
  if (tipo === "image/jpeg" || tipo === "image/png") return "image";
  if (tipo === "video/mp4" || tipo === "video/3gpp") return "video";
  if (tipo.startsWith("audio/")) return "audio";
  return "document";
}
