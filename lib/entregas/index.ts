import "server-only";

import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  deliveries,
  deliveryItems,
  orderItems,
  orderStatusHistory,
  orders,
  shipments,
} from "@/lib/db/schema";
import { salidaPorEntrega } from "@/lib/inventario/reservas";

/**
 * Entregas y acopio.
 *
 * En una maderera el pedido rara vez se lleva de una sola vez: se compra la
 * obra entera, la mercadería queda en acopio y el cliente va retirando a
 * medida que avanza. Por eso "entregado" no es un estado del pedido sino una
 * cuenta: lo pedido menos lo que ya salió.
 *
 * Cada retiro genera un remito, y el remito reemplaza al papel (cláusula 1.6):
 * lo firma quien retira, desde el celular.
 */

export interface RenglonPendiente {
  orderItemId: string;
  descripcion: string;
  unidad: string;
  pedido: number;
  entregado: number;
  pendiente: number;
}

/**
 * Qué queda por entregar de un pedido.
 *
 * Se calcula, no se guarda, por la misma razón por la que no se guarda el saldo
 * de cuenta corriente: un total cacheado se desincroniza en cuanto algo falla a
 * la mitad, y acá la diferencia se descubre discutiendo con el cliente en el
 * mostrador.
 */
export async function saldoDeAcopio(
  orderId: string,
): Promise<RenglonPendiente[]> {
  const filas = await db
    .select({
      orderItemId: orderItems.id,
      descripcion: orderItems.descripcion,
      unidad: orderItems.unidad,
      pedido: orderItems.cantidad,
      orden: orderItems.orden,
      // Subconsulta escrita entera a mano, con alias y nombres cualificados.
      // Interpolar `orderItems.id` con la plantilla de Drizzle emite solo
      // `"id"`, y ahí `deliveries.id` y `order_items.id` colisionan: Postgres
      // rechaza la consulta por referencia ambigua.
      entregado: sql<string>`coalesce((
        select sum(di.cantidad)
        from delivery_items di
        join deliveries d on d.id = di.delivery_id
        where di.order_item_id = order_items.id
          and d.estado <> 'anulada'
      ), 0)`,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.orden);

  return filas.map((f) => {
    const pedido = Number(f.pedido);
    const entregado = Number(f.entregado);
    return {
      orderItemId: f.orderItemId,
      descripcion: f.descripcion,
      unidad: f.unidad,
      pedido,
      entregado,
      pendiente: Math.max(pedido - entregado, 0),
    };
  });
}

export class ErrorDeEntrega extends Error {}

/** Siguiente número de remito, dentro de la transacción y con lock. */
async function siguienteNumeroRemito(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<string> {
  // Mismo criterio que la numeración fiscal: el número se toma adentro de la
  // transacción y con lock, para que dos personas despachando a la vez no se
  // lleven el mismo. Acá no lo exige ARCA, pero dos remitos con el mismo número
  // son igual de imposibles de explicar.
  await tx.execute(sql`select pg_advisory_xact_lock(918273645)`);

  const [fila] = await tx
    .select({
      maximo: sql<number>`coalesce(max(nullif(regexp_replace(${deliveries.numero}, '\\D', '', 'g'), '')::bigint), 0)::int`,
    })
    .from(deliveries);

  return `REM-${String((fila?.maximo ?? 0) + 1).padStart(4, "0")}`;
}

export interface LineaAEntregar {
  orderItemId: string;
  cantidad: number;
}

export interface EntregaCreada {
  id: string;
  numero: string;
  firmaToken: string;
  pedidoCompleto: boolean;
}

/**
 * Prepara un remito y saca la mercadería del depósito.
 *
 * Todo en una transacción: el remito, sus líneas, el descuento de stock y el
 * consumo de la reserva. Si algo falla, no queda ni un remito sin stock
 * descontado ni stock descontado sin remito que lo explique.
 */
export async function crearEntrega(opciones: {
  orderId: string;
  tipo: "retiro" | "envio";
  lineas: LineaAEntregar[];
  receptorNombre?: string | null;
  receptorDocumento?: string | null;
  notas?: string | null;
  transportista?: string | null;
  numeroSeguimiento?: string | null;
  usuarioId?: string;
}): Promise<EntregaCreada> {
  const pendientes = await saldoDeAcopio(opciones.orderId);
  const porItem = new Map(pendientes.map((p) => [p.orderItemId, p]));

  const lineas = opciones.lineas.filter((l) => l.cantidad > 0);

  if (lineas.length === 0) {
    throw new ErrorDeEntrega("Elegí al menos un producto para entregar.");
  }

  for (const linea of lineas) {
    const renglon = porItem.get(linea.orderItemId);

    if (!renglon) {
      throw new ErrorDeEntrega("Hay un producto que no pertenece a este pedido.");
    }

    // Un centavo de tolerancia por el redondeo de los decimales; más que eso es
    // un error de carga y entregar de más deja el pedido en negativo.
    if (linea.cantidad - renglon.pendiente > 0.01) {
      throw new ErrorDeEntrega(
        `De "${renglon.descripcion}" quedan ${renglon.pendiente} y estás entregando ${linea.cantidad}.`,
      );
    }
  }

  const [pedido] = await db
    .select({ id: orders.id, branchId: orders.branchId, estado: orders.estado })
    .from(orders)
    .where(eq(orders.id, opciones.orderId))
    .limit(1);

  if (!pedido) throw new ErrorDeEntrega("El pedido no existe.");
  if (pedido.estado === "cancelado") {
    throw new ErrorDeEntrega("El pedido está cancelado.");
  }

  const firmaToken = randomBytes(24).toString("base64url");

  return db.transaction(async (tx) => {
    const numero = await siguienteNumeroRemito(tx);

    const [entrega] = await tx
      .insert(deliveries)
      .values({
        numero,
        orderId: opciones.orderId,
        branchId: pedido.branchId,
        tipo: opciones.tipo,
        estado: "preparada",
        receptorNombre: opciones.receptorNombre ?? null,
        receptorDocumento: opciones.receptorDocumento ?? null,
        notas: opciones.notas ?? null,
        firmaToken,
        createdByUserId: opciones.usuarioId,
      })
      .returning({ id: deliveries.id });

    await tx.insert(deliveryItems).values(
      lineas.map((linea, i) => ({
        deliveryId: entrega.id,
        orderItemId: linea.orderItemId,
        cantidad: linea.cantidad.toFixed(2),
        orden: i,
      })),
    );

    if (opciones.tipo === "envio") {
      await tx.insert(shipments).values({
        deliveryId: entrega.id,
        transportista: opciones.transportista ?? null,
        numeroSeguimiento: opciones.numeroSeguimiento ?? null,
        estado: "preparando",
      });
    }

    if (pedido.branchId) {
      await salidaPorEntrega(tx, {
        orderId: opciones.orderId,
        branchId: pedido.branchId,
        numeroRemito: numero,
        lineas,
        usuarioId: opciones.usuarioId,
      });
    }

    // Si con esto no queda nada pendiente, el pedido está entregado. Dejarlo
    // "listo" obligaría a alguien a acordarse de cerrarlo a mano, y esa es la
    // clase de tarea que no se hace.
    const entregadoAhora = new Map<string, number>();
    for (const linea of lineas) {
      entregadoAhora.set(
        linea.orderItemId,
        (entregadoAhora.get(linea.orderItemId) ?? 0) + linea.cantidad,
      );
    }

    const completo = pendientes.every((p) => {
      const restante = p.pendiente - (entregadoAhora.get(p.orderItemId) ?? 0);
      return restante <= 0.01;
    });

    if (completo && pedido.estado !== "entregado") {
      await tx
        .update(orders)
        .set({ estado: "entregado", updatedAt: new Date() })
        .where(eq(orders.id, opciones.orderId));

      await tx.insert(orderStatusHistory).values({
        orderId: opciones.orderId,
        estado: "entregado",
        nota: `Remito ${numero}: se retiró todo lo que quedaba`,
        createdByUserId: opciones.usuarioId,
      });
    }

    return { id: entrega.id, numero, firmaToken, pedidoCompleto: completo };
  });
}

/**
 * Guarda la firma de quien retiró.
 *
 * Lo que hace valer esta firma como reemplazo del remito en papel no es el
 * dibujo sino el contexto —cuándo y desde dónde—, así que se guarda al lado.
 *
 * **El token no se borra al firmar.** Lo que invalida el link es el cambio de
 * estado: `registrarFirma` solo acepta remitos en `preparada`, así que el
 * segundo intento no hace nada. Borrarlo dejaba al cliente frente a un 404
 * justo después de firmar, en lugar de la constancia de lo que se llevó, que es
 * exactamente lo que quiere ver.
 */
export async function registrarFirma(opciones: {
  token: string;
  firmaUrl: string;
  receptorNombre: string;
  receptorDocumento?: string | null;
  ip: string | null;
}): Promise<{ deliveryId: string; numero: string } | null> {
  const [entrega] = await db
    .select({ id: deliveries.id, numero: deliveries.numero })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.firmaToken, opciones.token),
        eq(deliveries.estado, "preparada"),
      ),
    )
    .limit(1);

  if (!entrega) return null;

  await db
    .update(deliveries)
    .set({
      estado: "entregada",
      firmaUrl: opciones.firmaUrl,
      firmadoAt: new Date(),
      firmadoIp: opciones.ip,
      receptorNombre: opciones.receptorNombre,
      receptorDocumento: opciones.receptorDocumento ?? null,
      entregadoAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deliveries.id, entrega.id));

  return { deliveryId: entrega.id, numero: entrega.numero };
}

