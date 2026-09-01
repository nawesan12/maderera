import { ImageResponse } from "next/og";

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
 */

export const alt = "Maderera Juan B. Justo — Desde 1981 en Mar del Plata";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* Los colores de marca, escritos acá porque el generador no lee el CSS. */
const NARANJA = "#E8590C";
const CREMA = "#FBF7F0";
const TINTA = "#1F1B16";
const GRIS = "#6B6259";

export default async function Imagen() {
  return new ImageResponse(
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

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 72px",
          }}
        >
          <div style={{ fontSize: 76, fontWeight: 700, color: TINTA, lineHeight: 1.02 }}>
            Maderera
          </div>
          <div style={{ fontSize: 76, fontWeight: 700, color: NARANJA, lineHeight: 1.02 }}>
            Juan B. Justo
          </div>

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

          <div style={{ fontSize: 38, color: TINTA, lineHeight: 1.3, maxWidth: 900 }}>
            Techos, placas, pisos, molduras Moldava, decks y ferretería
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
            <span style={{ color: NARANJA }}>·</span>
            <span>Casa Central y Aserradero</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
