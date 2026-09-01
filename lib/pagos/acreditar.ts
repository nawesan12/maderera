import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  eventRegistrations,
  orders,
  payments,
} from "@/lib/db/schema";
import type { PagoRemoto } from "./tipos";

/**
 * La única función que mueve plata.
 *
 * Todo cobro —Mercado Pago, transferencia conciliada a mano, demo— termina acá.
 * Concentrarlo en un lugar es lo que permite que la regla de idempotencia sea
 * una sola y no una por camino.
 *
 * Tres cuidados que no se pueden "simplificar":
 *
 * 1. **Idempotencia.** Mercado Pago reintenta el webhook hasta que le
 *    contestan 200, y manda el mismo aviso varias veces por las dudas. Sin
 *    corte, un pedido de $500.000 descuenta $1.000.000 de la cuenta corriente.
 *    El corte es doble: el lock de transacción por pago, y la comparación
 *    contra el estado que ya tiene la fila.
 *
 * 2. **El monto se verifica.** Si el proveedor informa un importe distinto al
 *    nuestro, el pago **no** se acredita: queda en revisión con el motivo. Un
 *    aviso de "aprobado" por $1 sobre un pedido de $500.000 es exactamente
 *    cómo se ve un intento de fraude.
 *
 * 3. **Los avisos se mandan afuera.** La transacción cierra antes de tocar
 *    email o WhatsApp, por la misma razón por la que el pedido de CAE va fuera
 *    de la transacción en `lib/fiscal/emitir.ts`: no dejar una transacción
 *    abierta esperando a un tercero.
 */

export interface ResultadoAcreditacion {
  /** Falso cuando el aviso no cambió nada: repetido, o estado que ya tenía. */
  cambio: boolean;
  estado: string;
  orderId: string | null;
  customerId: string | null;
  tipo: "pedido" | "deuda" | "inscripcion";
  monto: number;
  motivo?: string;
}

/** Entero estable para el lock, derivado del uuid del pago. */
function claveDeLock(pagoId: string): ReturnType<typeof sql> {
  return sql`hashtext(${pagoId})`;
}

const TOLERANCIA = 0.5;

export async function acreditarPago(
  pagoId: string,
  remoto: PagoRemoto,
): Promise<ResultadoAcreditacion> {
  return db.transaction(async (tx) => {
    // Dos reintentos del mismo webhook llegando a la vez leerían los dos el
    // estado viejo y los dos decidirían acreditar. El lock serializa; se libera
    // solo al cerrar la transacción, con commit o con rollback.
    await tx.execute(sql`select pg_advisory_xact_lock(${claveDeLock(pagoId)})`);

    const [pago] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, pagoId))
      .limit(1);

    if (!pago) {
      return {
        cambio: false,
        estado: "desconocido",
        orderId: null,
        customerId: null,
        tipo: "pedido" as const,
        monto: 0,
        motivo: "El aviso no corresponde a ningún cobro nuestro.",
      };
    }

    const nuestroMonto = Number(pago.monto);
    const base = {
      orderId: pago.orderId,
      customerId: pago.customerId,
      tipo: pago.tipo,
      monto: nuestroMonto,
    };

    // Ya está en ese estado: es un reintento del proveedor. Se contesta que sí
    // y no se toca nada.
    if (pago.estado === remoto.estado) {
      return { cambio: false, estado: pago.estado, ...base };
    }

    // Un pago aprobado solo puede pasar a reintegrado. Cualquier otro aviso
    // posterior —un "pendiente" que llegó tarde y desordenado— se ignora.
    if (pago.estado === "aprobado" && remoto.estado !== "reintegrado") {
      return { cambio: false, estado: pago.estado, ...base };
    }

    if (
      remoto.estado === "aprobado" &&
      remoto.monto != null &&
      Math.abs(remoto.monto - nuestroMonto) > TOLERANCIA
    ) {
      const motivo = `El proveedor informó $${remoto.monto.toFixed(2)} y el cobro es de $${nuestroMonto.toFixed(2)}.`;

      await tx
        .update(payments)
        .set({
          estado: "en_revision",
          proveedorPaymentId: remoto.id,
          medio: remoto.medio,
          detalle: remoto.crudo as object,
          motivoRechazo: motivo,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, pagoId));

      return { cambio: true, estado: "en_revision", ...base, motivo };
    }

    const acredita = remoto.estado === "aprobado";
    const revierte = remoto.estado === "reintegrado" && pago.estado === "aprobado";

    let accountMovementId = pago.accountMovementId;

    if (acredita && pago.tipo === "deuda" && pago.customerId) {
      // Negativo porque en `account_movements` positivo es lo que el cliente
      // debe. Este es el único lugar donde un pago online toca la cuenta.
      const [movimiento] = await tx
        .insert(accountMovements)
        .values({
          customerId: pago.customerId,
          tipo: "pago",
          monto: (-nuestroMonto).toFixed(2),
          detalle: `Pago online${remoto.medio ? ` (${remoto.medio})` : ""}`,
          referencia: remoto.id,
        })
        .returning({ id: accountMovements.id });

      accountMovementId = movimiento.id;
    }

    // Una inscripción a un evento con precio queda reservada —ocupando lugar—
    // hasta que el pago se acredita. Va acá y no en un webhook aparte por la
    // misma razón que la cuenta corriente: un solo lugar mueve plata, y un solo
    // lugar decide qué pasa cuando entra.
    if (acredita && pago.tipo === "inscripcion") {
      await tx
        .update(eventRegistrations)
        .set({ estado: "confirmada", updatedAt: new Date() })
        .where(eq(eventRegistrations.paymentId, pago.id));
    }

    if (revierte && pago.tipo === "inscripcion") {
      // Reintegrado: el lugar se libera. Mantenerlo ocupado dejaría un cupo
      // muerto que nadie puede usar.
      await tx
        .update(eventRegistrations)
        .set({ estado: "cancelada", updatedAt: new Date() })
        .where(eq(eventRegistrations.paymentId, pago.id));
    }

    if (revierte && pago.tipo === "deuda" && pago.customerId) {
      // La deuda vuelve. No se borra el movimiento original: la cuenta
      // corriente es un libro, y un asiento que desaparece es un asiento que
      // nadie puede explicar tres meses después.
      await tx.insert(accountMovements).values({
        customerId: pago.customerId,
        tipo: "ajuste",
        monto: nuestroMonto.toFixed(2),
        detalle: "Reintegro de un pago online",
        referencia: remoto.id,
      });
    }

    await tx
      .update(payments)
      .set({
        estado: remoto.estado,
        proveedorPaymentId: remoto.id,
        medio: remoto.medio,
        detalle: remoto.crudo as object,
        motivoRechazo: remoto.motivoRechazo,
        accountMovementId,
        acreditadoAt: acredita ? new Date() : pago.acreditadoAt,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, pagoId));

    if (pago.orderId && (acredita || revierte)) {
      await tx
        .update(orders)
        .set({
          estadoPago: acredita ? "pagado" : "reintegrado",
          updatedAt: new Date(),
        })
        .where(eq(orders.id, pago.orderId));
    }

    if (pago.orderId && remoto.estado === "rechazado") {
      await tx
        .update(orders)
        .set({ estadoPago: "rechazado", updatedAt: new Date() })
        .where(eq(orders.id, pago.orderId));
    }

    return { cambio: true, estado: remoto.estado, ...base };
  });
}