/**
 * Anula un remito.
 *
 * No lo borra: el remito se emitió y alguien pudo haberlo visto. Se marca
 * anulado y la mercadería vuelve al stock con un movimiento de devolución, para
 * que el libro explique por qué el número subió.
 */
export async function anularEntrega(
  deliveryId: string,
  usuarioId?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [entrega] = await tx
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .limit(1);

    if (!entrega || entrega.estado === "anulada") return;

    await tx
      .update(deliveries)
      .set({ estado: "anulada", updatedAt: new Date() })
      .where(eq(deliveries.id, deliveryId));

    const lineas = await tx
      .select({
        orderItemId: deliveryItems.orderItemId,
        cantidad: deliveryItems.cantidad,
      })
      .from(deliveryItems)
      .where(eq(deliveryItems.deliveryId, deliveryId));

    if (!entrega.branchId || lineas.length === 0) return;

    const variantes = await tx
      .select({ id: orderItems.id, variantId: orderItems.variantId })
      .from(orderItems)
      .where(
        inArray(
          orderItems.id,
          lineas.map((l) => l.orderItemId),
        ),
      );

    const porItem = new Map(variantes.map((v) => [v.id, v.variantId]));

    const { devolverAlStock } = await import("@/lib/inventario/reservas");

    await devolverAlStock(tx, {
      branchId: entrega.branchId,
      numeroRemito: entrega.numero,
      usuarioId,
      lineas: lineas
        .map((l) => ({
          variantId: porItem.get(l.orderItemId) ?? null,
          cantidad: Math.ceil(Number(l.cantidad)),
        }))
        .filter((l): l is { variantId: string; cantidad: number } =>
          Boolean(l.variantId),
        ),
    });
  });
}
