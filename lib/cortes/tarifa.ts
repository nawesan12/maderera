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
  /** El metro lineal de tapacanto pegado. Cero es "no se cobra". */
  precioPorMetroCanto: number;
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

export interface PiezaConCanto {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  /** Cuántos lados de cada medida llevan canto: 0, 1 o 2. */
  cantoLargo: number;
  cantoAncho: number;
}

/**
 * Los metros lineales de tapacanto de un despiece.
 *
 * Es la cuenta de la planilla del taller: por cada pieza, el largo por sus
 * lados con canto más el ancho por los suyos, por la cantidad. Los valores de
 * canto se acotan a 0–2 antes de multiplicar: un 3 tipeado no es "tres lados",
 * es un error, y silenciarlo multiplicando cobraría metros que no existen.
 */
export function metrosDeTapacanto(piezas: PiezaConCanto[]): number {
  const acotar = (n: number) => Math.min(Math.max(Math.trunc(n) || 0, 0), 2);

  const mm = piezas.reduce((suma, p) => {
    const cantidad = Math.max(Math.trunc(p.cantidad) || 0, 0);
    return (
      suma +
      cantidad *
        (acotar(p.cantoLargo) * (p.largoMm || 0) +
          acotar(p.cantoAncho) * (p.anchoMm || 0))
    );
  }, 0);

  return Math.round((mm / 1000) * 100) / 100;
}

/**
 * Lo que se cobra por el pegado. Aparte del corte: son dos servicios y la
 * ficha los muestra por separado, que es como se explica el número.
 */
export function cargoPorTapacanto(
  tarifa: TarifaDeCorte | null,
  metros: number,
): number {
  if (!tarifa || metros <= 0 || tarifa.precioPorMetroCanto <= 0) return 0;
  return Math.round(tarifa.precioPorMetroCanto * metros * 100) / 100;
}
