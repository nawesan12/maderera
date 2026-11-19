import sharp from "sharp";
import { urlAbsoluta } from "@/lib/seo";

/** Lo que entra en el generador sin pasar por sharp. */
const DIRECTOS = ["image/jpeg", "image/png", "image/gif"];
/** Lo que el generador no entiende y se pasa a JPEG antes. */
const A_CONVERTIR = ["image/webp", "image/avif"];

/**
 * Trae una foto para meterla en la tarjeta, o `null` si no se puede.
 *
 * El generador solo entiende JPEG, PNG y GIF. Las fotos de producto de la
 * biblioteca y las portadas propias son WebP (docs/fotos.md): antes se
 * descartaban y cada enlace compartido por WhatsApp —el canal principal—
 * salía sin foto. Ahora un WebP o un AVIF se pasa a JPEG de 1200 px con sharp.
 * Si tarda o falla, la tarjeta sale sin foto: mejor eso que una que no llega.
 */
export async function fotoParaTarjeta(ruta: string | null | undefined): Promise<string | null> {
  if (!ruta) return null;
  try {
    const respuesta = await fetch(urlAbsoluta(ruta), {
      headers: { accept: "image/jpeg,image/png,image/gif;q=0.9,image/webp;q=0.8,image/avif;q=0.7" },
      signal: AbortSignal.timeout(3000),
    });
    if (!respuesta.ok) return null;
    let tipo = respuesta.headers.get("content-type")?.split(";")[0] ?? "";
    let datos = Buffer.from(await respuesta.arrayBuffer());
    if (A_CONVERTIR.includes(tipo)) {
      datos = await sharp(datos)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      tipo = "image/jpeg";
    } else if (!DIRECTOS.includes(tipo)) {
      return null;
    }
    // Más de 4 MB no entra en el presupuesto del generador.
    if (datos.byteLength > 4_000_000) return null;
    return `data:${tipo};base64,${datos.toString("base64")}`;
  } catch {
    return null;
  }
}
