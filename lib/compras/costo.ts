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

/** A cuánto vale hoy una variante, y sobre cuántas unidades. */
export interface EstadoDeCosto {
  /**
   * Unidades valorizadas.
   *
   * **No es `inventory.qty`.** Aquel está por sucursal, lo mueven ajustes que
   * no tienen costo asociado y puede quedar negativo por regla de negocio. Este
   * es la base del promedio y solo lo mueven las recepciones.
   */
  cantidadBase: number;
  /** Neto, sin IVA. En compras el número base es el neto. */
  costoPromedio: number;
}

const DECIMALES = 4;

function redondear(n: number): number {
  return Math.round(n * 10 ** DECIMALES) / 10 ** DECIMALES;
}

/**
 * Mezcla lo que había con lo que entra.
 *
 * Es el promedio estándar y el que espera un contador. La alternativa —último
 * costo— con la inflación argentina hace saltar el margen de un día para el
 * otro aunque el stock viejo se haya comprado mucho más barato.
 *
 * **No es reversible.** Anular una recepción baja la cantidad y no toca el
 * costo: deshacer la mezcla exigiría recalcular toda la historia posterior, y
 * esa historia ya se usó para poner precios.
 */
export function mezclarCosto(
  actual: EstadoDeCosto,
  entrada: { cantidad: number; costoUnitario: number },
): EstadoDeCosto {
  const { cantidad, costoUnitario } = entrada;

  // Una entrada que no es un número, o que no tiene unidades, o que trae un
  // costo negativo, no es una recepción: es un error de carga.
  if (!Number.isFinite(cantidad) || cantidad <= 0) return actual;
  if (!Number.isFinite(costoUnitario) || costoUnitario < 0) return actual;

  /*
   * El stock negativo se trata como cero. Promediar contra −3 unidades da un
   * costo disparatado —o negativo— y no hay forma de explicarlo en el
   * mostrador. "No había nada valorizado, ahora vale lo que costó" sí.
   */
  const base = Math.max(0, actual.cantidadBase);

  if (base === 0) {
    return {
      cantidadBase: cantidad,
      costoPromedio: redondear(costoUnitario),
    };
  }

  const valorPrevio = base * actual.costoPromedio;
  const valorEntrante = cantidad * costoUnitario;
  const total = base + cantidad;

  return {
    cantidadBase: total,
    costoPromedio: redondear((valorPrevio + valorEntrante) / total),
  };
}

/**
 * Reparte el flete y los demás gastos entre las líneas de una recepción.
 *
 * En proporción al valor, que es lo que un contador espera: el flete de un
 * camión con veinte tablas y un tornillo no se divide en dos.
 *
 * Cuando todas las líneas valen cero —una entrega íntegramente bonificada— el
 * reparto pasa a ser por cantidad: el flete se pagó igual, y dividir por cero
 * dejaría el gasto sin asignar.
 */
export interface LineaConGasto {
  costoConGastos: number;
}

export function prorratearGastos<T extends { cantidad: number; costoUnitario: number }>(
  lineas: T[],
  gastos: number,
): (T & LineaConGasto)[] {
  const sinGastos = lineas.map((l) => ({ ...l, costoConGastos: l.costoUnitario }));

  if (!Number.isFinite(gastos) || gastos <= 0 || lineas.length === 0) {
    return sinGastos;
  }

  const valores = lineas.map((l) => l.cantidad * l.costoUnitario);
  const valorTotal = valores.reduce((t, v) => t + v, 0);
  const cantidadTotal = lineas.reduce((t, l) => t + l.cantidad, 0);

  if (cantidadTotal <= 0) return sinGastos;

  // Con todo en cero el peso pasa a ser la cantidad.
  const pesos =
    valorTotal > 0
      ? valores.map((v) => v / valorTotal)
      : lineas.map((l) => l.cantidad / cantidadTotal);

  /*
   * El resto va a la línea de mayor peso.
   *
   * Sin esto, tres líneas iguales con un gasto de $10 reparten $3,3333 cada una
   * y se pierde una fracción. Con doscientas recepciones eso deja de cuadrar
   * contra la factura del proveedor, y alguien pasa una tarde buscando la
   * diferencia.
   */
  const partes = pesos.map((p) => redondear(p * gastos));
  const mayor = pesos.indexOf(Math.max(...pesos));

  /*
   * El resto va a la línea de mayor peso, y se calcula por diferencia.
   *
   * Sin esto, tres líneas iguales con un gasto de $10 reparten $3,3333 cada una
   * y se pierden fracciones. Con doscientas recepciones eso deja de cuadrar
   * contra la factura del proveedor, y alguien pasa una tarde buscando la
   * diferencia.
   */
  partes[mayor] = redondear(
    gastos - partes.reduce((t, p, i) => (i === mayor ? t : t + p), 0),
  );

  return lineas.map((l, i) => {
    const porUnidad = l.cantidad > 0 ? partes[i] / l.cantidad : 0;
    return { ...l, costoConGastos: redondear(l.costoUnitario + porUnidad) };
  });
}

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
