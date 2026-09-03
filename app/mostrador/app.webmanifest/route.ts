import { NextResponse } from "next/server";

/**
 * El manifiesto del punto de venta.
 *
 * Va como Route Handler y **no** como `app/manifest.ts`, que es lo que Next
 * ofrece de fábrica: aquel inyecta el `<link rel="manifest">` en *todas* las
 * páginas, así que el sitio público le estaría ofreciendo a los clientes de la
 * maderera instalarse un punto de venta. Acá se declara solo en el layout del
 * mostrador.
 *
 * `orientation: landscape` porque se usa en una pantalla de escritorio o una
 * tablet apoyada, y `display: standalone` para que no tenga barra de
 * direcciones: en el mostrador, una barra es un lugar donde tocar por error.
 */
export function GET() {
  return NextResponse.json(
    {
      id: "/mostrador",
      name: "Mostrador — Maderera Juan B. Justo",
      short_name: "Mostrador",
      description: "Punto de venta del mostrador, funciona sin internet.",
      start_url: "/mostrador",
      scope: "/",
      display: "standalone",
      orientation: "landscape",
      background_color: "#faf7f2",
      theme_color: "#b4530f",
      lang: "es-AR",
      categories: ["business"],
      icons: [
        { src: "/mostrador/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/mostrador/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/mostrador/icono-mascara-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
