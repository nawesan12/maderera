import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customers,
  datosBancarios,
  eventRegistrations,
  events,
  orders,
  payments,
} from "@/lib/db/schema";

/** Lecturas de cobros para las pantallas públicas y del portal. */

export interface CobroDelPedido {
  id: string;
  estado: string;
  proveedor: string;
  monto: number;
  comprobanteUrl: string | null;
  motivoRechazo: string | null;
  createdAt: Date;
}

/** Último intento de cobro de un pedido. Es el que la pantalla tiene que mostrar. */
export async function cobroDelPedido(
  orderId: string,
): Promise<CobroDelPedido | null> {
  const [pago] = await db
    .select({
      id: payments.id,
      estado: payments.estado,
      proveedor: payments.proveedor,
      monto: payments.monto,
      comprobanteUrl: payments.comprobanteUrl,
      motivoRechazo: payments.motivoRechazo,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  if (!pago) return null;

  return { ...pago, monto: Number(pago.monto) };
}

export interface DatosParaTransferir {
  banco: string;
  titular: string;
  cuit: string;
  cbu: string;
  alias: string;
  instrucciones: string | null;
}

/**
 * Datos bancarios para mostrarle a quien va a transferir.
 *
 * Devuelve null cuando todavía no se cargaron: la pantalla ahí no inventa un
 * CBU ni muestra campos vacíos, le dice a la persona que los pida por WhatsApp.
 */
export async function datosParaTransferir(): Promise<DatosParaTransferir | null> {
  const [fila] = await db.select().from(datosBancarios).limit(1);

  if (!fila || (!fila.cbu && !fila.alias)) return null;

  return {
    banco: fila.banco,
    titular: fila.titular,
    cuit: fila.cuit,
    cbu: fila.cbu,
    alias: fila.alias,
    instrucciones: fila.instrucciones,
  };
}

export interface CobroSimulado {
  id: string;
  monto: number;
  estado: string;
  tipo: string;
  concepto: string;
  volverA: string;
}

/**
 * Datos de un cobro para la pantalla de demostración.
 *
 * Solo devuelve cobros del proveedor `demo`. Sin ese filtro, la pantalla de
 * simulación serviría para aprobar a mano un cobro real de Mercado Pago con
 * solo conocer su id.
 */
export async function cobroSimulado(
  pagoId: string,
): Promise<CobroSimulado | null> {
  const [pago] = await db
    .select({
      id: payments.id,
      monto: payments.monto,
      estado: payments.estado,
      tipo: payments.tipo,
      proveedor: payments.proveedor,
      numeroPedido: orders.numero,
      cliente: customers.nombre,
      evento: events.titulo,
      eventoSlug: events.slug,
    })
    .from(payments)
    .leftJoin(orders, eq(orders.id, payments.orderId))
    .leftJoin(customers, eq(customers.id, payments.customerId))
    // La inscripción guarda el pago, así que el camino de vuelta es por ahí.
    .leftJoin(eventRegistrations, eq(eventRegistrations.paymentId, payments.id))
    .leftJoin(events, eq(events.id, eventRegistrations.eventId))
    .where(eq(payments.id, pagoId))
    .limit(1);

  if (!pago || pago.proveedor !== "demo") return null;

  // Cada tipo de cobro vuelve a donde estaba la persona: a su pedido, a la
  // ficha del evento, o a su cuenta. Mandar a todos a la cuenta corriente
  // dejaba a quien se anotó a una capacitación mirando un saldo que no pidió.
  const concepto = pago.numeroPedido
    ? `Pedido ${pago.numeroPedido}`
    : pago.evento
      ? pago.evento
      : `Cuenta corriente${pago.cliente ? ` · ${pago.cliente}` : ""}`;

  const volverA = pago.numeroPedido
    ? `/pedido/${pago.numeroPedido}`
    : pago.eventoSlug
      ? `/eventos/${pago.eventoSlug}`
      : "/mi-cuenta/cuenta-corriente";

  return {
    id: pago.id,
    monto: Number(pago.monto),
    estado: pago.estado,
    tipo: pago.tipo,
    concepto,
    volverA,
  };
}
