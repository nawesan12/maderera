import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customers,
  eventRegistrations,
  events,
  orderItems,
  orders,
  payments,
} from "@/lib/db/schema";
import { urlBase, urlWebhookPagos } from "./config";
import { proveedorPagos } from "./index";

/**
 * Apertura de un cobro.
 *
 * Crea la fila en `payments` **antes** de pedirle nada al proveedor: el id de
 * esa fila es la referencia externa que después vuelve en el aviso. Al revés
 * —pedir la preferencia y guardar después— habría una ventana en la que el
 * cliente ya está pagando en Mercado Pago y acá no existe el pago; si el aviso
 * llega en ese instante, no hay a qué atarlo.
 */

export interface CobroAbierto {
  pagoId: string;
  urlPago: string;
  /** Falso cuando corre el proveedor de demostración. */
  real: boolean;
}

export class ErrorDeCobro extends Error {}

/** Abre el pago online de un pedido y devuelve a dónde mandar a la persona. */
export async function iniciarPagoDePedido(
  orderId: string,
  usuarioId?: string,
): Promise<CobroAbierto> {
  const [pedido] = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      total: orders.total,
      estadoPago: orders.estadoPago,
      customerId: orders.customerId,
      contactoNombre: orders.contactoNombre,
      contactoEmail: orders.contactoEmail,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!pedido) throw new ErrorDeCobro("El pedido no existe.");
  if (pedido.estadoPago === "pagado") {
    throw new ErrorDeCobro("Este pedido ya está pagado.");
  }

  const monto = Number(pedido.total);
  if (!(monto > 0)) throw new ErrorDeCobro("El pedido no tiene importe a cobrar.");

  const lineas = await db
    .select({
      descripcion: orderItems.descripcion,
      cantidad: orderItems.cantidad,
      precioUnitario: orderItems.precioUnitario,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const proveedor = proveedorPagos();

  const [pago] = await db
    .insert(payments)
    .values({
      orderId: pedido.id,
      customerId: pedido.customerId,
      tipo: "pedido",
      proveedor: proveedor.nombre === "demo" ? "demo" : "mercado_pago",
      monto: monto.toFixed(2),
      estado: "iniciado",
      createdByUserId: usuarioId,
    })
    .returning({ id: payments.id });

  const preferencia = await proveedor.crearPreferencia({
    referencia: pago.id,
    descripcion: `Pedido ${pedido.numero}`,
    monto,
    // El costo de envío se manda como un renglón más para que el detalle de
    // Mercado Pago sume exactamente el total del pedido. Si no cierra, la
    // persona ve un importe distinto al que confirmó y abandona.
    items:
      lineas.length > 0
        ? lineas.map((l) => ({
            titulo: l.descripcion,
            cantidad: Number(l.cantidad),
            precioUnitario: Number(l.precioUnitario),
          }))
        : [{ titulo: `Pedido ${pedido.numero}`, cantidad: 1, precioUnitario: monto }],
    pagador: { nombre: pedido.contactoNombre, email: pedido.contactoEmail },
    urlRetorno: `${urlBase()}/pedido/${pedido.numero}`,
    urlWebhook: urlWebhookPagos(),
  });

  await db
    .update(payments)
    .set({ preferenciaId: preferencia.preferenciaId, updatedAt: new Date() })
    .where(eq(payments.id, pago.id));

  return { pagoId: pago.id, urlPago: preferencia.urlPago, real: proveedor.real };
}

/**
 * Abre el pago de deuda de cuenta corriente (cláusula 1.6).
 *
 * El monto lo elige el cliente porque los pagos a cuenta son la norma en el
 * rubro: se abona una parte y se sigue comprando. Lo único que se valida es que
 * sea positivo y que no supere lo que debe, para que un tipeo de más no genere
 * un saldo a favor que después hay que devolver.
 */
export async function iniciarPagoDeDeuda(
  customerId: string,
  monto: number,
  saldoActual: number,
  usuarioId?: string,
): Promise<CobroAbierto> {
  if (!(monto > 0)) throw new ErrorDeCobro("Ingresá un importe mayor a cero.");

  if (saldoActual <= 0) {
    throw new ErrorDeCobro("La cuenta no tiene saldo pendiente.");
  }

  if (monto - saldoActual > 0.5) {
    throw new ErrorDeCobro(
      `El importe supera la deuda. El saldo pendiente es de $${saldoActual.toFixed(2)}.`,
    );
  }

  const [cliente] = await db
    .select({ nombre: customers.nombre, email: customers.email })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!cliente) throw new ErrorDeCobro("La ficha de cliente no existe.");

  const proveedor = proveedorPagos();

  const [pago] = await db
    .insert(payments)
    .values({
      customerId,
      tipo: "deuda",
      proveedor: proveedor.nombre === "demo" ? "demo" : "mercado_pago",
      monto: monto.toFixed(2),
      estado: "iniciado",
      createdByUserId: usuarioId,
    })
    .returning({ id: payments.id });

  const preferencia = await proveedor.crearPreferencia({
    referencia: pago.id,
    descripcion: "Pago de cuenta corriente",
    monto,
    items: [
      { titulo: "Pago de cuenta corriente", cantidad: 1, precioUnitario: monto },
    ],
    pagador: { nombre: cliente.nombre, email: cliente.email },
    urlRetorno: `${urlBase()}/mi-cuenta/cuenta-corriente`,
    urlWebhook: urlWebhookPagos(),
  });

  await db
    .update(payments)
    .set({ preferenciaId: preferencia.preferenciaId, updatedAt: new Date() })
    .where(eq(payments.id, pago.id));

  return { pagoId: pago.id, urlPago: preferencia.urlPago, real: proveedor.real };
}

