import type { MetadataRoute } from "next";
import { urlParaSitemap } from "@/lib/seo";
import { SUCURSALES } from "@/lib/sucursales";
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
 * nuevo invalida el sitemap en el acto. Ir varias veces a la base por cada
 * rastreador que pasa —y pasan seguido— quedó atrás dos veces.
 */

/**
 * Prioridades: no son un ranking, son una señal de por dónde empezar a
 * rastrear. La portada y el catálogo primero, las fichas de producto después
 * —que son las que traen a alguien que busca algo concreto— y las páginas
 * institucionales al final, que no cambian nunca.
 *
 * **`lastmod` solo cuando se sabe.** Antes todas las fijas declaraban «ahora»
 * en cada armado; Google lo detecta —la fecha cambia y la página no— y deja de
 * creerle al `lastmod` del sitio entero, incluido el de las fichas, que es el
 * que sí importa. Las páginas que muestran el catálogo (portada, catálogo,
 * stock) toman la fecha del último cambio del catálogo; las institucionales
 * van sin fecha.
 */
const FIJAS: {
  ruta: string;
  prioridad: number;
  frecuencia: MetadataRoute.Sitemap[number]["changeFrequency"];
  conElCatalogo?: boolean;
}[] = [
  { ruta: "/", prioridad: 1, frecuencia: "weekly", conElCatalogo: true },
  { ruta: "/catalogo", prioridad: 0.9, frecuencia: "daily", conElCatalogo: true },
  { ruta: "/stock", prioridad: 0.6, frecuencia: "daily", conElCatalogo: true },
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
  { ruta: "/cambios-y-devoluciones", prioridad: 0.3, frecuencia: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [productos, categorias, eventos] = await Promise.all([
    rutasDelCatalogo(),
    rutasDeCategorias(),
    rutasDeEventos(),
  ]);

  // La consulta viene ordenada por fecha: la primera es el último cambio.
  const ultimoCambio = productos[0]?.actualizada;

  const imagenes = (lista?: string[]) =>
    lista && lista.length > 0 ? { images: lista.map((i) => urlParaSitemap(i)) } : {};

  return [
    ...FIJAS.map((f) => ({
      url: urlParaSitemap(f.ruta),
      ...(f.conElCatalogo && ultimoCambio ? { lastModified: ultimoCambio } : {}),
      changeFrequency: f.frecuencia,
      priority: f.prioridad,
    })),
    // Una ficha por sucursal: es la página a la que apunta su Perfil de
    // Empresa en Google.
    ...SUCURSALES.map((s) => ({
      url: urlParaSitemap(`/sucursales/${s.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.8,
      ...imagenes(s.foto ? [s.foto.ruta] : []),
    })),
    ...categorias.map((c) => ({
      url: urlParaSitemap(c.ruta),
      lastModified: c.actualizada,
      changeFrequency: "daily" as const,
      // Un rubro (`&rubro=`) es más angosto que su categoría.
      priority: c.ruta.includes("&rubro=") ? 0.7 : 0.8,
      ...imagenes(c.imagenes),
    })),
    ...productos.map((p) => ({
      url: urlParaSitemap(p.ruta),
      lastModified: p.actualizada,
      changeFrequency: "weekly" as const,
      priority: 0.7,
      ...imagenes(p.imagenes),
    })),
    ...eventos.map((e) => ({
      url: urlParaSitemap(e.ruta),
      lastModified: e.actualizada,
      changeFrequency: "weekly" as const,
      priority: 0.5,
      ...imagenes(e.imagenes),
    })),
  ];
}
