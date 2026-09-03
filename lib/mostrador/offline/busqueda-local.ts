/**
 * La búsqueda del mostrador, hecha en el navegador.
 *
 * `lib/busqueda.ts` arma SQL de Drizzle y no sirve acá. Esto es la misma regla
 * escrita en TypeScript: sin acentos, cada término tiene que aparecer en algún
 * campo (Y entre términos, O entre campos), y agregar palabras **afina** en vez
 * de ampliar, que es lo que la gente espera.
 *
 * **`normalizar` se usa de los dos lados.** El endpoint que arma la copia local
 * la importa para construir el campo `busqueda` de cada variante, y el
 * navegador la usa para normalizar lo que se tipea. Así no hay dos
 * normalizadores que puedan discrepar —que es exactamente el problema que
 * tendría reimplementar `f_unaccent` a ojo— y de paso ocho mil filas no se
 * normalizan de nuevo en cada tecla.
 */

/** Minúsculas y sin acentos. El equivalente de `f_unaccent` en el navegador. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Más de seis términos no afinan nada y cuestan. Es el mismo tope que el SQL. */
const TOPE_TERMINOS = 6;

export function terminosDe(texto: string): string[] {
  return normalizar(texto)
    .split(" ")
    .filter((t) => t.length > 0)
    .slice(0, TOPE_TERMINOS);
}

/** ¿El heno ya normalizado contiene todos los términos? */
export function coincideLocal(terminos: string[], heno: string): boolean {
  return terminos.every((termino) => heno.includes(termino));
}

export interface VarianteLocal {
  variantId: string;
  sku: string;
  producto: string;
  medida: string;
  unidad: string;
  /** Todo lo buscable, ya normalizado por el servidor. */
  busqueda: string;
  sortOrder: number;
}

/**
 * Las variantes que coinciden, en el mismo orden que devuelve el servidor.
 *
 * Primero la coincidencia exacta de código, después la que empieza con lo
 * tipeado, y recién ahí la difusa. Quien pasa un código de barras o lo tipea
 * entero espera ver eso primero y no un producto que lo contiene en el medio.
 */
export function buscarVariantes(
  indice: VarianteLocal[],
  texto: string,
  tope = 12,
): VarianteLocal[] {
  const terminos = terminosDe(texto);
  if (terminos.length === 0) return [];

  const consulta = terminos.join(" ");

  const puntaje = (v: VarianteLocal): number => {
    const sku = normalizar(v.sku);
    if (sku === consulta) return 0;
    if (sku.startsWith(consulta)) return 1;
    if (normalizar(v.producto).startsWith(consulta)) return 2;
    return 3;
  };

  return indice
    .filter((v) => coincideLocal(terminos, v.busqueda))
    .map((v) => ({ v, p: puntaje(v) }))
    .sort((a, b) => a.p - b.p || a.v.sortOrder - b.v.sortOrder)
    .slice(0, tope)
    .map((x) => x.v);
}

export interface ClienteLocal {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: string;
  priceListId: string | null;
  busqueda: string;
}

export function buscarClientesLocal(
  indice: ClienteLocal[],
  texto: string,
  tope = 8,
): ClienteLocal[] {
  const terminos = terminosDe(texto);
  if (terminos.length === 0) return [];

  return indice
    .filter((c) => coincideLocal(terminos, c.busqueda))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .slice(0, tope);
}