/**
 * Deja registrada una transferencia bancaria con su comprobante.
 *
 * Nace en `en_revision` y no en `aprobado`: una imagen subida por el cliente no
 * es plata acreditada. Alguien de la casa mira el extracto y la concilia desde
 * `/admin/pagos`, y recién ahí pasa por `acreditarPago` como cualquier otro
 * cobro.
 */
export async function registrarTransferencia(opciones: {
  orderId?: string | null;
  customerId?: string | null;
  tipo: "pedido" | "deuda";
  monto: number;
  comprobanteUrl: string;
}): Promise<string> {
  if (!(opciones.monto > 0)) {
    throw new ErrorDeCobro("El importe tiene que ser mayor a cero.");
  }

  const [pago] = await db
    .insert(payments)
    .values({
      orderId: opciones.orderId ?? null,
      customerId: opciones.customerId ?? null,
      tipo: opciones.tipo,
      proveedor: "transferencia",
      monto: opciones.monto.toFixed(2),
      estado: "en_revision",
      comprobanteUrl: opciones.comprobanteUrl,
    })
    .returning({ id: payments.id });

  return pago.id;
}

/**
 * Abre el pago de una inscripción a un evento (cláusula 1.7).
 *
 * La inscripción ya existe y está en `reservada`: ocupa lugar mientras la
 * persona termina de pagar. Si abandona el pago, queda reservada y el cupo se
 * libera cuando alguien de la casa la cancela desde el panel —soltarlo solo
 * después de N minutos sería mejor, pero exige un proceso periódico que este
 * sistema todavía no tiene, y prefiero que el cupo esté de más antes que
 * vender dos veces el mismo lugar—.
 */
export async function iniciarPagoDeInscripcion(
  registrationId: string,
  usuarioId?: string,
): Promise<CobroAbierto> {
  const [inscripcion] = await db
    .select({
      id: eventRegistrations.id,
      nombre: eventRegistrations.nombre,
      email: eventRegistrations.email,
      customerId: eventRegistrations.customerId,
      estado: eventRegistrations.estado,
      evento: events.titulo,
      slug: events.slug,
      precio: events.precio,
    })
    .from(eventRegistrations)
    .innerJoin(events, eq(events.id, eventRegistrations.eventId))
    .where(eq(eventRegistrations.id, registrationId))
    .limit(1);

  if (!inscripcion) throw new ErrorDeCobro("La inscripción no existe.");
  if (inscripcion.estado === "confirmada") {
    throw new ErrorDeCobro("Esta inscripción ya está paga.");
  }

  const monto = Number(inscripcion.precio);
  if (!(monto > 0)) throw new ErrorDeCobro("Este evento no tiene costo.");

  const proveedor = proveedorPagos();

  const [pago] = await db
    .insert(payments)
    .values({
      customerId: inscripcion.customerId,
      tipo: "inscripcion",
      proveedor: proveedor.nombre === "demo" ? "demo" : "mercado_pago",
      monto: monto.toFixed(2),
      estado: "iniciado",
      createdByUserId: usuarioId,
    })
    .returning({ id: payments.id });

  // La inscripción guarda el pago antes de mandar a nadie a pagar: es lo que
  // permite confirmarla cuando vuelva el aviso.
  await db
    .update(eventRegistrations)
    .set({ paymentId: pago.id, updatedAt: new Date() })
    .where(eq(eventRegistrations.id, registrationId));

  const preferencia = await proveedor.crearPreferencia({
    referencia: pago.id,
    descripcion: inscripcion.evento,
    monto,
    items: [
      { titulo: inscripcion.evento, cantidad: 1, precioUnitario: monto },
    ],
    pagador: { nombre: inscripcion.nombre, email: inscripcion.email },
    urlRetorno: `${urlBase()}/eventos/${inscripcion.slug}`,
    urlWebhook: urlWebhookPagos(),
  });

  await db
    .update(payments)
    .set({ preferenciaId: preferencia.preferenciaId, updatedAt: new Date() })
    .where(eq(payments.id, pago.id));

  return { pagoId: pago.id, urlPago: preferencia.urlPago, real: proveedor.real };
}
