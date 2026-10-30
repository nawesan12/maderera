import "server-only";

import type { NombreProveedorPago } from "@/lib/pagos/tipos";
import type { ReintentoDeEmail } from "@/lib/notificaciones/avisos";

/**
 * Qué hace cada tipo de trabajo.
 *
 * Un manejador **tiene que poder correr dos veces** sin hacer las cosas dos
 * veces: un reintento llega después de un error que pudo haber pasado a mitad
 * de camino. Los dos de hoy ya lo eran antes de la cola —el pago por el
 * identificador del evento, el mensaje de WhatsApp por el suyo—, porque los
 * proveedores también reintentan.
 *
 * Si algo falla, el manejador **tira**: eso es lo que dispara el reintento.
 */
export interface CargasDeTrabajo {
  "pago.aviso": {
    proveedor: NombreProveedorPago;
    cuerpo: unknown;
    url: string;
    firmaVerificada: boolean | null;
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
  "pago.aviso": async (carga) => {
    const { procesarAviso } = await import("@/lib/pagos/webhook");
    const { notificarResultadoDePago } = await import("@/lib/notificaciones/avisos");

    const resultado = await procesarAviso({
      proveedor: carga.proveedor,
      cuerpo: carga.cuerpo,
      url: new URL(carga.url),
      firmaVerificada: carga.firmaVerificada,
    });

    // `procesarAviso` no tira: devuelve «error». Para la cola eso es un fallo
    // que hay que reintentar (ver el retomar en `procesarAviso`).
    if (resultado.resultado === "error") {
      throw new Error(resultado.detalle ?? "El aviso de pago no se pudo procesar.");
    }

    if (resultado.resultado === "acreditado" || resultado.resultado === "actualizado") {
      await notificarResultadoDePago(resultado);
    }
  },
};
