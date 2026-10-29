/**
 * Costo promedio ponderado, y el margen que sale de él.
 *
 * Sin base de datos y sin `server-only`: es aritmética pura, y por eso se puede
 * probar. **Es plata.** De estos números salen las decisiones de precio, y un
 * error del 3 % no se nota en ninguna pantalla hasta que alguien descubre que
 * hace seis meses que se vende bajo el costo.
 *
 * **Cuatro decimales, no dos.** Un promedio de $10,005 redondeado a $10,01 en
 * cada una de doscientas recepciones deriva varios pesos por unidad, y la
 * deriva es siempre para el mismo lado.
 */

const DECIMALES = 4;

function redondear(n: number): number {
  return Math.round(n * 10 ** DECIMALES) / 10 ** DECIMALES;
}

/*
 * El costo promedio ponderado (mezclarCosto) y el reparto del flete
 * (prorratearGastos) se mudaron a Go con las recepciones
 * (backend/internal/compras/cuentas.go). Acá queda el margen, que lo usan las
 * pantallas de ventas.
 */

/**
 * El margen de una línea de venta.
 *
 * **Neto contra neto, y con la alícuota de la línea.** El subtotal de una venta
 * es final —lleva el IVA adentro, porque así se guardan los precios del
 * catálogo— y el costo es neto, porque así factura el proveedor. Compararlos
 * directo infla el margen un 21 % sistemático, y como la maderera vende algunos
 * ítems al 10,5 %, usar la constante 21 tampoco alcanza.
 */
export interface EntradaDeMargen {
  /** Lo que se cobró por la línea, con IVA adentro. */
  subtotal: number;
  cantidad: number;
  /** La de la línea, no una constante. */
  alicuotaIva: number;
  /** Congelado en la venta. `null` si esa venta es anterior al módulo. */
  costoUnitario: number | null;
}

export interface Margen {
  netoVenta: number;
  costoTotal: number | null;
  margen: number | null;
  /** Sobre la venta neta. `null` si la venta fue cero. */
  margenPorcentual: number | null;
}

export function margenDeLinea(linea: EntradaDeMargen): Margen {
  const netoVenta = redondear(linea.subtotal / (1 + linea.alicuotaIva / 100));

  /*
   * Sin costo no se inventa un margen.
   *
   * Las ventas anteriores al módulo no lo tienen, y devolver cero las
   * mezclaría con las que de verdad se vendieron sin ganancia. Ese promedio es
   * exactamente el número sobre el que no se puede decidir nada, y por eso la
   * pantalla las cuenta aparte en vez de sumarlas.
   */
  if (linea.costoUnitario === null || !Number.isFinite(linea.costoUnitario)) {
    return { netoVenta, costoTotal: null, margen: null, margenPorcentual: null };
  }

  const costoTotal = redondear(linea.costoUnitario * linea.cantidad);
  const margen = redondear(netoVenta - costoTotal);

  return {
    netoVenta,
    costoTotal,
    margen,
    // Vender bajo el costo pasa y se informa como negativo: taparlo es lo peor
    // que se puede hacer con este número.
    margenPorcentual:
      netoVenta === 0 ? null : redondear((margen / netoVenta) * 100),
  };
}
