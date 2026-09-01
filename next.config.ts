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
  images: {
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
