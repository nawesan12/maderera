import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Búsqueda tolerante para el catálogo.
 *
 * Quien busca escribe "fenolico 18" y espera encontrar "Fenólico — 1220 x 2440mm
 * — 18mm". Eso pide tres cosas que un ILIKE simple no da:
 *
 *  1. Ignorar acentos, porque nadie los escribe al buscar rápido.
 *  2. Tratar cada palabra por separado, porque el orden en que se escriben no
 *     coincide con el orden en que están guardadas.
 *  3. Mirar en varias columnas a la vez: el mismo término puede ser un nombre,
 *     un código o una marca.
 *
 * Cada término tiene que aparecer en alguna de las columnas (AND entre términos,
 * OR entre columnas): agregar palabras afina la búsqueda en lugar de ampliarla,
 * que es lo que la gente espera.
 */
export function coincideBusqueda(
  texto: string,
  columnas: PgColumn[],
): SQL | undefined {
  const terminos = texto
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 6); // más de seis palabras no afina nada y encarece la consulta

  if (terminos.length === 0 || columnas.length === 0) return undefined;

  const condicionesPorTermino = terminos.map((termino) => {
    const patron = `%${termino}%`;
    // `f_unaccent` y no `unaccent` a secas: es el envoltorio IMMUTABLE sobre el
    // que están construidos los índices GIN de trigramas (migración 0019).
    // Llamar al original directamente devuelve lo mismo pero deja los índices
    // sin usar, y la búsqueda vuelve a ser un barrido secuencial de la tabla.
    const porColumna = columnas.map(
      (columna) => sql`f_unaccent(${columna}) ILIKE f_unaccent(${patron})`,
    );
    return sql`(${sql.join(porColumna, sql` OR `)})`;
  });

  return sql`(${sql.join(condicionesPorTermino, sql` AND `)})`;
}
