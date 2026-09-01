import type { MetadataRoute } from "next";
import { sitioIndexable, urlAbsoluta } from "@/lib/seo";

/**
 * Qué puede recorrer un buscador.
 *
 * Dos criterios. Primero, **fuera de producción no se indexa nada**: cada
 * vista previa queda publicada en una URL real y alcanzable, y si Google las
 * encuentra el sitio termina compitiendo consigo mismo con varias copias del
 * catálogo.
 *
 * Segundo, adentro del sitio quedan afuera las pantallas que no son contenido
 * y que además exponen datos de alguien: el panel, la cuenta del cliente, el
 * checkout, el remito que se firma y el puesto de atención. No es una medida
 * de seguridad —eso lo hace la sesión—, es no gastar el presupuesto de rastreo
 * en páginas que devuelven una redirección al login.
 */
export default function robots(): MetadataRoute.Robots {
  if (!sitioIndexable()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/atencion",
        "/mi-cuenta",
        "/checkout",
        "/presupuesto",
        "/pedido",
        "/remito",
        "/firmar",
        "/pago-demo",
        "/ingresar",
        "/registro",
        "/api/",
      ],
    },
    sitemap: urlAbsoluta("/sitemap.xml"),
  };
}
