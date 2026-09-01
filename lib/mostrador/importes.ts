/**
 * Las reglas de una venta de mostrador, sin base de datos.
 *
 * Vive aparte de `venta.ts` a propósito: lo que decide si una venta es válida y
 * cuánto suma es aritmética y reglas, y eso se puede probar sin levantar nada.
 * Lo que queda del otro lado es la transacción, que es lo único que de verdad
 * necesita la base.
 */

export type MedioDeMostrador =
  | "efectivo"
  | "debito"
  | "credito"
  | "transferencia"
  | "cuenta_corriente";

export interface LineaDeVenta {
  /** Nulo para una línea suelta: un corte, un flete, una diferencia. */
  variantId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
}

/** Redondeo a centavos, para que la suma de líneas cierre con el total. */
export function aCentavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * El total de una venta.
 *
 * Cada línea se redondea antes de sumarse, y no al final. Es la diferencia
 * entre el total y la suma de lo que dice cada renglón impreso: si se redondea
 * recién al final, el comprobante muestra tres números que no dan.
 */
export function totalDeLaVenta(lineas: LineaDeVenta[]): number {
  return aCentavos(
    lineas.reduce((suma, l) => suma + aCentavos(l.cantidad * l.precioUnitario), 0),
  );
}

/**
 * Qué le falta o le sobra a una venta para poder cobrarse.
 *
 * Devuelve el motivo en castellano y listo para mostrar, o `null` si está bien.
 */
export function revisarVenta(
  lineas: LineaDeVenta[],
  medioPago: MedioDeMostrador,
  customerId: string | null,
): string | null {
  if (lineas.length === 0) return "La venta no tiene ningún ítem.";

  for (const l of lineas) {
    if (!Number.isFinite(l.cantidad) || l.cantidad <= 0) {
      return `La cantidad de "${l.descripcion}" tiene que ser mayor a cero.`;
    }
    if (!Number.isFinite(l.precioUnitario) || l.precioUnitario < 0) {
      return `El precio de "${l.descripcion}" no puede ser negativo.`;
    }
  }

  if (totalDeLaVenta(lineas) <= 0) {
    return "El total tiene que ser mayor a cero.";
  }

  // Fiar exige saber a quién. "Consumidor final" no tiene libro donde anotar.
  if (medioPago === "cuenta_corriente" && !customerId) {
    return "Para cargar a cuenta corriente hace falta elegir el cliente.";
  }

  return null;
}

/**
 * El vuelto, o `null` si con lo que se recibió no alcanza.
 *
 * Se separa del resto porque es lo que se muestra en pantalla mientras quien
 * atiende tipea, antes de cobrar nada.
 */
export function vuelto(total: number, recibido: number): number | null {
  if (!Number.isFinite(recibido) || recibido < total) return null;
  return aCentavos(recibido - total);
}
