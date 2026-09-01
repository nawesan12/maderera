import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  cashMovements,
  cashSessions,
  inventory,
  inventoryMovements,
  invoices,
  orderItems,
  orders,
  payments,
} from "@/lib/db/schema";

/**
 * Anula una venta de mostrador.
 *
 * En un mostrador uno se equivoca: se carga la medida que no era, se cobra de
 * más, el cliente se arrepiente antes de salir. Sin forma de deshacerlo, eso se
 * arregla afuera del sistema y a partir de ahí los números dejan de ser ciertos.
 *
 * **Nada se borra: todo se revierte.** El pedido queda cancelado, el stock
 * vuelve con un movimiento de devolución, la caja recibe un movimiento
 * negativo y la deuda se cancela con otro asiento. Un pedido que desaparece es
 * un pedido que nadie puede explicar tres meses después, y en la caja además
 * dejaría un descuadre imposible de rastrear.
 *
 * **El comprobante fiscal no se toca acá.** Si la venta salió con factura, esa
 * factura ya tiene CAE y se corrige con una nota de crédito, que es otra cosa y
 * ya está resuelta en `lib/fiscal`. Lo que hace esta función es avisar que hace
 * falta, no emitirla por su cuenta: emitir un comprobante es una decisión, no
 * un efecto secundario de tocar un botón.
 */

export interface ResultadoAnulacion {
  ok: boolean;
  error?: string;
  /** Id de la factura que quedó pendiente de nota de crédito, si la hubo. */
  facturaPendiente?: string;
}

export async function anularVentaDeMostrador(
  orderId: string,
  motivo: string,
  usuarioId: string,
): Promise<ResultadoAnulacion> {
  if (!motivo.trim()) {
    return {
      ok: false,
      error: "Poné el motivo: una anulación sin explicación no se puede revisar después.",
    };
  }

  return db.transaction(async (tx) => {
    // El lock es por pedido: dos toques al botón no pueden revertir dos veces.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orderId}))`);

    const [pedido] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!pedido) return { ok: false as const, error: "No encontramos la venta." };
    if (pedido.origen !== "mostrador") {
      return {
        ok: false as const,
        error: "Esto anula ventas de mostrador. Un pedido del sitio se cancela desde Pedidos.",
      };
    }
    if (pedido.estado === "cancelado") {
      return { ok: false as const, error: "Esa venta ya estaba anulada." };
    }

    const total = Number(pedido.total);
    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    /*
     * **Todo lo que puede rechazar la anulación va antes de la primera
     * escritura.** Salir de una transacción de Drizzle con un `return` la
     * confirma; solo una excepción la revierte. Con el control de la caja
     * después de devolver el stock, una anulación rechazada dejaba igual la
     * mercadería sumada al estante y la venta en pie: el stock contado dos
     * veces. Se encontró probando el rechazo, no leyendo el código.
     */
    let sesionId: string | null = null;

    if (pedido.medioPago === "efectivo" && pedido.branchId) {
      const [turno] = await tx
        .select({ id: cashSessions.id })
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.branchId, pedido.branchId),
            eq(cashSessions.estado, "abierta"),
          ),
        )
        .limit(1);

      if (!turno) {
        /*
         * Sin caja abierta no hay de dónde sacar el efectivo. Anular igual
         * dejaría un turno ya rendido con una venta que después dejó de
         * existir, y el arqueo de ese día pasaría a ser mentira.
         */
        return {
          ok: false as const,
          error:
            "La venta fue en efectivo y no hay caja abierta. Abrí la caja para poder devolver la plata.",
        };
      }
      sesionId = turno.id;
    }

    // 1. El stock vuelve al estante del que salió.
    for (const item of items) {
      if (!item.variantId || !pedido.branchId) continue;
      const unidades = Math.round(Number(item.cantidad));
      if (unidades <= 0) continue;

      await tx
        .update(inventory)
        .set({ qty: sql`${inventory.qty} + ${unidades}`, updatedAt: new Date() })
        .where(
          and(
            eq(inventory.variantId, item.variantId),
            eq(inventory.branchId, pedido.branchId),
          ),
        );

      await tx.insert(inventoryMovements).values({
        variantId: item.variantId,
        branchId: pedido.branchId,
        type: "devolucion",
        qty: unidades,
        note: `Anulación ${pedido.numero}`,
        createdByUserId: usuarioId,
      });
    }

    // 2. La plata sale de la caja si es que había entrado ahí.
    if (sesionId) {
      await tx.insert(cashMovements).values({
        sessionId: sesionId,
        tipo: "devolucion",
        monto: (-total).toFixed(2),
        motivo: `Anulación ${pedido.numero}: ${motivo.trim()}`,
        orderId: pedido.id,
        creadoPor: usuarioId,
      });
    }

    // 3. La deuda se cancela con otro asiento, no borrando el original.
    if (pedido.medioPago === "cuenta_corriente" && pedido.customerId) {
      await tx.insert(accountMovements).values({
        customerId: pedido.customerId,
        tipo: "nota_credito",
        monto: (-total).toFixed(2),
        detalle: `Anulación de la venta ${pedido.numero}: ${motivo.trim()}`,
        referencia: pedido.numero,
        createdByUserId: usuarioId,
      });
    }

    // 4. El cobro pasa a reintegrado. No se borra, por lo mismo que todo lo
    //    demás: la pantalla de cobros tiene que poder mostrar que entró y salió.
    await tx
      .update(payments)
      .set({ estado: "reintegrado", updatedAt: new Date() })
      .where(and(eq(payments.orderId, orderId), eq(payments.estado, "aprobado")));

    await tx
      .update(orders)
      .set({
        estado: "cancelado",
        estadoPago: "reintegrado",
        notas: [pedido.notas, `Anulada: ${motivo.trim()}`]
          .filter(Boolean)
          .join("\n"),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    const [factura] = await tx
      .select({ id: invoices.id, estado: invoices.estado })
      .from(invoices)
      .where(eq(invoices.orderId, orderId))
      .limit(1);

    return {
      ok: true as const,
      facturaPendiente:
        factura && factura.estado !== "anulada" ? factura.id : undefined,
    };
  });
}
