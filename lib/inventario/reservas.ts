import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { claveDeLock } from "@/lib/inventario/locks";
import {
  branches,
  inventory,
  inventoryMovements,
  orderItems,
  orders,
  stockReservations,
} from "@/lib/db/schema";

/**
 * El puente entre vender y el depósito.
 *
 * Hasta ahora vender no tocaba el inventario: el stock solo se movía con
 * ajustes y transferencias del panel. Eso hacía que la tienda pudiera vender
 * diez veces la misma placa, y que el número del sistema se separara del real
 * un poco más con cada venta.
 *
 * El ciclo tiene tres momentos y cada uno hace una cosa distinta:
 *
 * | Momento | Físico (`qty`) | Reservado |
 * |---|---|---|
 * | Se confirma el pedido | no cambia | sube |
 * | Sale la mercadería | baja | baja |
 * | Se cancela el pedido | no cambia | baja |
 *
 * **Disponible = `qty − reservado`.** Confirmar no baja el físico porque la
 * mercadería sigue estando en el galpón: si alguien va a contar, tiene que
 * encontrar lo que dice el sistema. Lo que cambia es que ya tiene dueño.
 */

type Transaccion = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Sucursal a la que descontarle.
 *
 * Un pedido de envío no tiene sucursal elegida por el cliente, así que se usa
 * la primera activa. Es una convención explícita y no un descuido: mejor
 * descontar de una sucursal concreta y que el traslado se vea en el libro de
 * movimientos, que no descontar de ninguna.
 */
async function sucursalDelPedido(
  tx: Transaccion,
  branchId: string | null,
): Promise<string | null> {
  if (branchId) return branchId;

  const [primera] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.active, true))
    .orderBy(branches.sortOrder)
    .limit(1);

  return primera?.id ?? null;
}

/** Suma `delta` al reservado y deja la fila de inventario consistente. */
async function moverReservado(
  tx: Transaccion,
  variantId: string,
  branchId: string,
  delta: number,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${claveDeLock(variantId, branchId)})`);

  // `greatest(...,0)`: si por un arrastre histórico el reservado quedara en
  // cero y llegara una liberación, la columna no puede irse a negativo. El
  // recuento real vive en `stock_reservations`.
  await tx
    .update(inventory)
    .set({
      reservado: sql`greatest(${inventory.reservado} + ${delta}, 0)`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(inventory.variantId, variantId), eq(inventory.branchId, branchId)),
    );
}

/**
 * Reserva la mercadería de un pedido.
 *
 * Idempotente: si el pedido ya tiene reservas activas no hace nada. Un pedido
 * que pasa a preparando, vuelve a pendiente y avanza de nuevo no puede reservar
 * dos veces.
 */
export async function reservarPedido(
  tx: Transaccion,
  orderId: string,
): Promise<void> {
  const [yaHay] = await tx
    .select({ id: stockReservations.id })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.orderId, orderId),
        eq(stockReservations.estado, "activa"),
      ),
    )
    .limit(1);

  if (yaHay) return;

  const [pedido] = await tx
    .select({ branchId: orders.branchId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!pedido) return;

  const branchId = await sucursalDelPedido(tx, pedido.branchId);
  if (!branchId) return;

  const lineas = await tx
    .select({
      id: orderItems.id,
      variantId: orderItems.variantId,
      cantidad: orderItems.cantidad,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  for (const linea of lineas) {
    // Una línea sin variante es un producto tipeado a mano en el mostrador:
    // no hay nada que reservar porque no está en el catálogo.
    if (!linea.variantId) continue;

    const cantidad = Math.ceil(Number(linea.cantidad));
    if (!(cantidad > 0)) continue;

    await tx.insert(stockReservations).values({
      orderId,
      orderItemId: linea.id,
      variantId: linea.variantId,
      branchId,
      cantidad,
    });

    await moverReservado(tx, linea.variantId, branchId, cantidad);
  }
}

/**
 * Libera lo reservado de un pedido, sin tocar el físico.
 *
 * Es lo que corresponde al cancelar: la mercadería nunca salió.
 */
export async function liberarReservas(
  tx: Transaccion,
  orderId: string,
): Promise<void> {
  const activas = await tx
    .select()
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.orderId, orderId),
        eq(stockReservations.estado, "activa"),
      ),
    );

  for (const reserva of activas) {
    await moverReservado(tx, reserva.variantId, reserva.branchId, -reserva.cantidad);
  }

  if (activas.length > 0) {
    await tx
      .update(stockReservations)
      .set({ estado: "liberada", resueltoAt: new Date() })
      .where(
        inArray(
          stockReservations.id,
          activas.map((r) => r.id),
        ),
      );
  }
}

export interface SalidaDeMercaderia {
  orderItemId: string;
  cantidad: number;
}

/**
 * Saca mercadería del depósito de verdad.
 *
 * Baja el físico, consume la reserva correspondiente y deja el movimiento
 * `venta` en el libro. Es el único lugar donde una venta descuenta stock, y
 * corre dentro de la transacción que crea el remito: si el remito no se guarda,
 * el stock tampoco se movió.
 *
 * Acepta cantidades parciales porque el acopio se retira de a poco.
 */
export async function salidaPorEntrega(
  tx: Transaccion,
  opciones: {
    orderId: string;
    branchId: string;
    numeroRemito: string;
    lineas: SalidaDeMercaderia[];
    usuarioId?: string;
  },
): Promise<void> {
  for (const linea of opciones.lineas) {
    const [renglon] = await tx
      .select({ variantId: orderItems.variantId })
      .from(orderItems)
      .where(eq(orderItems.id, linea.orderItemId))
      .limit(1);

    if (!renglon?.variantId) continue;

    const cantidad = Math.ceil(linea.cantidad);
    if (!(cantidad > 0)) continue;

    const variantId = renglon.variantId;

    await tx.execute(
      sql`select pg_advisory_xact_lock(${claveDeLock(variantId, opciones.branchId)})`,
    );

    // El físico baja. Puede quedar en negativo si el depósito entregó algo que
    // el sistema no tenía cargado, y eso está bien: un negativo es visible y
    // se corrige contando, mientras que un cero forzado esconde el faltante.
    await tx
      .update(inventory)
      .set({
        qty: sql`${inventory.qty} - ${cantidad}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventory.variantId, variantId),
          eq(inventory.branchId, opciones.branchId),
        ),
      );

    await tx.insert(inventoryMovements).values({
      variantId,
      branchId: opciones.branchId,
      type: "venta",
      qty: -cantidad,
      note: `Remito ${opciones.numeroRemito}`,
      createdByUserId: opciones.usuarioId,
    });

    // La reserva de ese renglón se consume por la misma cantidad que salió.
    const [reserva] = await tx
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.orderItemId, linea.orderItemId),
          eq(stockReservations.estado, "activa"),
        ),
      )
      .limit(1);

    if (!reserva) continue;

    const consumido = Math.min(cantidad, reserva.cantidad);
    await moverReservado(tx, variantId, reserva.branchId, -consumido);

    if (consumido >= reserva.cantidad) {
      await tx
        .update(stockReservations)
        .set({ estado: "consumida", resueltoAt: new Date() })
        .where(eq(stockReservations.id, reserva.id));
    } else {
      // Entrega parcial: queda reservado el resto del renglón.
      await tx
        .update(stockReservations)
        .set({ cantidad: reserva.cantidad - consumido })
        .where(eq(stockReservations.id, reserva.id));
    }
  }
}

