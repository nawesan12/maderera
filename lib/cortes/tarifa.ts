/**
 * Cuánto se cobra por cortar.
 *
 * Hasta ahora el corte **no se cobraba en ninguna parte del sistema**: ni
 * `cutting_orders` ni `cutting_items` tenían una columna de importe, y la única
 * forma de que entrara la plata era que el vendedor tipeara una línea suelta en
 * el mostrador con el número de memoria. Dos vendedores podían cobrar distinto
 * por el mismo trabajo.
 *
 * Los cuatro precios del brief:
 *
 * | material            | público  | mayorista |
 * |---------------------|----------|-----------|
 * | Placas              | $ 1.200  | $   996   |
 * | Tableros de madera  | $ 1.400  | $ 1.162   |
 *
 * Aritmética pura y con tests, como todo lo que mueve plata acá.
 */

export interface TarifaDeCorte {
  material: string;
  /** Nula significa "para cualquier lista": es el precio de público. */
  priceListId: string | null;
  precioPorPasada: number;
}

/** Deja el material comparable: sin tildes, sin espacios de más, en minúsculas. */
function comparable(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * La tarifa que corresponde a un material y a una lista de precios.
 *
 * **Cae a la tarifa general cuando la lista no tiene la suya**, por la misma
 * razón que el precio del catálogo: una lista alternativa rara vez tiene todo
 * cargado, y quedarse sin tarifa significaría no cobrar el corte.
 */
export function tarifaDeCorte(
  tarifas: TarifaDeCorte[],
  material: string,
  priceListId: string | null,
): TarifaDeCorte | null {
  const buscado = comparable(material);
  const delMaterial = tarifas.filter((t) => comparable(t.material) === buscado);

  if (priceListId) {
    const propia = delMaterial.find((t) => t.priceListId === priceListId);
    if (propia) return propia;
  }

  return delMaterial.find((t) => t.priceListId === null) ?? null;
}

/**
 * Lo que se cobra por el trabajo.
 *
 * Cero pasadas devuelve cero: es "todavía no se midió", y cobrar un mínimo
 * inventado sería peor que no cobrar. El importe es final, con IVA, como todo
 * el catálogo.
 */
export function cargoPorCorte(
  tarifa: TarifaDeCorte | null,
  pasadas: number,
): number {
  if (!tarifa || pasadas <= 0) return 0;
  return Math.round(tarifa.precioPorPasada * Math.floor(pasadas) * 100) / 100;
}
