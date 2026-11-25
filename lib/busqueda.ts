/**
 * La misma búsqueda escrita de muchas formas, reducida a una sola.
 *
 * **Es una decisión de caché, no de búsqueda.** El término entra en la clave de
 * `productosCacheados`, así que «Fenólico », «fenolico» y «FENOLICO  18»
 * generaban tres entradas distintas para tres consultas que devuelven lo mismo
 * —la consulta ignora mayúsculas y acentos—. Peor todavía: cada término nuevo
 * que alguien escriba en la URL es una entrada más, y eso lo puede escribir
 * cualquiera, en cualquier cantidad, desde afuera.
 *
 * Lo que hace: recorta los espacios, pasa a minúsculas, saca los acentos,
 * colapsa los espacios de adentro y se queda con las primeras seis palabras y
 * sesenta caracteres, que es lo mismo que mira la búsqueda de Go (palabra por palabra, sin tildes).
 * Devuelve `undefined` cuando no queda nada, que es como se dice «sin filtro».
 */
export function normalizarBusqueda(texto?: string): string | undefined {
  if (!texto) return undefined;

  const limpio = texto
    .normalize("NFD")
    // Los diacríticos combinantes: es lo que `f_unaccent` saca del otro lado.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 6)
    .join(" ")
    .slice(0, 60)
    .trim();

  return limpio.length > 0 ? limpio : undefined;
}
