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

/* -------------------------------------------------------------------------- */
/* Pagos                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Un renglón de cómo se pagó.
 *
 * La compra que se paga mitad en efectivo y mitad con débito existe todos los
 * días en un mostrador, y hasta ahora se guardaba como un solo medio con la
 * caja cerrando con una diferencia inventada. El lote y el cupón son el pedido
 * fiscal de la clienta: "el código de que se pagó con qué".
 */
export interface PagoDeVenta {
  medio: MedioDeMostrador;
  importe: number;
  /** Nro de lote del cierre de la terminal. Solo tarjetas. */
  nroLote?: string | null;
  /** Nro de cupón o valor. Solo tarjetas. */
  nroCupon?: string | null;
  /** Qué tarjeta o banco: "Visa Galicia", "Naranja". */
  tarjeta?: string | null;
}

/**
 * Los pagos que efectivamente valen: sin renglones vacíos, y con la venta de
 * un solo medio expresada igual que la partida. Todo lo que sigue —la caja, el
 * ticket, el cierre Z— lee de esta forma única.
 */
export function normalizarPagos(
  pagos: PagoDeVenta[] | undefined,
  medioPago: MedioDeMostrador,
  total: number,
): PagoDeVenta[] {
  const conImporte = (pagos ?? []).filter(
    (p) => Number.isFinite(p.importe) && p.importe > 0,
  );
  if (conImporte.length === 0) return [{ medio: medioPago, importe: total }];
  return conImporte.map((p) => ({ ...p, importe: aCentavos(p.importe) }));
}

/**
 * Qué le falta a una venta partida en varios pagos, o `null` si está bien.
 *
 * La suma tiene que dar el total al centavo: un pago de más es plata que el
 * cliente no debía, uno de menos es una venta que dice cobrada y no lo está.
 */
export function revisarPagos(
  pagos: PagoDeVenta[],
  total: number,
  customerId: string | null,
): string | null {
  if (pagos.length > 4) {
    return "Una venta no puede partirse en más de cuatro pagos.";
  }

  const suma = aCentavos(pagos.reduce((s, p) => s + p.importe, 0));
  if (Math.abs(suma - total) > 0.01) {
    return `Los pagos suman ${suma.toFixed(2)} y la venta es de ${total.toFixed(2)}.`;
  }

  if (pagos.some((p) => p.medio === "cuenta_corriente") && !customerId) {
    return "Para cargar a cuenta corriente hace falta elegir el cliente.";
  }

  return null;
}

/** El medio por el que entró más plata. Es lo que guarda `orders.medioPago`. */
export function medioPrincipal(pagos: PagoDeVenta[]): MedioDeMostrador {
  return pagos.reduce((mayor, p) => (p.importe > mayor.importe ? p : mayor))
    .medio;
}

/** Cuánto entró por un medio dado. */
export function importePorMedio(
  pagos: PagoDeVenta[],
  medio: MedioDeMostrador,
): number {
  return aCentavos(
    pagos.filter((p) => p.medio === medio).reduce((s, p) => s + p.importe, 0),
  );
}

/* -------------------------------------------------------------------------- */
/* Descuento                                                                   */
/* -------------------------------------------------------------------------- */

export type TipoDescuento = "porcentaje" | "monto";

/**
 * Cuánta plata se descuenta.
 *
 * Nunca más que el total: un descuento mayor a la venta daría un total negativo
 * y eso no es un descuento, es un error de tipeo. Nunca negativo tampoco, que
 * sería un recargo disfrazado.
 */
export function montoDelDescuento(
  total: number,
  tipo: TipoDescuento,
  valor: number,
): number {
  if (!Number.isFinite(valor) || valor <= 0) return 0;

  const bruto = tipo === "porcentaje" ? (total * valor) / 100 : valor;
  return aCentavos(Math.min(Math.max(bruto, 0), total));
}

/**
 * Aplica el descuento repartiéndolo entre las líneas.
 *
 * Devuelve las líneas con el precio unitario ya rebajado **y el descuento que
 * efectivamente quedó**, que puede diferir del pedido en unos centavos.
 *
 * Eso último no es un descuido, es la única salida honesta. Cada línea vale
 * `cantidad × precio unitario`, las dos con dos decimales, así que hay totales
 * que sencillamente no se pueden expresar: pedir 13% sobre tres líneas raras da
 * un número que ninguna combinación de precios unitarios alcanza. Se puede
 * perseguir con parches de centavos —lo intenté— y el resultado es un total que
 * no coincide con la suma de sus renglones, que es peor.
 *
 * Así que manda la suma de las líneas: se cobra exactamente eso, y el descuento
 * que se anuncia es el que de verdad se hizo.
 *
 * **Por qué se prorratea y no se agrega un renglón negativo.** El renglón
 * negativo se lee más fácil, pero la base imponible de la factura tiene que
 * reflejar lo que efectivamente se cobró por cada cosa: si una placa se vendió
 * con 10% menos, el IVA va sobre el precio con el 10% menos. El ticket sí lo
 * muestra aparte, que es donde importa que se entienda.
 */
export function aplicarDescuento(
  lineas: LineaDeVenta[],
  descuentoPedido: number,
): { lineas: LineaDeVenta[]; descuento: number } {
  const total = totalDeLaVenta(lineas);

  if (descuentoPedido <= 0 || total <= 0) {
    return { lineas, descuento: 0 };
  }

  const factor = Math.max(0, (total - descuentoPedido) / total);

  const rebajadas = lineas.map((l) => ({
    ...l,
    precioUnitario: aCentavos(l.precioUnitario * factor),
  }));

  return {
    lineas: rebajadas,
    descuento: aCentavos(total - totalDeLaVenta(rebajadas)),
  };
}
