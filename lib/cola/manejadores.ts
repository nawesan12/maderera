import "server-only";

import type { NombreProveedorPago } from "@/lib/pagos/tipos";
import type { PayloadWebhook } from "@/lib/whatsapp/webhook";

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
  "whatsapp.payload": { payload: PayloadWebhook };
  /** Una tanda de una campaña de correo (ver `lib/campanas/envio.ts`). */
  "campana.tanda": { campanaId: string };
}

export type TipoDeTrabajo = keyof CargasDeTrabajo;
export type CargaDe<T extends TipoDeTrabajo> = CargasDeTrabajo[T];

export const MANEJADORES: {
  [T in TipoDeTrabajo]: (carga: CargaDe<T>) => Promise<void>;
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

  "whatsapp.payload": async (carga) => {
    const { procesarPayload } = await import("@/lib/whatsapp/webhook");
    await procesarPayload(carga.payload);
  },

  "campana.tanda": async (carga) => {
    const { procesarTanda } = await import("@/lib/campanas/envio");
    await procesarTanda(carga.campanaId);
  },
};
