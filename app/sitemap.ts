import type { MetadataRoute } from "next";
import { urlAbsoluta } from "@/lib/seo";
import {
  rutasDeCategorias,
  rutasDeEventos,
  rutasDelBlog,
  rutasDelCatalogo,
} from "@/lib/dal/sitemap";

/**
 * Se arma en cada pedido y no en el build.
 *
 * El resto del sitio se renderiza por pedido, así que el build no necesita una
 * base alcanzable; generar el sitemap al compilar rompería esa propiedad para
 * ganar poco, porque un sitemap lo piden los buscadores un puñado de veces por
 * día. A cambio, una nota publicada o un producto nuevo aparecen enseguida.
 */
export const dynamic = "force-dynamic";

/**
 * Prioridades: no son un ranking, son una señal de por dónde empezar a
 * rastrear. La portada y el catálogo primero, las fichas de producto después
 * —que son las que traen a alguien que busca algo concreto— y las páginas
 * institucionales al final, que no cambian nunca.
 */
const FIJAS: { ruta: string; prioridad: number; frecuencia: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { ruta: "/", prioridad: 1, frecuencia: "weekly" },
  { ruta: "/catalogo", prioridad: 0.9, frecuencia: "daily" },
  { ruta: "/stock", prioridad: 0.8, frecuencia: "daily" },
  { ruta: "/sucursales", prioridad: 0.8, frecuencia: "monthly" },
  { ruta: "/calculadora", prioridad: 0.7, frecuencia: "monthly" },
  { ruta: "/blog", prioridad: 0.7, frecuencia: "weekly" },
  { ruta: "/profesionales", prioridad: 0.7, frecuencia: "monthly" },
  { ruta: "/eventos", prioridad: 0.6, frecuencia: "weekly" },
  { ruta: "/documentacion", prioridad: 0.5, frecuencia: "monthly" },
  { ruta: "/nosotros", prioridad: 0.5, frecuencia: "yearly" },
  { ruta: "/contacto", prioridad: 0.5, frecuencia: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [productos, categorias, blog, eventos] = await Promise.all([
    rutasDelCatalogo(),
    rutasDeCategorias(),
    rutasDelBlog(),
    rutasDeEventos(),
  ]);

  const ahora = new Date();

  return [
    ...FIJAS.map((f) => ({
      url: urlAbsoluta(f.ruta),
      lastModified: ahora,
      changeFrequency: f.frecuencia,
      priority: f.prioridad,
    })),
    ...categorias.map((c) => ({
      url: urlAbsoluta(c.ruta),
      lastModified: c.actualizada,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...productos.map((p) => ({
      url: urlAbsoluta(p.ruta),
      lastModified: p.actualizada,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...blog.map((b) => ({
      url: urlAbsoluta(b.ruta),
      lastModified: b.actualizada,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...eventos.map((e) => ({
      url: urlAbsoluta(e.ruta),
      lastModified: e.actualizada,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
