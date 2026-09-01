/**
 * Cálculo de IVA.
 *
 * En este proyecto **los precios del catálogo son finales**: el número que ve el
 * cliente en la tienda ya tiene el IVA adentro, y es el que se cobra. Facturar
 * consiste entonces en desagregar, no en agregar.
 *
 * Que la cuenta vaya en una sola dirección importa: si en algún lugar se
 * calculara `precio * 1,21` y en otro `precio / 1,21`, los totales del checkout
 * y de la factura diferirían en unos pesos, y esa diferencia la descubre el
 * cliente comparando el papel con lo que pagó.
 *
 * No usa `Intl` ni floats para redondear al azar: cada importe se redondea una
 * sola vez, al final de la línea. Sumar líneas ya redondeadas y volver a
 * redondear el total es de donde salen las diferencias de un peso que después
 * no cierran contra ARCA.
 */

/** Alícuotas vigentes en Argentina que puede tener un producto. */
export const ALICUOTAS = [0, 10.5, 21, 27] as const;
export type Alicuota = (typeof ALICUOTAS)[number];

/** Códigos de alícuota de IVA que espera WSFEv1. */
export const CODIGO_ALICUOTA_ARCA: Record<number, number> = {
  0: 3,
  10.5: 4,
  21: 5,
  27: 6,
};

/** Redondeo a dos decimales, que es la precisión de un importe en pesos. */
export function redondear(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

export interface Desagregado {
  /** Importe sin IVA. */
  neto: number;
  /** El IVA contenido en el precio final. */
  iva: number;
  /** Lo que paga el cliente: el precio de la vidriera. */
  total: number;
  alicuota: number;
}

/**
 * Parte un precio final en neto + IVA.
 *
 * Con alícuota 21: neto = final / 1,21. El IVA es la diferencia y no
 * `neto * 0,21`, para que las dos partes sumen exactamente el total: calcular
 * las dos por separado y redondearlas puede dar un centavo de más.
 */
export function desagregar(precioFinal: number, alicuota: number): Desagregado {
  const total = redondear(precioFinal);

  if (!alicuota || alicuota <= 0) {
    return { neto: total, iva: 0, total, alicuota: 0 };
  }

  const neto = redondear(total / (1 + alicuota / 100));

  return { neto, iva: redondear(total - neto), total, alicuota };
}

/** Camino inverso: de un neto al precio final. Para cargas mayoristas. */
export function agregarIva(neto: number, alicuota: number): number {
  return redondear(neto * (1 + (alicuota || 0) / 100));
}

export interface LineaCalculada {
  descripcion: string;
  unidad: string;
  cantidad: number;
  /** Precio final unitario, con IVA incluido. */
  precioFinalUnitario: number;
  alicuota: number;
  /** Precio unitario sin IVA, con cuatro decimales: es lo que espera ARCA. */
  precioUnitarioNeto: number;
  neto: number;
  iva: number;
  subtotal: number;
}

export interface TotalesComprobante {
  lineas: LineaCalculada[];
  neto: number;
  /** IVA discriminado por alícuota. La clave es la alícuota como número. */
  ivaPorAlicuota: Map<number, { base: number; importe: number }>;
  iva: number;
  exento: number;
  total: number;
}

/**
 * Arma los totales de un comprobante a partir de líneas con precio final.
 *
 * El IVA se agrupa por alícuota porque así lo pide ARCA y así lo necesita el
 * libro IVA ventas: no alcanza con el total de IVA, hay que poder decir cuánto
 * corresponde al 21 % y cuánto al 10,5 %.
 */
export function calcularTotales(
  lineas: {
    descripcion: string;
    unidad?: string;
    cantidad: number;
    precioFinalUnitario: number;
    alicuota?: number;
  }[],
): TotalesComprobante {
  const calculadas: LineaCalculada[] = [];
  const ivaPorAlicuota = new Map<number, { base: number; importe: number }>();

  let neto = 0;
  let iva = 0;
  let exento = 0;
  let total = 0;

  for (const linea of lineas) {
    const alicuota = linea.alicuota ?? 21;

    // Se desagrega sobre el total de la línea y no sobre el unitario: con
    // cantidades fraccionadas —15,5 m² de machimbre— redondear el unitario
    // primero arrastra el error multiplicado por la cantidad.
    const totalLinea = redondear(linea.precioFinalUnitario * linea.cantidad);
    const partes = desagregar(totalLinea, alicuota);

    calculadas.push({
      descripcion: linea.descripcion,
      unidad: linea.unidad ?? "unidad",
      cantidad: linea.cantidad,
      precioFinalUnitario: linea.precioFinalUnitario,
      alicuota,
      precioUnitarioNeto:
        linea.cantidad > 0
          ? Math.round((partes.neto / linea.cantidad) * 10000) / 10000
          : 0,
      neto: partes.neto,
      iva: partes.iva,
      subtotal: partes.total,
    });

    neto += partes.neto;
    iva += partes.iva;
    total += partes.total;

    if (alicuota > 0) {
      const acumulado = ivaPorAlicuota.get(alicuota) ?? { base: 0, importe: 0 };
      acumulado.base = redondear(acumulado.base + partes.neto);
      acumulado.importe = redondear(acumulado.importe + partes.iva);
      ivaPorAlicuota.set(alicuota, acumulado);
    } else {
      exento += partes.neto;
    }
  }

  return {
    lineas: calculadas,
    neto: redondear(neto),
    ivaPorAlicuota,
    iva: redondear(iva),
    exento: redondear(exento),
    total: redondear(total),
  };
}

/**
 * Precio sin impuestos nacionales, para la leyenda de la tienda.
 *
 * La ley 27.743 obliga a informarlo junto al precio final en la venta a
 * consumidores. Es el mismo neto que después va a la factura, así que sale de
 * la misma función: si algún día cambia la alícuota, cambia en un solo lugar.
 */
export function sinImpuestosNacionales(
  precioFinal: number,
  alicuota = 21,
): number {
  return desagregar(precioFinal, alicuota).neto;
}
