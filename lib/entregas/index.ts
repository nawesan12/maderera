import "server-only";

import { api, datos, mensajeDe, type Problema } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * Entregas y acopio.
 *
 * Lo hace la API de Go (backend/internal/entregas): el saldo de lo que queda
 * por retirar, los remitos —preparar, anular, el de constancia del
 * mostrador—, la firma y el remito completo. Acá quedan los envoltorios con
 * los nombres de siempre.
 *
 * En una maderera el pedido rara vez se lleva de una sola vez: se compra la
 * obra entera, la mercadería queda en acopio y el cliente va retirando a
 * medida que avanza. Por eso "entregado" no es un estado del pedido sino una
 * cuenta: lo pedido menos lo que ya salió.
 */

export type RenglonPendiente = Esquemas["RenglonDeAcopio"];

/** Qué queda por entregar de un pedido (se calcula, no se guarda). */
export async function saldoDeAcopio(orderId: string): Promise<RenglonPendiente[]> {
  return datos(
    await (await api()).GET("/api/v1/admin/pedidos/{id}/acopio", { params: { path: { id: orderId } } }),
  );
}

export class ErrorDeEntrega extends Error {}

export interface EntregaCreada {
  id: string;
  numero: string;
  firmaToken: string;
  pedidoCompleto: boolean;
}

/**
 * Remito de constancia para una venta que ya salió por el mostrador: no
 * toca el inventario (el stock se descontó al cobrar). Lo emite Go
 * (`POST /api/v1/mostrador/pedidos/{id}/remito`), que también lo anota en la
 * bitácora. Un `ErrorDeEntrega` trae el mensaje para mostrar.
 */
export async function remitoDeConstancia(opciones: {
  orderId: string;
  receptorNombre?: string | null;
  usuarioId?: string;
}): Promise<EntregaCreada> {
  const r = await (await api()).POST("/api/v1/mostrador/pedidos/{id}/remito", {
    params: { path: { id: opciones.orderId } },
    body: { receptorNombre: opciones.receptorNombre ?? null },
  });
  if (!r.data) {
    if (r.response.status === 422) throw new ErrorDeEntrega(mensajeDe(r.error as Problema | undefined));
    throw new Error(`La API respondió ${r.response.status} al emitir el remito`);
  }
  return { id: r.data.remitoId, numero: r.data.remitoNumero, firmaToken: "", pedidoCompleto: true };
}
