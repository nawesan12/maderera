import type { NextConfig } from "next";

/*
 * Un identificador que cambia con cada build.
 *
 * Lo usa el ayudante del mostrador: se registra como `/sw.js?v=<esto>`, y sin
 * eso el archivo nunca cambia byte a byte, no se reinstala nunca y el punto de
 * venta se queda con el shell del día que se instaló.
 *
 * En Vercel sale del commit; en local, de la hora del build.
 */
const idDeBuild =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? `local-${Date.now()}`;

const nextConfig: NextConfig = {
  generateBuildId: () => idDeBuild,
  env: { NEXT_PUBLIC_BUILD_ID: idDeBuild },

  /**
   * Las guías del panel se leen del disco en tiempo de pedido. Sin esto, el
   * empaquetado no las incluye —nada las importa, así que el rastreo de
   * dependencias no las ve— y `/admin/ayuda` sale vacía en producción.
   */
  outputFileTracingIncludes: {
    "/admin/ayuda": ["./docs/GUIAS/**/*"],
    "/admin/ayuda/[slug]": ["./docs/GUIAS/**/*"],
  },
  /**
   * El ayudante del mostrador no se cachea nunca.
   *
   * Si el navegador guarda `/sw.js`, una corrección puede tardar días en
   * llegar a la máquina del local: el worker viejo sigue sirviendo el shell
   * viejo y no hay forma de forzarlo desde afuera. `Service-Worker-Allowed`
   * es lo que le permite controlar todo el sitio aunque el archivo esté en la
   * raíz de `public`.
   */
  /**
   * Redirecciones de rutas que dejaron de existir.
   *
   * **El blog** salió del sitio el 7/9/2026, por pedido de la clienta. Las seis
   * notas estaban en el sitemap y pueden estar indexadas, además de compartidas
   * por WhatsApp. Un 404 pierde ese tráfico y deja un enlace roto en cualquier
   * lado donde alguien lo haya pegado; un 301 lo manda a la portada, que es lo
   * más cerca que quedó de lo que la persona buscaba.
   *
   * **El carrito** dejó de llamarse «presupuesto» y «checkout»: eran dos
   * nombres para el mismo paso y ninguno de los dos es el que usa la gente —la
   * barra de arriba siempre dijo «Carrito»—. Las dos rutas viejas están
   * indexadas y, sobre todo, pegadas en conversaciones de WhatsApp, así que van
   * por 308 a las nuevas en vez de romperse.
   */
  async redirects() {
    return [
      { source: "/blog", destination: "/", permanent: true },
      { source: "/blog/:slug", destination: "/", permanent: true },
      { source: "/presupuesto", destination: "/carrito", permanent: true },
      {
        source: "/checkout",
        destination: "/carrito/confirmar",
        permanent: true,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },

      /*
       * Las dos pantallas que siguen armándose por pedido, servidas igual desde
       * la red.
       *
       * El catálogo y la consulta de stock reciben filtros por la URL —la
       * categoría, la búsqueda, el orden—, y eso las deja dinámicas: cada
       * combinación es una página distinta. Pero **el resultado ya no depende
       * de quién mira**: el precio del profesional lo corrige el navegador, así
       * que dos visitantes con la misma dirección reciben exactamente el mismo
       * HTML.
       *
       * **Va en `Vercel-CDN-Cache-Control` y no en `Cache-Control`, y eso no es
       * un detalle.** Con `Cache-Control` funciona en `next start` pero no en
       * Vercel: una página dinámica responde con `private, no-store` puesto por
       * el framework, ese encabezado gana, y la red no guarda nada. Medido
       * contra producción, que es la única forma de saberlo.
       *
       * La cabecera propia del CDN no compite con la otra: le habla solo a la
       * red, que además la borra antes de entregar la respuesta.
       * `CDN-Cache-Control` va al lado para cualquier otra red intermedia, y
       * `Cache-Control` queda para el navegador, donde no queremos copia vieja
       * —el precio y el stock cambian—.
       *
       * `s-maxage` es cuánto vale la copia guardada; `stale-while-revalidate`,
       * que mientras se rehace se sigue entregando la que hay en vez de hacer
       * esperar a nadie.
       */
      ...["/catalogo", "/stock"].map((source) => ({
        source,
        headers: [
          {
            key: "Vercel-CDN-Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=3600",
          },
          {
            key: "CDN-Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=3600",
          },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      })),

      /*
       * Las cabeceras de seguridad, para todo el sitio.
       *
       * No había ninguna. Son cuatro líneas que no cambian nada de lo que se
       * ve y cierran las cosas de siempre:
       *
       * - `X-Content-Type-Options`: que el navegador no adivine el tipo de un
       *   archivo. Acá se suben comprobantes y fotos, y adivinar es cómo una
       *   imagen termina ejecutándose como script.
       * - `Referrer-Policy`: al salir del sitio se manda el dominio, no la
       *   dirección completa. Un enlace desde `/pedido/1234?token=…` no tiene
       *   por qué contarle a nadie el token.
       * - `X-Frame-Options`: que nadie meta el panel adentro de un iframe suyo
       *   para hacer clickjacking.
       * - `Permissions-Policy`: el sitio no usa cámara, micrófono ni ubicación;
       *   decirlo explícitamente es que tampoco los pueda pedir un script que
       *   entre por donde sea.
       */
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
  images: {
    /**
     * Cada ancho y cada calidad distintos son **una transformación aparte**, y
     * la plataforma las cobra por unidad. Con los valores de fábrica —ocho
     * anchos de pantalla, siete de bloque— una sola foto de producto puede
     * generar quince archivos, y el catálogo tiene una foto por producto.
     *
     * Acá se recorta a los anchos que este diseño realmente pide: la grilla del
     * catálogo es de cuatro columnas en escritorio y de una en teléfono, así
     * que entre 640 y 1920 está todo cubierto. `imageSizes` queda con los tres
     * tamaños que usan los avatares y las miniaturas.
     *
     * `minimumCacheTTL` sube de cuatro horas a treinta días: las URLs de las
     * fotos son inmutables —Blob las guarda con nombre único y Unsplash tiene
     * su propio identificador—, así que revalidar seguido no descubre nada
     * nuevo y vuelve a pagar la transformación.
     */
    deviceSizes: [640, 828, 1200, 1920],
    imageSizes: [96, 256, 384],
    minimumCacheTTL: 2592000,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      // Las fotos "plus" de Unsplash salen por otro host. Sin declararlo,
      // `next/image` no las sirve y la portada rompe en tiempo de pedido.
      {
        protocol: "https",
        hostname: "plus.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
