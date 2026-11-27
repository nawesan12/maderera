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

/**
 * ¿Cada término empieza una palabra del heno? «laca» no es la mitad de
 * «placa» (mes simulado, M2S1-187). Es `coincidePalabra` de buscar.go.
 */
export function coincidePorPalabra(terminos: string[], heno: string): boolean {
  return terminos.every((termino) => {
    let i = heno.indexOf(termino);
    while (i >= 0) {
      if (i === 0 || !/[\p{L}\p{N}]/u.test(heno[i - 1])) return true;
      i = heno.indexOf(termino, i + 1);
    }
    return false;
  });
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
  /**
   * La medida de la placa, cuando la variante la tiene.
   *
   * Va en la copia porque el buscador del mostrador lee de acá **también
   * estando en línea**, y sin las dos medidas no se puede ofrecer cortar.
   */
  largoMm?: number | null;
  anchoMm?: number | null;
  /** La familia del producto. Por acá se busca la tarifa de corte. */
  categoria?: string | null;
  /**
   * Cómo se vende la placa y cuánto vale la media. Opcionales porque una
   * copia local bajada antes del 1/10/2026 no los trae: sin ellos la placa se
   * vende entera, que es lo que pasaba hasta entonces.
   */
  formaDeVenta?: "entera" | "entera_o_media" | "metro_cuadrado";
  precioMediaPct?: number;
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

  // Los números tipeados («mdf 18») valen más cuando están enteros en el
  // nombre o la medida («18 mm») que metidos en otro número («1830 x
  // 2600mm»): con el orden por nombre quedaba marcado el MDF de 3 mm (mes
  // simulado, H017). Es `numerosSueltos` de buscar.go.
  const numeros = terminos.filter((t) => /^\d+$/.test(t)).map((t) => new RegExp(`(^|[^0-9])${t}([^0-9]|$)`));
  const puntaje = (v: VarianteLocal): number => {
    const sku = normalizar(v.sku);
    if (sku === consulta) return 0;
    if (sku.startsWith(consulta)) return 1;
    const nombre = normalizar(`${v.producto} ${v.medida}`);
    const sueltos = numeros.filter((n) => !n.test(nombre)).length;
    if (normalizar(v.producto).startsWith(consulta)) return 2 + sueltos;
    return 3 + sueltos;
  };

  // Primero lo que tiene una palabra que empieza con cada término; si no hay
  // nada, lo que lo contiene en cualquier lado (como buscar.go).
  const contienen = indice.filter((v) => coincideLocal(terminos, v.busqueda));
  const porPalabra = contienen.filter((v) => coincidePorPalabra(terminos, v.busqueda));
  return (porPalabra.length > 0 ? porPalabra : contienen)
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
  /** Viene en la copia desde siempre; opcional para las copias viejas. */
  estado?: string;
  limiteCredito?: number;
  /** Desde la revisión del carril F; las copias viejas no lo traen. */
  cuentaBloqueada?: boolean;
  busqueda: string;
}

export function buscarClientesLocal(
  indice: ClienteLocal[],
  texto: string,
  tope = 40,
): ClienteLocal[] {
  const terminos = terminosDe(texto);
  if (terminos.length === 0) return [];

  // Se devuelven todos los que coinciden, hasta un tope holgado: el orden lo
  // decide quien llama con `ordenarClientes`, y recortar antes de ordenar
  // dejaba afuera al cliente exacto si había muchos parecidos.
  return indice.filter((c) => coincideLocal(terminos, c.busqueda)).slice(0, tope);
}
