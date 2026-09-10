/**
 * El papel que se lleva el cliente.
 *
 * Es un dato puro, sin base y sin servidor, y esa es la razón de que exista:
 * cuando la venta se hace sin internet, el ticket tiene que poder armarse e
 * imprimirse con lo que hay en pantalla. La página de servidor que ya existía
 * para reimprimir sigue igual; ahora las dos arman el mismo documento y lo
 * dibuja el mismo componente.
 */

import {
  aCentavos,
  importePorMedio,
  normalizarPagos,
  totalDeLaVenta,
  type LineaDeVenta,
  type MedioDeMostrador,
  type PagoDeVenta,
} from "./importes";

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
  /**
   * Cómo se pagó, renglón por renglón, con lote y cupón para las tarjetas.
   * Con un solo renglón el papel dice "Pago: Débito", como siempre; con más,
   * lista cada uno con su importe.
   */
  pagos: {
    medio: string;
    importe: number;
    tarjeta: string | null;
    nroLote: string | null;
    nroCupon: string | null;
  }[];
  enCuentaCorriente: boolean;
  /** Cuánto quedó en el libro: en un pago partido no es el total. */
  importeEnCuenta: number;
  /** La mercadería queda en depósito: el papel lo tiene que gritar. */
  acopio: boolean;
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
    pagos?: PagoDeVenta[];
    acopio?: boolean;
    descuento?: number;
    descuentoMotivo?: string | null;
    /** Las mismas líneas que se mandan a cobrar, sin recortar. */
    lineas: LineaDeVenta[];
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
  const total = aCentavos(subtotal - descuento);

  // La misma normalización que el cobro: el papel y la venta no pueden
  // contarse los pagos distinto.
  const pagos = normalizarPagos(
    venta.pagos,
    venta.medioPago as MedioDeMostrador,
    total,
  );
  const importeEnCuenta = importePorMedio(pagos, "cuenta_corriente");

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
    total,
    medioPago: venta.medioPago,
    pagos: pagos.map((p) => ({
      medio: p.medio,
      importe: p.importe,
      tarjeta: p.tarjeta ?? null,
      nroLote: p.nroLote ?? null,
      nroCupon: p.nroCupon ?? null,
    })),
    enCuentaCorriente: importeEnCuenta > 0,
    importeEnCuenta,
    acopio: venta.acopio ?? false,
    whatsapp: contexto.whatsapp,
  };
}
