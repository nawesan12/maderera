import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { markdownAHtml, markdownATexto, markdownAPlano } from "@/lib/markdown";

/**
 * Las guías de uso del panel (cláusula 1.10).
 *
 * Viven como archivos Markdown en `docs/GUIAS/` y no como filas en la base, por
 * dos razones: se escriben y se corrigen con el resto del código —una guía que
 * describe una pantalla tiene que cambiar en el mismo commit que la pantalla— y
 * el cliente se lleva los `.md` como documentación aparte, que es lo que pide el
 * contrato además de tenerlas dentro del panel.
 *
 * Se leen del disco en el servidor. `next.config.ts` incluye la carpeta en el
 * empaquetado para que estén también en producción.
 */

const CARPETA = path.join(process.cwd(), "docs", "GUIAS");

export interface Guia {
  slug: string;
  titulo: string;
  resumen: string;
  orden: number;
  /** El cuerpo en Markdown, sin la cabecera de datos. */
  markdown: string;
  html: string;
  /** Los `##` del cuerpo, para el índice lateral. */
  secciones: string[];
}

/**
 * Separa la cabecera de datos del cuerpo.
 *
 * Es el mismo formato que usa cualquier generador de sitios estáticos: tres
 * guiones, unos pares `clave: valor`, tres guiones. Se lee a mano en vez de
 * sumar una librería porque son tres claves y ninguna anidada.
 */
function separarCabecera(texto: string): {
  datos: Record<string, string>;
  cuerpo: string;
} {
  const coincide = texto.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!coincide) return { datos: {}, cuerpo: texto };

  const datos: Record<string, string> = {};

  for (const linea of coincide[1].split("\n")) {
    const corte = linea.indexOf(":");
    if (corte === -1) continue;
    datos[linea.slice(0, corte).trim()] = linea.slice(corte + 1).trim();
  }

  return { datos, cuerpo: coincide[2] };
}

/**
 * Todas las guías, ordenadas.
 *
 * `cache()` la memoiza dentro de un mismo render: el índice y el detalle la
 * llaman las dos y no tiene sentido leer el disco dos veces.
 */
export const listarGuias = cache(async (): Promise<Guia[]> => {
  let archivos: string[];

  try {
    archivos = (await readdir(CARPETA)).filter((a) => a.endsWith(".md"));
  } catch {
    // Sin la carpeta, la pantalla muestra su estado vacío en vez de romperse.
    return [];
  }

  const guias = await Promise.all(
    archivos.map(async (archivo) => {
      const crudo = await readFile(path.join(CARPETA, archivo), "utf8");
      const { datos, cuerpo } = separarCabecera(crudo);

      // El número del nombre del archivo solo ordena; no va en la dirección.
      const slug = archivo.replace(/\.md$/, "").replace(/^\d+-/, "");

      return {
        slug,
        titulo: datos.titulo || slug.replace(/-/g, " "),
        resumen: datos.resumen || markdownATexto(cuerpo, 160),
        orden: Number(datos.orden ?? 99),
        markdown: cuerpo,
        html: markdownAHtml(cuerpo),
        secciones: cuerpo
          .split("\n")
          .filter((l) => l.startsWith("## "))
          .map((l) => l.slice(3).trim()),
      } satisfies Guia;
    }),
  );

  return guias.sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo));
});

export async function obtenerGuia(slug: string): Promise<Guia | null> {
  const guias = await listarGuias();
  return guias.find((g) => g.slug === slug) ?? null;
}

/**
 * Busca en el texto completo de las guías.
 *
 * Sin acentos y en minúsculas: nadie escribe "cuenta corriente" con tilde en un
 * buscador, y quien viene de un sistema de escritorio busca la palabra que
 * escuchó, no el título de la guía.
 */
export async function buscarEnGuias(termino: string) {
  const limpio = normalizar(termino);
  if (limpio.length < 2) return [];

  const guias = await listarGuias();

  return guias
    .map((guia) => {
      // Se busca y se recorta sobre el texto plano, no sobre el Markdown: el
      // extracto tiene que leerse como una frase y no como `**Cómo compra**`.
      const plano = markdownAPlano(guia.markdown);
      const posicion = normalizar(plano).indexOf(limpio);
      if (posicion === -1) return null;

      // Un pedazo del texto alrededor de lo encontrado, para que se entienda
      // por qué salió ese resultado.
      const desde = Math.max(0, posicion - 60);
      const contexto = plano.slice(desde, posicion + 140).trim();

      return {
        guia,
        contexto: `${desde > 0 ? "…" : ""}${contexto}…`,
        // Un acierto en el título pesa más que uno perdido en el cuerpo.
        peso: normalizar(guia.titulo).includes(limpio) ? 0 : 1,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.peso - b.peso || a.guia.orden - b.guia.orden);
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
