/**
 * Relevamiento del sitio viejo (`mjbj.ar`, un WordPress con WooCommerce).
 *
 * El día de la mudanza `mjbj.ar` deja de servir el WordPress y pasa a
 * redirigir a `mjbj.com.ar`. Lo que Google tenía indexado del sitio viejo se
 * conserva **solo** si cada dirección vieja manda a su equivalente nueva con
 * un 301; lo que caiga en un 404 se pierde, y no hay forma de recuperarlo
 * después, porque el WordPress ya no existe para volver a mirarlo.
 *
 * Por eso esto queda como script y su salida como dato en el repo
 * (`docs/sitio-viejo/relevamiento.json`): el mapa de redirecciones
 * (`lib/sitio-viejo.ts`) se arma contra ese archivo, y un test verifica que
 * cada dirección relevada tenga una decisión tomada. Si alguien vuelve a correr
 * el relevamiento mientras el WordPress siga en pie y aparece algo nuevo, el
 * test lo dice.
 *
 * Qué mira, en este orden:
 *
 * 1. Los sitemaps que publica Yoast (`sitemap_index.xml` y los que lista).
 * 2. La API de WordPress: páginas, entradas, productos, categorías de producto
 *    y de entradas. Es más completa que el sitemap —Yoast deja afuera lo que
 *    está marcado como no indexable, pero Google pudo haberlo visto antes—.
 * 3. La mediateca (`/wp-json/wp/v2/media`): cada imagen y PDF subido, con la
 *    página de adjunto que WordPress le arma a cada uno.
 *
 * Uso: `npx tsx scripts/relevar-sitio-viejo.ts`. No necesita base ni
 * variables de entorno. Después de la mudanza ya no hay nada que relevar: el
 * archivo del repo es la única copia.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ORIGEN = process.env.SITIO_VIEJO ?? "https://mjbj.ar";
const SALIDA = join(process.cwd(), "docs/sitio-viejo/relevamiento.json");
const AGENTE = "mjbj-relevamiento/1.0 (+https://mjbj.com.ar)";

export interface UrlRelevada {
  /** La ruta, sin dominio, tal como la publica WordPress (con barra final). */
  ruta: string;
  tipo:
    | "pagina"
    | "entrada"
    | "producto"
    | "categoria-producto"
    | "categoria"
    | "bloque"
    | "adjunto"
    | "archivo"
    | "sitemap"
    | "otro";
  titulo?: string;
  modificada?: string;
  /** De dónde salió: «sitemap», «api» o los dos. */
  fuentes: string[];
  /** Para un archivo de la mediateca: la página de adjunto que lo contiene. */
  adjunto?: string;
}

async function texto(url: string): Promise<string | null> {
  const r = await fetch(url, { headers: { "user-agent": AGENTE } });
  if (!r.ok) return null;
  return r.text();
}

async function json<T>(url: string): Promise<{ datos: T; paginas: number } | null> {
  const r = await fetch(url, { headers: { "user-agent": AGENTE } });
  if (!r.ok) return null;
  return {
    datos: (await r.json()) as T,
    paginas: Number(r.headers.get("x-wp-totalpages") ?? "1"),
  };
}

/** Todas las páginas de un listado de la API de WordPress. */
async function todo<T>(ruta: string): Promise<T[]> {
  const salida: T[] = [];
  for (let pagina = 1; ; pagina++) {
    const sep = ruta.includes("?") ? "&" : "?";
    const r = await json<T[]>(`${ORIGEN}${ruta}${sep}per_page=100&page=${pagina}`);
    if (!r || !Array.isArray(r.datos)) break;
    salida.push(...r.datos);
    if (pagina >= r.paginas) break;
  }
  return salida;
}

const aRuta = (url: string) => {
  const u = new URL(url.replace(/&amp;/g, "&"), ORIGEN);
  return u.pathname + u.search;
};

const locs = (xml: string) =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)].map(
    (m) => ({ url: m[1].trim(), modificada: m[2]?.trim() }),
  );

const sinHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&#8211;/g, "–")
    .replace(/&amp;/g, "&")
    .trim();

async function main() {
  const urls = new Map<string, UrlRelevada>();

  const sumar = (u: Omit<UrlRelevada, "fuentes">, fuente: string) => {
    const previa = urls.get(u.ruta);
    if (previa) {
      if (!previa.fuentes.includes(fuente)) previa.fuentes.push(fuente);
      previa.titulo ??= u.titulo;
      previa.modificada ??= u.modificada;
      previa.adjunto ??= u.adjunto;
      return;
    }
    urls.set(u.ruta, { ...u, fuentes: [fuente] });
  };

  // 1. Sitemaps.
  const indice = await texto(`${ORIGEN}/sitemap_index.xml`);
  if (indice) {
    sumar({ ruta: "/sitemap_index.xml", tipo: "sitemap" }, "sitemap");
    for (const { url } of locs(indice)) {
      const ruta = aRuta(url);
      sumar({ ruta, tipo: "sitemap" }, "sitemap");
      const xml = await texto(url);
      if (!xml) continue;
      const tipo: UrlRelevada["tipo"] = ruta.startsWith("/blocks")
        ? "bloque"
        : ruta.startsWith("/local")
          ? "otro"
          : "pagina";
      for (const l of locs(xml)) {
        sumar({ ruta: aRuta(l.url), tipo, modificada: l.modificada }, "sitemap");
      }
    }
  }

  // 2. La API.
  type Pagina = { link: string; title: { rendered: string }; modified: string };
  type Termino = { link: string; name: string; count: number };

  for (const p of await todo<Pagina>("/wp-json/wp/v2/pages?_fields=link,title,modified")) {
    sumar({ ruta: aRuta(p.link), tipo: "pagina", titulo: sinHtml(p.title.rendered), modificada: p.modified }, "api");
  }
  for (const p of await todo<Pagina>("/wp-json/wp/v2/posts?_fields=link,title,modified")) {
    sumar({ ruta: aRuta(p.link), tipo: "entrada", titulo: sinHtml(p.title.rendered), modificada: p.modified }, "api");
  }
  for (const p of await todo<Pagina>("/wp-json/wp/v2/product?_fields=link,title,modified")) {
    sumar({ ruta: aRuta(p.link), tipo: "producto", titulo: sinHtml(p.title.rendered), modificada: p.modified }, "api");
  }
  for (const t of await todo<Termino>("/wp-json/wp/v2/product_cat?_fields=link,name,count")) {
    sumar({ ruta: aRuta(t.link), tipo: "categoria-producto", titulo: sinHtml(t.name) }, "api");
  }
  for (const t of await todo<Termino>("/wp-json/wp/v2/categories?_fields=link,name,count")) {
    sumar({ ruta: aRuta(t.link), tipo: "categoria", titulo: sinHtml(t.name) }, "api");
  }

  // 3. La mediateca: el archivo y su página de adjunto.
  type Medio = { link: string; source_url: string; title: { rendered: string } };
  for (const m of await todo<Medio>("/wp-json/wp/v2/media?_fields=link,source_url,title")) {
    const adjunto = aRuta(m.link).replace(/#.*$/, "");
    sumar({ ruta: adjunto, tipo: "adjunto", titulo: sinHtml(m.title.rendered) }, "api");
    sumar({ ruta: aRuta(m.source_url), tipo: "archivo", adjunto }, "api");
  }

  const lista = [...urls.values()].sort((a, b) => a.ruta.localeCompare(b.ruta));

  await mkdir(dirname(SALIDA), { recursive: true });
  await writeFile(
    SALIDA,
    JSON.stringify({ origen: ORIGEN, relevado: new Date().toISOString(), urls: lista }, null, 2) + "\n",
  );

  const porTipo = lista.reduce<Record<string, number>>((acc, u) => {
    acc[u.tipo] = (acc[u.tipo] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`${lista.length} direcciones relevadas en ${ORIGEN}:`, porTipo);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
