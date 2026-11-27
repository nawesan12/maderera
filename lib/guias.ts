import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { markdownAHtml, markdownATexto, markdownAPlano } from "@/lib/markdown";
import type { RolStaff } from "@/lib/roles";

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
  /** Los puestos para los que está escrita; `null` es todo el personal. */
  para: RolStaff[] | null;
}

/**
 * Cada puesto ve sus guías, y en cada guía lo que puede hacer (mes simulado,
 * M2S3-073 y M2S4-071): al vendedor le abrían Compras, Cerrar el mes y
 * Precios, y «Si algo sale mal» lo mandaba a Bitácora y Avisos, que no abre.
 *
 * - La cabecera `para: admin, vendedor` dice a quién es la guía (sin `para`,
 *   a todos).
 * - Adentro, un bloque entre `<!-- solo: admin, vendedor -->` y
 *   `<!-- /solo -->` se muestra solo a esos puestos.
 */
function leerRoles(texto: string | undefined): RolStaff[] | null {
  if (!texto) return null;
  return texto
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean) as RolStaff[];
}

export function cuerpoPara(markdown: string, rol: RolStaff | null): string {
  return markdown.replace(
    /<!--\s*solo:\s*([^>]*?)\s*-->\n?([\s\S]*?)<!--\s*\/solo\s*-->\n?/g,
    (_, roles: string, bloque: string) => (rol === null || leerRoles(roles)!.includes(rol) ? bloque : ""),
  );
}

/** La guía como la ve ese puesto, o `null` si no es para él. */
export function guiaPara(guia: Guia, rol: RolStaff | null): Guia | null {
  if (rol !== null && guia.para && !guia.para.includes(rol)) return null;
  if (!guia.markdown.includes("<!--")) return guia;
  const markdown = cuerpoPara(guia.markdown, rol);
  return { ...guia, markdown, html: markdownAHtml(markdown), secciones: seccionesDe(markdown) };
}

function seccionesDe(cuerpo: string): string[] {
  return cuerpo
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.slice(3).trim());
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
const todasLasGuias = cache(async (): Promise<Guia[]> => {
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
        secciones: seccionesDe(cuerpo),
        para: leerRoles(datos.para),
      } satisfies Guia;
    }),
  );

  return guias.sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo));
});

/** Las guías de ese puesto, ya recortadas; `null` las trae todas enteras. */
export async function listarGuias(rol: RolStaff | null = null): Promise<Guia[]> {
  return (await todasLasGuias()).map((g) => guiaPara(g, rol)).filter((g): g is Guia => g !== null);
}

export async function obtenerGuia(slug: string, rol: RolStaff | null = null): Promise<Guia | null> {
  const guias = await listarGuias(rol);
  return guias.find((g) => g.slug === slug) ?? null;
}

/**
 * Busca en el texto completo de las guías.
 *
 * Sin acentos y en minúsculas: nadie escribe "cuenta corriente" con tilde en un
 * buscador, y quien viene de un sistema de escritorio busca la palabra que
 * escuchó, no el título de la guía.
 */
export async function buscarEnGuias(termino: string, rol: RolStaff | null = null) {
  return buscarEn(await listarGuias(rol), termino);
}

/**
 * Palabra por palabra y no la frase exacta: «cheque rechazado» daba «Nada» y
 * «cheque» encontraba cuatro guías (mes simulado, M3S4-030). Sale toda guía
 * que tenga alguna de las palabras, primero las que tienen más, y las que la
 * tienen en el título. Las palabras cortas y de relleno no cuentan.
 */
export function buscarEn(guias: Guia[], termino: string) {
  const palabras = [...new Set(normalizar(termino).split(/[^a-z0-9ñ]+/))].filter(
    (p) => p.length >= 3 && !VACIAS.has(p),
  );
  if (palabras.length === 0) return [];

  return guias
    .map((guia) => {
      // Se busca y se recorta sobre el texto plano, no sobre el Markdown: el
      // extracto tiene que leerse como una frase y no como `**Cómo compra**`.
      const plano = markdownAPlano(guia.markdown);
      const normal = normalizar(plano);
      // La frase entera, si está, es el mejor lugar para el extracto.
      const frase = normalizar(termino);
      const posiciones = palabras.map((p) => buscarPalabra(normal, p)).filter((i) => i !== -1);
      if (posiciones.length === 0) return null;
      const exacta = normal.indexOf(frase);
      const posicion = exacta !== -1 ? exacta : Math.min(...posiciones);

      // Un pedazo del texto alrededor de lo encontrado, para que se entienda
      // por qué salió ese resultado.
      const desde = Math.max(0, posicion - 60);
      const contexto = plano.slice(desde, posicion + 140).trim();
      const titulo = normalizar(guia.titulo);

      return {
        guia,
        contexto: `${desde > 0 ? "…" : ""}${contexto}…`,
        aciertos: posiciones.length + (exacta !== -1 ? 1 : 0),
        // Un acierto en el título pesa más que uno perdido en el cuerpo.
        peso: palabras.some((p) => titulo.includes(p)) ? 0 : 1,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.aciertos - a.aciertos || a.peso - b.peso || a.guia.orden - b.guia.orden)
    .map(({ guia, contexto }) => ({ guia, contexto }));
}

/**
 * La palabra al principio de una palabra del texto, para que «cheque»
 * encuentre «cheques» pero «ope» no encuentre «cooperativa».
 */
function buscarPalabra(texto: string, palabra: string): number {
  let i = texto.indexOf(palabra);
  while (i !== -1) {
    if (i === 0 || !/[a-z0-9ñ]/.test(texto[i - 1]!)) return i;
    i = texto.indexOf(palabra, i + 1);
  }
  return -1;
}

const VACIAS = new Set([
  "que", "con", "por", "para", "los", "las", "del", "una", "uno", "unos", "unas", "como", "cuando", "donde",
  "esta", "este", "eso", "esa", "ese", "hay", "hace", "mas", "sin", "sus", "les", "nos", "pero", "porque",
]);

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
