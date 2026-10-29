import "server-only";

import { apiInterna, datos } from "@/lib/api/servidor";
import { emisorConFechas, type EmisorFiscal } from "@/lib/dal/admin/facturacion";
import type { CondicionIva } from "./comprobantes";

/**
 * La emisión de comprobantes vive en Go (backend/internal/facturacion): la
 * letra, los importes, la numeración sin huecos con su candado y el pedido de
 * CAE a ARCA, que va fuera de la transacción y de a uno. Esto queda como
 * envoltorio para el TypeScript que todavía la llama —el mostrador
 * (lib/mostrador/comprobante.ts) y las hojas y PDF que leen el emisor—, con las
 * mismas firmas de antes. Habla con Go con el secreto interno: quien llama ya
 * es código del servidor que decidió emitir.
 */

export interface LineaAEmitir {
  descripcion: string;
  unidad?: string;
  cantidad: number;
  /** Precio final unitario, con IVA incluido: como está en el catálogo. */
  precioFinalUnitario: number;
  alicuota?: number;
}

export interface DatosEmision {
  customerId?: string | null;
  orderId?: string | null;
  receptorNombre: string;
  receptorCuit?: string | null;
  receptorCondicionIva: CondicionIva;
  receptorDomicilio?: string | null;
  lineas: LineaAEmitir[];
  puntoVentaId?: string | null;
  fechaVencimiento?: Date | null;
  observaciones?: string | null;
  createdByUserId?: string | null;
}

export interface ResultadoEmision {
  invoiceId?: string;
  error?: string;
}

/** Datos del emisor (configuracion_fiscal), creando la fila la primera vez. */
export async function obtenerConfiguracionFiscal(): Promise<EmisorFiscal> {
  return emisorConFechas(datos(await apiInterna.GET("/api/v1/fiscal/emisor")));
}

/** Crea un comprobante (estado «emitida», sin CAE todavía). */
export async function emitirComprobante(d: DatosEmision): Promise<ResultadoEmision> {
  const r = await apiInterna.POST("/api/v1/interno/facturacion/comprobantes", {
    body: {
      ...d,
      fechaVencimiento: d.fechaVencimiento ? d.fechaVencimiento.toISOString() : null,
    },
  });
  if (!r.data) return { error: "No se pudo emitir el comprobante. Intentá de nuevo." };
  return r.data;
}

/** Manda un comprobante ya emitido a ARCA y guarda el CAE. */
export async function autorizarComprobante(invoiceId: string): Promise<{ ok?: string; error?: string }> {
  const r = await apiInterna.POST("/api/v1/interno/facturacion/comprobantes/{id}/autorizar", {
    params: { path: { id: invoiceId } },
  });
  if (!r.data) return { error: "No encontramos el comprobante." };
  return r.data;
}
