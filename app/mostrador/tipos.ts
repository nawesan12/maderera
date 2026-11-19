

export interface Sucursal {
  id: string;
  slug: string;
  nombre: string;
}

export interface Turno {
  id: string;
  sucursal: string;
  branchId: string;
  abiertaPor: string;
  abiertaAt: Date;
  esperado: number;
  /** El cambio que tiene que quedar siempre. Cero = la sucursal no lo fijó. */
  fondoBase: number;
  fondoInicial: number;
  ventasEnEfectivo: number;
  otrosIngresos: number;
  retiros: number;
  cantidadDeVentas: number;
}

export interface Movimiento {
  id: string;
  tipo: string;
  monto: number;
  motivo: string | null;
  createdAt: string;
  quien: string | null;
}

export interface VentaDeHoy {
  id: string;
  numero: string;
  cliente: string;
  total: number;
  medioPago: string | null;
  estado: string;
  createdAt: string;
}

export interface Cliente {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: string;
  estado: string;
  /** La lista de precios asignada, para resolver precios sin servidor. */
  priceListId: string | null;
}

/** La venta recién cobrada, para el papel que sale después. */
export interface UltimaVenta {
  numero: string;
  /** Null mientras la venta está en la cola: el pedido todavía no existe. */
  orderId: string | null;
  invoiceId?: string;
  clave?: string;
  acopio?: boolean;
  remitoId?: string;
}

/**
 * Qué papel se imprime.
 *
 * Si salió factura, la factura, que es el papel que vale. Si no, el ticket del
 * pedido. Sin `orderId` la venta todavía está en la cola de esta máquina y el
 * papel se arma con lo guardado acá.
 */
export function papelDeLaVenta(u: UltimaVenta) {
  if (u.invoiceId) return `/comprobante/${u.invoiceId}`;
  if (u.orderId) return `/ticket/${u.orderId}`;
  return `/ticket/local?clave=${u.clave}`;
}

/** El cartel de cómo salió la venta. */
export interface Aviso {
  tipo: "ok" | "error";
  texto: string;
}
