import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { NARANJA_MARCA, svgLogotipo } from "@/lib/marca/logotipo";

/**
 * La imagen que aparece cuando alguien comparte el sitio por WhatsApp.
 *
 * En este rubro eso no es una nota al pie: la mitad del tráfico llega porque
 * alguien pasó un link en un grupo de obra. Lo que había antes era el favicon
 * de 180×180, que WhatsApp muestra como un cuadradito al costado; una imagen
 * de 1200×630 ocupa el ancho del mensaje.
 *
 * Se genera con `ImageResponse` en vez de subir un .jpg para que el texto siga
 * a la marca sin abrir un editor, y para poder hacer lo mismo por categoría
 * más adelante.
 *
 * Con el galpón a la izquierda, como las de producto y categoría (revisión del
 * 19/11: era la única sin foto). El generador no entiende WebP: se pasa a JPEG
 * una vez, al cargar el módulo (no depende del pedido). Si no se puede leer,
 * la tarjeta sale sin foto.
 */

export const alt = "Maderera Juan B. Justo — Desde 1981 en Mar del Plata";
export const size = { width: 1200, height: 630 };
// JPEG y no el PNG del generador: con la foto, el PNG pesaba 695 KB y WhatsApp
// deja de mostrar la vista previa pasados unos 300 KB (lo mismo que
// app/og/plantilla.tsx).
export const contentType = "image/jpeg";

/* Los colores de marca, escritos acá porque el generador no lee el CSS. */
const NARANJA = NARANJA_MARCA;

/**
 * El logotipo de la guía en vectores. Antes el nombre iba escrito con la letra
 * del generador: es el «reemplazo tipográfico» que la guía prohíbe, y era lo
 * que se veía en cada enlace compartido.
 */
const LOGO = `data:image/svg+xml;base64,${Buffer.from(svgLogotipo()).toString("base64")}`;
const FOTO = await readFile(join(process.cwd(), "lib", "sitio", "galpon.webp"))
  .then((d) =>
    sharp(d)
      .resize(520, 630, { fit: "cover", position: "centre" })
      .jpeg({ quality: 78 })
      .toBuffer(),
  )
  .then((d) => `data:image/jpeg;base64,${d.toString("base64")}`)
  .catch(() => null);
const CREMA = "#FBF7F0";
const TINTA = "#1F1B16";
const GRIS = "#6B6259";

export default async function Imagen() {
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
        {/* Franja de marca a la izquierda: es lo que hace que la miniatura se
            reconozca sin leerla, que es como se ve en una lista de chat. */}
        <div style={{ width: 28, background: NARANJA, display: "flex" }} />

        {FOTO && (
          <img src={FOTO} alt="" width={520} height={630} style={{ width: 520, height: 630, objectFit: "cover" }} />
        )}

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: FOTO ? "0 56px" : "0 72px",
          }}
        >
          {/* 148/760 es la proporción del logotipo. */}
          <img
            src={LOGO}
            alt="Maderera Juan B. Justo"
            width={FOTO ? 540 : 760}
            height={FOTO ? 105 : 148}
            style={{ width: FOTO ? 540 : 760, height: FOTO ? 105 : 148 }}
          />

          <div
            style={{
              width: 120,
              height: 6,
              background: TINTA,
              borderRadius: 999,
              margin: "36px 0 32px",
              display: "flex",
            }}
          />

          {/* En dos renglones parejos: suelta, «ferretería» quedaba sola en el segundo. */}
          <div style={{ display: "flex", flexDirection: "column", fontSize: 38, color: TINTA, lineHeight: 1.3 }}>
            <span>Maderas, placas,</span>
            <span>molduras y ferretería</span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginTop: 28,
              fontSize: 28,
              color: GRIS,
            }}
          >
            <span>Desde 1981 en Mar del Plata</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
  const jpeg = await sharp(Buffer.from(await png.arrayBuffer()))
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg" } });
}