/**
 * Devuelve mercadería al galpón.
 *
 * La usa la anulación de un remito. Sube el físico y deja un movimiento de
 * `devolucion` en el libro: el stock no puede subir sin que quede escrito por
 * qué, o la primera diferencia de inventario se vuelve inexplicable.
 *
 * No vuelve a reservar. Anular un remito suele ser corregir un error de carga,
 * y adivinar si la mercadería sigue vendida sería inventar; si el pedido sigue
 * abierto, se genera el remito correcto y ahí se descuenta de nuevo.
 */
export async function devolverAlStock(
  tx: Transaccion,
  opciones: {
    branchId: string;
    numeroRemito: string;
    usuarioId?: string;
    lineas: { variantId: string; cantidad: number }[];
  },
): Promise<void> {
  for (const linea of opciones.lineas) {
    if (!(linea.cantidad > 0)) continue;

    await tx.execute(
      sql`select pg_advisory_xact_lock(${claveDeLock(linea.variantId, opciones.branchId)})`,
    );

    await tx
      .update(inventory)
      .set({
        qty: sql`${inventory.qty} + ${linea.cantidad}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventory.variantId, linea.variantId),
          eq(inventory.branchId, opciones.branchId),
        ),
      );

    await tx.insert(inventoryMovements).values({
      variantId: linea.variantId,
      branchId: opciones.branchId,
      type: "devolucion",
      qty: linea.cantidad,
      note: `Anulación del remito ${opciones.numeroRemito}`,
      createdByUserId: opciones.usuarioId,
    });
  }
}

/**
 * Reconstruye `inventory.reservado` desde las reservas activas.
 *
 * La columna es una suma guardada, y toda suma guardada se puede desincronizar.
 * Esto es el botón para comprobarlo y arreglarlo sin tocar la base a mano.
 * Devuelve cuántas filas quedaron distintas de lo que decían.
 */
export async function recalcularReservado(): Promise<number> {
  const resultado = await db.execute(sql`
    with reales as (
      select variant_id, branch_id, sum(cantidad)::int as total
      from stock_reservations
      where estado = 'activa'
      group by variant_id, branch_id
    )
    update inventory i
       set reservado = coalesce(r.total, 0),
           updated_at = now()
      from (select id, variant_id, branch_id from inventory) src
      left join reales r
        on r.variant_id = src.variant_id and r.branch_id = src.branch_id
     where i.id = src.id
       and i.reservado is distinct from coalesce(r.total, 0)
  `);

  return resultado.rowCount ?? 0;
}
