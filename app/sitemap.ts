import type { MetadataRoute } from "next";
import { urlAbsoluta } from "@/lib/seo";
import {
  rutasDeCategorias,
  rutasDeEventos,
  rutasDelCatalogo,
} from "@/lib/dal/sitemap";

/**
 * Se arma una vez y se rehace cuando cambia el catálogo.
 *
 * Hasta el 1/10/2026 se armaba en cada pedido (`dynamic = "force-dynamic"`),
 * para que el build no necesitara la base. Con Cache Components esa opción no
 * existe, y tampoco hace falta: el build ya va contra la base, y las consultas
 * (`lib/dal/sitemap.ts`) llevan la etiqueta del catálogo, así que un producto
 * nuevo invalida el sitemap en el acto. Ir tres veces a la base por cada
 * rastreador que pasa —y pasan seguido— quedó atrás dos veces.
 */

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
  // La busca gente que todavía no conoce la maderera: "cuántas placas
  // necesito" se escribe en el buscador, no en el catálogo.
  { ruta: "/calculadora", prioridad: 0.7, frecuencia: "monthly" },
  // Lo mismo con "corte de melamina a medida": es el servicio que trae gente
  // al sitio, y la pantalla se puede usar sin cuenta.
  { ruta: "/corte", prioridad: 0.8, frecuencia: "monthly" },
  // La línea propia: es la página por la que llega un mayorista de la
  // provincia que busca molduras finger joint, no la maderera de al lado.
  { ruta: "/moldava", prioridad: 0.8, frecuencia: "monthly" },
  { ruta: "/sucursales", prioridad: 0.8, frecuencia: "monthly" },
  { ruta: "/profesionales", prioridad: 0.7, frecuencia: "monthly" },
  { ruta: "/eventos", prioridad: 0.6, frecuencia: "weekly" },
  { ruta: "/documentacion", prioridad: 0.5, frecuencia: "monthly" },
  { ruta: "/nosotros", prioridad: 0.5, frecuencia: "yearly" },
  { ruta: "/contacto", prioridad: 0.5, frecuencia: "yearly" },
  { ruta: "/cambios-y-devoluciones", prioridad: 0.4, frecuencia: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [productos, categorias, eventos] = await Promise.all([
    rutasDelCatalogo(),
    rutasDeCategorias(),
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
    ...eventos.map((e) => ({
      url: urlAbsoluta(e.ruta),
      lastModified: e.actualizada,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
