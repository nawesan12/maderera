import { NextResponse } from "next/server";

/**
 * El manifiesto del panel.
 *
 * Va como Route Handler y no como `app/manifest.ts` por la misma razón que el
 * del mostrador: aquél inyecta el `<link rel="manifest">` en **todas** las
 * páginas, y el sitio público le estaría ofreciendo a los clientes instalarse el
 * panel de administración.
 *
 * **Para qué instalarlo.** Para los avisos: un panel instalado en el teléfono
 * recibe la notificación de una venta con la aplicación cerrada, que es lo que
 * la clienta pidió al ver cómo funciona Tiendanube. Sin instalar también
 * funciona en Android; en iPhone, el permiso de notificaciones **solo existe si
 * la aplicación está agregada a la pantalla de inicio**.
 *
 * `orientation: any` —a diferencia del mostrador, que es apaisado— porque el
 * panel se mira sobre todo desde el teléfono, parado.
 */
export function GET() {
  return NextResponse.json(
    {
      id: "/admin",
      name: "Panel — Maderera Juan B. Justo",
      short_name: "Panel MJBJ",
      description:
        "El panel del negocio: pedidos, cortes, caja y avisos de venta.",
      start_url: "/admin",
      scope: "/admin",
      display: "standalone",
      orientation: "any",
      background_color: "#faf7f2",
      theme_color: "#b4530f",
      lang: "es-AR",
      categories: ["business", "productivity"],
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
