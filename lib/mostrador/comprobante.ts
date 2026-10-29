import "server-only";

import { apiInterna, datos } from "@/lib/api/servidor";
import type { CondicionIva } from "@/lib/fiscal/comprobantes";
import type { LineaDeVenta } from "./importes";

/**
 * El comprobante de una venta de mostrador.
 *
 * **Va después de la venta y nunca adentro.** La venta ya se cobró: la plata
 * está en la caja y la mercadería se fue con el cliente. Si ARCA no contesta
 * —hoy directamente no está configurado— eso no puede deshacer nada. Lo que
 * pasa es que queda una venta sin comprobante, que es un problema que se
 * resuelve después desde Facturación; deshacer la venta sería un problema que
 * no se resuelve nunca.
 *
 * Por eso esta función no tira: devuelve qué pasó, y quien atiende ve un aviso
 * sobre una venta que igual quedó hecha.
 */

export interface PedidoDeComprobante {
  orderId: string;
  customerId: string | null;
  receptorNombre: string;
  /** CUIT tipeado en el mostrador para una factura A a alguien sin ficha. */
  cuit?: string | null;
  lineas: LineaDeVenta[];
  usuarioId: string;
}

export interface ResultadoComprobante {
  invoiceId?: string;
  /** Qué contar en pantalla: puede haber comprobante y aun así no tener CAE. */
  aviso: string;
  autorizado: boolean;
}

/**
 * Qué letra saldría, para poder decirlo en pantalla **antes** de cobrar.
 *
 * No se rotula "Factura B" a mano en ningún lado: la letra sale de quién emite
 * y quién recibe. Si mañana la maderera pasa a monotributo, todo lo que se
 * emite es C y esta pantalla lo dice sola.
 */
/**
 * La letra que saldría para este cliente (o para un CUIT tipeado), antes de
 * cobrar. La decide Go (backend/internal/facturacion), con la configuración
 * fiscal y la condición del receptor.
 */
export async function letraQueSaldria(
  customerId: string | null,
  cuitTipeado?: string | null,
): Promise<{ letra: string; receptor: CondicionIva }> {
  const query = {
    ...(customerId ? { customerId } : {}),
    ...(cuitTipeado ? { cuit: cuitTipeado } : {}),
  };
  const r = datos(await apiInterna.GET("/api/v1/interno/facturacion/letra", { params: { query } }));
  return { letra: r.letra, receptor: r.receptor as CondicionIva };
}

/**
 * El comprobante de una venta del mostrador: lo emite y lo autoriza Go
 * (EmitirParaLaVenta), **después** de confirmar la venta y nunca adentro de
 * su transacción. No tira: si algo falla, la venta queda y el aviso lo dice.
 */
export async function emitirParaLaVenta(pedido: PedidoDeComprobante): Promise<ResultadoComprobante> {
  return datos(
    await apiInterna.POST("/api/v1/interno/facturacion/venta", {
      body: {
        orderId: pedido.orderId,
        customerId: pedido.customerId,
        receptorNombre: pedido.receptorNombre,
        cuit: pedido.cuit ?? null,
        usuarioId: pedido.usuarioId,
        lineas: pedido.lineas.map((l) => ({
          descripcion: l.descripcion,
          unidad: l.unidad,
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
        })),
      },
    }),
  );
}
