/**
 * La forma de un proveedor de cobros.
 *
 * Existe por lo mismo que `lib/whatsapp/tipos.ts` y
 * `lib/fiscal/proveedores/tipos.ts`: el checkout, la conciliación y el pago de
 * deuda hablan con esta interfaz y no con Mercado Pago. Mientras el cliente no
 * entregue sus credenciales corre el proveedor de demostración, y el día que
 * las entregue se cargan dos variables de entorno sin tocar una pantalla.
 */

export type NombreProveedorPago = "mercado_pago" | "demo" | "transferencia";

export type EstadoRemoto =
  | "pendiente"
  | "aprobado"
  | "rechazado"
  | "reintegrado"
  | "cancelado";

export interface ItemPreferencia {
  titulo: string;
  cantidad: number;
  precioUnitario: number;
}

export interface SolicitudPreferencia {
  /**
   * Nuestro id de pago. Vuelve en el aviso como `external_reference` y es lo
   * que permite atar el aviso del proveedor a la fila de `payments` sin
   * confiar en el monto ni en el email, que se repiten.
   */
  referencia: string;
  descripcion: string;
  monto: number;
  items: ItemPreferencia[];
  pagador?: { nombre?: string | null; email?: string | null };
  /** A dónde vuelve la persona cuando termina de pagar. */
  urlRetorno: string;
  /** A dónde manda el proveedor el aviso servidor a servidor. */
  urlWebhook: string;
}

export interface Preferencia {
  preferenciaId: string;
  urlPago: string;
}

/** Lo que el proveedor dice sobre un pago, ya traducido a nuestro vocabulario. */
export interface PagoRemoto {
  id: string;
  estado: EstadoRemoto;
  /**
   * Monto informado por el proveedor, o null si no informa ninguno.
   *
   * Null solo lo devuelve el proveedor de demostración. Cuando hay monto, la
   * acreditación lo compara contra el nuestro: un aviso que dice "aprobado" por
   * un importe menor al del pedido no es un pedido pagado.
   */
  monto: number | null;
  medio: string | null;
  /** Nuestro id de pago, tal como volvió del proveedor. */
  referencia: string | null;
  motivoRechazo: string | null;
  crudo: unknown;
}

export interface AvisoEntrante {
  /** Id del aviso en el proveedor. Es la llave contra reprocesos. */
  eventoId: string;
  tipo: string;
  /** Id del pago en el proveedor, a consultar. */
  pagoRemotoId: string | null;
}

export interface ProveedorPagos {
  nombre: NombreProveedorPago;
  /** Falso cuando corre el de demostración: la interfaz lo avisa en pantalla. */
  real: boolean;
  crearPreferencia(solicitud: SolicitudPreferencia): Promise<Preferencia>;
  consultarPago(id: string): Promise<PagoRemoto | null>;
  /**
   * Lee el cuerpo del webhook y dice qué pago hay que ir a consultar.
   *
   * Devuelve null cuando el aviso no es sobre un pago —Mercado Pago manda
   * avisos de merchant_order, de suscripciones y de test— para poder
   * descartarlo sin ruido.
   */
  interpretarAviso(cuerpo: unknown, url: URL): AvisoEntrante | null;
}
