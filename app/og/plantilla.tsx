import { ImageResponse } from "next/og";
import sharp from "sharp";
import { urlAbsoluta } from "@/lib/seo";

/**
 * La tarjeta que se ve al compartir un producto, una categoría o una sucursal.
 *
 * **Se piensa para WhatsApp**, que es por donde circulan los enlaces en este
 * rubro: el mensaje muestra la imagen a lo ancho y chica, así que el texto va
 * grande y corto —qué es, desde cuánto— y la marca se reconoce por la franja
 * naranja sin leerla. Mismo tamaño y colores que la del sitio
 * (`app/opengraph-image.tsx`).
 *
 * Las imágenes se generan al pedirlas y se guardan un día en el navegador y en
 * WhatsApp/Facebook, que además tienen su propia caché.
 *
 * **Salen en JPEG y no en el PNG del generador.** Con la foto del producto
 * adentro, el PNG pesaba entre 480 y 700 KB, y WhatsApp deja de mostrar la
 * vista previa con imágenes de más de unos 300 KB: el enlace llegaba sin
 * foto. Pasada por `sharp` (que ya está para `next/image`), la misma tarjeta
 * queda alrededor de los 60 KB.
 */

export const TAMANO = { width: 1200, height: 630 };

const NARANJA = "#E8590C";
const CREMA = "#FBF7F0";
const TINTA = "#1F1B16";
const GRIS = "#6B6259";

/**
 * Trae una foto para meterla en la tarjeta, o `null` si no se puede.
 *
 * El generador solo entiende JPEG, PNG y GIF: una foto subida en WebP —el
 * panel las acepta— rompería la imagen entera, así que se descarta y la
 * tarjeta sale sin foto. Lo mismo si tarda: una tarjeta sin foto es mejor que
 * una que no llega.
 */
export async function fotoParaTarjeta(ruta: string | null | undefined): Promise<string | null> {
  if (!ruta) return null;
  try {
    const respuesta = await fetch(urlAbsoluta(ruta), {
      headers: { accept: "image/jpeg,image/png,image/gif;q=0.9" },
      signal: AbortSignal.timeout(3000),
    });
    if (!respuesta.ok) return null;
    const tipo = respuesta.headers.get("content-type")?.split(";")[0] ?? "";
    if (!["image/jpeg", "image/png", "image/gif"].includes(tipo)) return null;
    const datos = Buffer.from(await respuesta.arrayBuffer());
    // Más de 4 MB no entra en el presupuesto del generador.
    if (datos.byteLength > 4_000_000) return null;
    return `data:${tipo};base64,${datos.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function tarjeta({
  antetitulo,
  titulo,
  detalle,
  pie,
  foto,
}: {
  antetitulo: string;
  titulo: string;
  /** La línea destacada: «Desde $28.500», «12 productos». */
  detalle?: string | null;
  pie: string;
  foto?: string | null;
}): Promise<Response> {
  const largo = titulo.length;
  const cuerpo = foto ? (largo > 40 ? 50 : 60) : largo > 40 ? 60 : 72;

  const png = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: CREMA,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ width: 28, background: NARANJA, display: "flex" }} />

        {foto && (
          // eslint-disable-next-line @next/next/no-img-element -- es el generador de imágenes, no una página
          <img
            src={foto}
            alt=""
            width={520}
            height={630}
            style={{ width: 520, height: 630, objectFit: "cover" }}
          />
        )}

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: foto ? "0 56px" : "0 72px",
          }}
        >
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 2,
              color: NARANJA,
              textTransform: "uppercase",
            }}
          >
            {antetitulo}
          </div>
          <div
            style={{
              marginTop: 18,
              fontSize: cuerpo,
              fontWeight: 700,
              color: TINTA,
              lineHeight: 1.05,
              display: "flex",
            }}
          >
            {titulo.length > 70 ? `${titulo.slice(0, 68)}…` : titulo}
          </div>
          {detalle && (
            <div style={{ marginTop: 26, fontSize: 44, fontWeight: 700, color: TINTA, display: "flex" }}>
              {detalle}
            </div>
          )}
          <div
            style={{
              marginTop: 30,
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 26,
              color: GRIS,
            }}
          >
            <span style={{ fontWeight: 700, color: TINTA }}>Maderera Juan B. Justo</span>
            <span style={{ color: NARANJA }}>·</span>
            <span>{pie}</span>
          </div>
        </div>
      </div>
    ),
    TAMANO,
  );

  const jpeg = await sharp(Buffer.from(await png.arrayBuffer()))
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
