import { ImageResponse } from "next/og";
import sharp from "sharp";
import { svgLogotipo, NARANJA_MARCA } from "@/lib/marca/logotipo";
import { TONOS, marcaDePlaca, tamanoDelRubroEnOg, tonoDePlaca } from "@/lib/catalogo/placa";

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

// El naranja de la guía de marca (antes un #E8590C escrito a mano).
const NARANJA = NARANJA_MARCA;

/** El logotipo de la guía, en vectores: la marca no se escribe con otra letra. */
const LOGO = `data:image/svg+xml;base64,${Buffer.from(svgLogotipo()).toString("base64")}`;

export { fotoParaTarjeta } from "./foto";
const CREMA = "#FBF7F0";
const TINTA = "#1F1B16";
const GRIS = "#6B6259";

export async function tarjeta({
  antetitulo,
  titulo,
  detalle,
  pie,
  foto,
  placa,
}: {
  antetitulo: string;
  titulo: string;
  /** La línea destacada: «Desde $28.500», «12 productos». */
  detalle?: string | null;
  pie: string;
  foto?: string | null;
  /**
   * Sin foto, la misma placa que dibuja el sitio (hallazgo 25): quien recibe
   * el enlace ve lo mismo que va a encontrar al abrirlo. Va en el lugar de la
   * foto; la veta queda afuera, el generador no entiende filtros de SVG.
   */
  placa?: { rubro: string; categoria: string; marca?: string | null } | null;
}): Promise<Response> {
  const largo = titulo.length;
  const conPanel = Boolean(foto || placa);
  const cuerpo = conPanel ? (largo > 40 ? 50 : 60) : largo > 40 ? 60 : 72;
  const tono = placa && !foto ? TONOS[tonoDePlaca(placa.categoria)].claro : null;
  const linea = placa && !foto ? marcaDePlaca(placa.marca) : null;
  // Con la placa a la izquierda, el antetítulo no repite lo que ya está
  // estampado: era «MELAMINA» dos veces en la misma imagen.
  const ante =
    placa && !foto && antetitulo.trim().toLowerCase() === placa.rubro.trim().toLowerCase() ? "" : antetitulo;

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

        {!foto && placa && tono && (
          <div
            style={{
              width: 520,
              height: 630,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: 52,
              background: tono.fondo,
              color: tono.texto,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ width: 64, height: 7, borderRadius: 4, background: NARANJA, display: "flex" }} />
              {linea && <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5 }}>{linea}</div>}
            </div>
            <div
              style={{
                fontSize: tamanoDelRubroEnOg(placa.rubro),
                fontWeight: 800,
                lineHeight: 1,
                textTransform: "uppercase",
                display: "flex",
              }}
            >
              {placa.rubro}
            </div>
          </div>
        )}

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: conPanel ? "0 56px" : "0 72px",
          }}
        >
          {ante && (
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: 2,
                color: NARANJA,
                textTransform: "uppercase",
                marginBottom: 18,
              }}
            >
              {ante}
            </div>
          )}
          <div
            style={{
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
            {/* eslint-disable-next-line @next/next/no-img-element -- es el generador de imágenes, no una página */}
            <img src={LOGO} alt="Maderera Juan B. Justo" width={192} height={37} style={{ width: 192, height: 37 }} />
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
