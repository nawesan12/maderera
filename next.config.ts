import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
