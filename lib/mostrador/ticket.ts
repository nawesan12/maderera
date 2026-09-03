/**
 * El papel que se lleva el cliente.
 *
 * Es un dato puro, sin base y sin servidor, y esa es la razón de que exista:
 * cuando la venta se hace sin internet, el ticket tiene que poder armarse e
 * imprimirse con lo que hay en pantalla. La página de servidor que ya existía
 * para reimprimir sigue igual; ahora las dos arman el mismo documento y lo
 * dibuja el mismo componente.
 */

import { aCentavos, totalDeLaVenta } from "./importes";

export interface LineaDelTicket {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precioUnitario: number;
  subtotal: number;
}

export interface DocumentoTicket {
  /** `PED-1206` cuando ya se sincronizó, o `CAJA1-017` mientras tanto. */
  numero: string;
  /** Si el número todavía es el de la caja y no el definitivo. */
  provisorio: boolean;
  /** El provisorio, cuando ya hay definitivo: el cliente puede volver con ese papel. */
  numeroProvisorio: string | null;
  /** ISO. */
  fecha: string;
  sucursal: { nombre: string; direccion: string | null; telefono: string | null };
  emisor: { razonSocial: string; cuit: string | null };
  cliente: string;
  items: LineaDelTicket[];
  subtotal: number;
  descuento: number;
  descuentoMotivo: string | null;
  total: number;
  medioPago: string | null;
  enCuentaCorriente: boolean;
  whatsapp: string | null;
}

export interface ContextoDelTicket {
  sucursal: { nombre: string; direccion: string | null; telefono: string | null };
  emisor: { razonSocial: string; cuit: string | null };
  whatsapp: string | null;
}

/**
 * Arma el documento con lo que hay en pantalla, antes de que exista el pedido.
 *
 * El total sale de las líneas ya con el descuento repartido —las mismas que se
 * mandan al servidor—, así que el papel y la venta no pueden discrepar.
 */
export function documentoDeVenta(
  venta: {
    numero: string;
    provisorio: boolean;
    cobradaAt: string;
    contactoNombre: string;
    medioPago: string;
    descuento?: number;
    descuentoMotivo?: string | null;
    lineas: {
      descripcion: string;
      cantidad: number;
      unidad: string;
      precioUnitario: number;
    }[];
  },
  contexto: ContextoDelTicket,
): DocumentoTicket {
  const items = venta.lineas.map((l) => ({
    ...l,
    subtotal: aCentavos(l.cantidad * l.precioUnitario),
  }));

  /*
   * El total sale de `totalDeLaVenta`, la misma función que usa el cobro.
   *
   * Tener una cuenta propia acá, aunque sea "la misma fórmula", es cómo el
   * papel y el sistema terminan discrepando por un centavo con cantidades
   * fraccionadas —2,5 m² a $33,33— y esa diferencia se discute en el
   * mostrador, donde el papel siempre gana.
   */
  const subtotal = totalDeLaVenta(venta.lineas);
  const descuento = aCentavos(venta.descuento ?? 0);

  return {
    numero: venta.numero,
    provisorio: venta.provisorio,
    numeroProvisorio: null,
    fecha: venta.cobradaAt,
    sucursal: contexto.sucursal,
    emisor: contexto.emisor,
    cliente: venta.contactoNombre,
    items,
    subtotal,
    descuento,
    descuentoMotivo: venta.descuentoMotivo ?? null,
    total: aCentavos(subtotal - descuento),
    medioPago: venta.medioPago,
    enCuentaCorriente: venta.medioPago === "cuenta_corriente",
    whatsapp: contexto.whatsapp,
  };
}
