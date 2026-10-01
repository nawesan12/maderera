import { readFile } from "node:fs/promises";
import path from "node:path";
import { nombreDeSubida, rutaDeSubida } from "@/lib/almacenamiento";

/**
 * Los archivos subidos, servidos por la propia aplicación.
 *
 * En el servidor propio las fotos viven en un volumen fuera de `public/` y el
 * que las entrega al navegador es Caddy, directo del disco. Esta ruta existe
 * por **un solo cliente que no pasa por Caddy: `next/image`**. Para optimizar
 * una imagen con URL relativa, Next no la pide por la red sino que se la pide a
 * sí mismo por adentro, y por adentro solo conoce los archivos que había en
 * `public/` al arrancar. Una foto subida ayer desde el panel no está en esa
 * lista, así que la miniatura del catálogo salía rota.
 *
 * `next.config.ts` manda `/subidas/:archivo` acá **como último recurso**
 * (`fallback`): si el archivo está en `public/subidas` —en desarrollo— lo sirve
 * Next como siempre, y esta ruta solo atiende lo que no encontró.
 */

const TIPOS: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  pdf: "application/pdf",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  amr: "audio/amr",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ archivo: string }> },
) {
  const nombre = nombreDeSubida((await params).archivo);
  if (!nombre) return new Response("No encontrado", { status: 404 });

  let contenido: Buffer;
  try {
    contenido = await readFile(rutaDeSubida(nombre));
  } catch {
    return new Response("No encontrado", { status: 404 });
  }

  const extension = path.extname(nombre).slice(1).toLowerCase();

  return new Response(new Uint8Array(contenido), {
    headers: {
      // Lo que no está en la lista se entrega como binario: un `.bin` que
      // mandó alguien por WhatsApp no tiene por qué interpretarlo el navegador.
      "Content-Type": TIPOS[extension] ?? "application/octet-stream",
      // Cada nombre lleva un UUID y nunca se reescribe: la copia guardada no
      // puede quedar vieja.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
