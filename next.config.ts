import type { NextConfig } from "next";
import { redireccionesParaNext } from "./lib/sitio-viejo";
import { sitioIndexable } from "./lib/seo";

/*
 * Un identificador que cambia con cada build.
 *
 * Lo usa el ayudante del mostrador: se registra como `/sw.js?v=<esto>`, y sin
 * eso el archivo nunca cambia byte a byte, no se reinstala nunca y el punto de
 * venta se queda con el shell del día que se instaló.
 *
 * Sale del commit: en el servidor propio lo pasa `scripts/desplegar.sh` como
 * `GIT_SHA` —adentro del build de Docker no hay `.git` del que leerlo—, y en
 * Vercel lo pone la plataforma. En local, de la hora del build.
 */
const idDeBuild =
  (process.env.GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA)?.slice(0, 12) ||
  `local-${Date.now()}`;

const nextConfig: NextConfig = {
  cacheComponents: true,
  /**
   * El prefetch de siempre, por enlace.
   *
   * Desde 16.3 Next avisa si no se elige: con `true` prefetchea un solo
   * «esqueleto» por ruta en vez de cada enlace. Se deja en `false` para que la
   * actualización a 16.4 —que trajo el arreglo de las páginas 404, ver
   * `lib/dal/existencia.ts`— no cambie además cómo navega el sitio. Pasar a
   * `true` es una decisión aparte, para probar con el panel y el mostrador.
   */
  partialPrefetching: false,
  /**
   * Empaquetado para servidor propio.
   *
   * `standalone` deja en `.next/standalone` un servidor con solo las
   * dependencias que se usan, en vez de arrastrar `node_modules` entero: la
   * imagen de Docker pasa de cientos de megas a unas decenas, y eso es lo que
   * permite reconstruirla y desplegarla en una máquina chica sin que tarde una
   * eternidad.
   *
   * Vercel lo ignora —arma su propio empaquetado—, así que tenerlo acá no
   * cambia nada mientras el proyecto siga ahí.
   */
  output: "standalone",

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

      /*
       * **El sitio viejo** (`mjbj.ar`, un WordPress). Caddy ya manda cada
       * dirección vieja a su destino de un salto cuando el pedido entra por
       * `mjbj.ar`; estas reglas son la red para la que llegue directo a este
       * dominio. La lista y sus motivos, en `lib/sitio-viejo.ts`.
       */
      ...redireccionesParaNext(),

      // El buscador de WordPress (`/?s=fenolico`) al del catálogo. No va en
      // Caddy porque la palabra buscada tiene que viajar bien escapada, y eso
      // lo resuelve Next.
      {
        source: "/",
        has: [{ type: "query", key: "s", value: "(?<busqueda>.+)" }],
        destination: "/catalogo?buscar=:busqueda",
        permanent: true,
      },
    ];
  },

  /**
   * Los archivos subidos que no están en `public/`.
   *
   * En el servidor propio viven en un volumen (`CARPETA_SUBIDAS`). Al navegador
   * se los da Caddy, pero `next/image` se los pide a la propia aplicación y
   * por adentro, sin pasar por Caddy; ver `app/api/subidas/[archivo]/route.ts`.
   *
   * Va en `fallback` y no antes: así un archivo que sí está en `public/subidas`
   * —el caso de desarrollo— lo sigue sirviendo Next como siempre, y la ruta
   * solo atiende lo que no encontró.
   */
  async rewrites() {
    return {
      /*
       * La API de Go (backend/, docs/go/PLAN.md). En el servidor Caddy manda
       * /api/v1 derecho a Go y esto no se usa; en desarrollo, sin Caddy, es lo
       * que hace que el navegador llegue a la API por el mismo origen (con la
       * misma cookie).
       */
      beforeFiles: [
        { source: "/api/v1/:ruta*", destination: `${process.env.API_URL ?? "http://127.0.0.1:8080"}/api/v1/:ruta*` },
        // El tiempo real del panel también es de Go (backend/internal/vivo).
        { source: "/api/vivo", destination: `${process.env.API_URL ?? "http://127.0.0.1:8080"}/api/vivo` },
        // WhatsApp también: el webhook de Meta, los adjuntos y el envío de archivos.
        { source: "/api/whatsapp/:ruta*", destination: `${process.env.API_URL ?? "http://127.0.0.1:8080"}/api/whatsapp/:ruta*` },
      ],
      afterFiles: [],
      fallback: [
        { source: "/subidas/:archivo", destination: "/api/subidas/:archivo" },
      ],
    };
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
       * **El catálogo y la consulta de stock ya no llevan cabeceras de caché
       * pública, y no deben volver a llevarlas.**
       *
       * Las tuvieron mientras el sitio vivió en Vercel: el HTML era el mismo
       * para todo el mundo —el precio del profesional lo corregía el
       * navegador— y la red lo guardaba cinco minutos. Desde Cache Components
       * la respuesta trae, en el mismo HTML, el precio y el saludo de quien
       * mira (`components/product-card.tsx`): una red que la guardara le
       * serviría a cualquiera el precio de un profesional. Next ya le pone a
       * estas respuestas `private, no-store`, y nada de acá tiene que pisarlo.
       *
       * Tampoco hace falta: sin CDN delante, el catálogo y el stock se arman en
       * cada pedido —que es lo que la propuesta promete, el stock real— y lo
       * que lo hace barato está abajo: las consultas salen de `unstable_cache`
       * con etiqueta (`lib/cache-publico.ts`), así que armar la página no
       * vuelve a la base.
       */

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
       * - `Strict-Transport-Security`: que el navegador no vuelva a intentar por
       *   `http://`. Vercel la ponía sola en sus dominios; en el servidor propio
       *   nadie la pone si no está acá. Va sin `includeSubDomains` a propósito:
       *   no sabemos qué otros subdominios tiene el dominio de la empresa —un
       *   correo, un sistema viejo— y esa opción los obligaría a todos a HTTPS
       *   por dos años. En `http://localhost` el navegador la ignora.
       *
       * **Viven solo acá**, también en el servidor propio: Caddy no agrega
       * ninguna. Tenerlas en dos lados es la forma de que un día digan cosas
       * distintas y nadie sepa cuál gana.
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
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
        ],
      },

      /*
       * **Fuera de producción, nada se indexa: tampoco las imágenes ni el
       * feed.** `robots.txt` prohíbe rastrear y cada página lleva `noindex`,
       * pero un PNG o un XML no tienen dónde llevar una etiqueta: la cabecera
       * es lo único que los alcanza. Se decide en el build, como `robots.txt`
       * (ver `sitioIndexable()`).
       */
      ...(sitioIndexable()
        ? []
        : [
            {
              source: "/:path*",
              headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
            },
          ]),
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
      /*
       * Las fotos que se suben desde el panel, en Vercel Blob. Faltaba: la
       * primera foto de producto cargada en producción iba a salir rota en
       * `next/image`, que rechaza todo host que no esté acá (1/10/2026). En el
       * servidor propio las muda `scripts/mudar-subidas.ts`; hasta que se
       * corra, sus URLs siguen apuntando acá.
       */
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
};

export default nextConfig;
