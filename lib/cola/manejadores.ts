import "server-only";

import type { ReintentoDeEmail } from "@/lib/notificaciones/avisos";

/**
 * Qué hace cada tipo de trabajo.
 *
 * Un manejador **tiene que poder correr dos veces** sin hacer las cosas dos
 * veces: un reintento llega después de un error que pudo haber pasado a mitad
 * de camino. El aviso de un pago lo encola Go una sola vez, en la misma
 * transacción que lo acredita; un reintento puede mandar el correo dos veces,
 * nunca acreditar dos veces.
 *
 * Si algo falla, el manejador **tira**: eso es lo que dispara el reintento.
 */
export interface CargasDeTrabajo {
  // pago.aviso (lo que deja el webhook de Mercado Pago) es del worker de Go
  // (backend/internal/pagos): no está acá, así este lado no lo toma.
  /**
   * El aviso de un pago acreditado (correo, panel, inscripción). Lo encola
   * Go al acreditar, en la misma transacción; lo atiende el TS mientras los
   * avisos de pedidos y pagos sigan acá.
   */
  "pago.resultado": {
    orderId: string | null;
    customerId: string | null;
    tipo: "pedido" | "deuda" | "inscripcion";
    detalle: string;
    receiptId: string | null;
  };
  // whatsapp.payload, whatsapp.estado y whatsapp.medio son del worker de Go
  // (backend/internal/whatsapp): no están acá, así este lado no los toma.
  // campana.tanda es del worker de Go (backend/internal/campanas).
}

/**
 * Los que el TS encola y atiende el worker de Go: `email.reintento` lo
 * encola despacharEmail (lib/notificaciones/avisos.ts) y lo manda
 * backend/internal/avisos.
 */
export interface CargasParaGo {
  "email.reintento": ReintentoDeEmail;
  // Los avisos de un recibo, un cheque rechazado y un comprobante, con su
  // PDF: los encolan cobros y facturación al confirmar y los atiende el
  // worker de Go (backend/internal/notificaciones).
  "recibo.aviso": { receiptId: string };
  "cheque.rechazado": { chequeId: string; porElBanco: boolean };
  "factura.aviso": { invoiceId: string };
}

export type TipoDeTrabajo = keyof CargasDeTrabajo;
export type TipoEncolable = TipoDeTrabajo | keyof CargasParaGo;
export type CargaDe<T extends TipoEncolable> = (CargasDeTrabajo & CargasParaGo)[T];

export const MANEJADORES: {
  [T in TipoDeTrabajo]: (carga: CargasDeTrabajo[T]) => Promise<void>;
} = {
  "pago.resultado": async (carga) => {
    const { notificarResultadoDePago } = await import("@/lib/notificaciones/avisos");
    await notificarResultadoDePago(carga);
  },
};
