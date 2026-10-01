/**
 * Cantidades de stock y de venta: cuándo admiten decimales y cómo se escriben.
 *
 * El stock se lleva **en la unidad de venta** del producto: el zócalo que se
 * vende por metro se cuenta en metros, la placa en placas. Con eso, vender
 * 3,7 m descuenta 3,7 y vender media placa descuenta 0,5 sin ninguna tabla de
 * conversión entre medio.
 *
 * Lo que no admite fracción no la admite en ningún lado: no existe media
 * bisagra, y un ajuste de stock de 2,5 bisagras es un error de tipeo.
 */

/**
 * Unidades que se venden o se cuentan en fracciones.
 *
 * `placa` está porque se venden medias placas, y la mitad que queda en el
 * depósito tiene que figurar. El resto se mide, no se cuenta.
 */
const FRACCIONABLES = new Set([
  "metro_lineal",
  "metro_cuadrado",
  "placa",
  "kg",
  "litro",
]);

export function admiteDecimales(unidad: string | null | undefined): boolean {
  return unidad ? FRACCIONABLES.has(unidad) : false;
}

/**
 * Redondea una cantidad de stock a la precisión de la columna (tres
 * decimales).
 *
 * Sin esto, 0,1 + 0,2 guarda 0,30000000000000004 y un descuento que debería
 * dejar el stock en cero lo deja en un residuo que nadie puede explicar.
 */
export function cantidadDeStock(valor: number): number {
  return Math.round(valor * 1000) / 1000;
}

/**
 * Paso del campo numérico para una unidad: de a uno lo que se cuenta, de a
 * décima lo que se mide (los metros se tipean "3,7", no "3,725").
 */
export function pasoDeCantidad(unidad: string | null | undefined): number {
  if (!admiteDecimales(unidad)) return 1;
  return unidad === "placa" ? 0.5 : 0.1;
}

const NUMERO = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

/** «3,5», «28,8», «12»: sin ceros de más ni punto decimal en inglés. */
export function formatearCantidad(valor: number): string {
  return NUMERO.format(cantidadDeStock(valor));
}

/**
 * Metros que suman N piezas de un largo dado.
 *
 * Es la cuenta de quien descarga un camión de zócalos: no mide el total, cuenta
 * piezas de 2,40 m. El sistema guarda metros, que es como se venden.
 */
export function metrosDePiezas(piezas: number, largoMm: number): number {
  return cantidadDeStock((piezas * largoMm) / 1000);
}

/**
 * Cuántas piezas enteras y cuántos metros sueltos hay en un total.
 *
 * «28,8 m» se lee mejor como «12 piezas de 2,40»; lo que sobra después de
 * vender por metro es un recorte, y se dice aparte.
 */
export function piezasDeMetros(
  metros: number,
  largoMm: number,
): { piezas: number; resto: number } {
  if (largoMm <= 0) return { piezas: 0, resto: cantidadDeStock(metros) };
  const largo = largoMm / 1000;
  // El épsilon evita que 28,8 / 2,4 = 11,999999 cuente 11 piezas.
  const piezas = Math.floor(metros / largo + 1e-9);
  return { piezas, resto: cantidadDeStock(metros - piezas * largo) };
}

const NOMBRE_LARGO: Record<string, string> = {
  unidad: "unidad",
  metro_lineal: "metro",
  metro_cuadrado: "metro cuadrado",
  tabla: "tabla",
  placa: "placa",
  rollo: "rollo",
  par: "par",
  juego: "juego",
  kg: "kilo",
  litro: "litro",
};

/** «unidad», «metro», «placa»: la unidad dicha en una oración. */
export function formatearUnidadLarga(unidad: string | null | undefined): string {
  if (!unidad) return "unidad";
  return NOMBRE_LARGO[unidad] ?? unidad.replace(/_/g, " ");
}

/**
 * Lee una cantidad tipeada: «2,5», «2.5» y «2» son lo mismo.
 *
 * Los campos del panel están en castellano, y `Number("2,5")` es `NaN`.
 * Para cantidades no hay separador de miles: nadie tipea «1.250» metros de
 * zócalo, y si lo tipea quiere decir uno coma veinticinco.
 */
export function leerCantidad(texto: string | number | null | undefined): number {
  if (typeof texto === "number") return texto;
  if (!texto) return NaN;
  const limpio = texto.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(limpio)) return NaN;
  return Number(limpio);
}

const NOMBRE_PLURAL: Record<string, string> = {
  unidad: "unidades",
  metro_lineal: "metros",
  metro_cuadrado: "metros cuadrados",
  tabla: "tablas",
  placa: "placas",
  rollo: "rollos",
  par: "pares",
  juego: "juegos",
  kg: "kilos",
  litro: "litros",
};

/** «metros cuadrados», «pares»: el plural no siempre es agregar una s. */
export function formatearUnidadPlural(unidad: string | null | undefined): string {
  if (!unidad) return "unidades";
  return NOMBRE_PLURAL[unidad] ?? `${formatearUnidadLarga(unidad)}s`;
}

const METROS = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** El largo de una pieza como se dice en el depósito: «2,40 m», no «2,4 m». */
export function formatearLargo(largoMm: number): string {
  return `${METROS.format(largoMm / 1000)} m`;
}
