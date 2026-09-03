"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  accountMovements,
  orderItems,
  orderStatusHistory,
  orders,
  quoteItems,
  quotes,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { siguienteNumeroDePedido } from "@/lib/dal/numeracion-ventas";
import { avisarCambioDePedido } from "@/lib/whatsapp/avisos";
import { notificarCambioDeEstado } from "@/lib/notificaciones/avisos";
import { liberarReservas, reservarPedido } from "@/lib/inventario/reservas";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";

export interface EstadoVenta {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/presupuestos");
  revalidatePath("/admin/clientes");
}

/* -------------------------------------------------------------------------- */
/* Estados                                                                     */
/* -------------------------------------------------------------------------- */

const ORDEN_PEDIDO = [
  "pendiente",
  "preparando",
  "listo",
  "en-camino",
  "entregado",
] as const;

/**
 * Avanza el pedido al siguiente estado.
 *
 * El recorrido es fijo y de una sola dirección: un pedido no vuelve de
 * "entregado" a "preparando". Para deshacer algo hay que cancelar y rehacer, que
 * deja rastro; permitir retroceder en silencio esconde los errores.
 *
 * Un pedido con envío salta de "listo" a "en camino"; uno de retiro pasa
 * directo a "entregado" cuando el cliente lo busca.
 */
export async function avanzarPedido(id: string): Promise<EstadoVenta> {
  const usuario = await requireStaff();

  const [pedido] = await db
    .select({
      estado: orders.estado,
      tipoEntrega: orders.tipoEntrega,
      numero: orders.numero,
    })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  if (!pedido) return { error: "No se encontró el pedido." };
  if (pedido.estado === "entregado") {
    return { error: "El pedido ya está entregado." };
  }
  if (pedido.estado === "cancelado") {
    return { error: "El pedido está cancelado." };
  }

  const posicion = ORDEN_PEDIDO.indexOf(pedido.estado as never);
  let siguiente = ORDEN_PEDIDO[posicion + 1];

  if (pedido.estado === "listo" && pedido.tipoEntrega === "retiro") {
    siguiente = "entregado";
  }

  if (!siguiente) return { error: "No hay un estado siguiente." };

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ estado: siguiente, updatedAt: new Date() })
      .where(eq(orders.id, id));

    await tx.insert(orderStatusHistory).values({
      orderId: id,
      estado: siguiente,
      createdByUserId: usuario.userId,
    });
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "pedido",
    entidadId: id,
    descripcion: `${pedido.numero}: ${pedido.estado} → ${siguiente}`,
  });

  refrescar();

  // Los avisos al cliente salen después de que el cambio quedó guardado, y por
  // fuera de la transacción: si WhatsApp o el correo no responden, el pedido
  // igual avanzó. `after()` además los saca del camino de la respuesta, para
  // que el tablero no espere a un tercero para actualizarse.
  //
  // Los dos canales van en paralelo y con `allSettled`: que falle uno no puede
  // impedir que salga el otro.
  after(async () => {
    await Promise.allSettled([
      avisarCambioDePedido(id, siguiente),
      notificarCambioDeEstado(id, siguiente),
    ]);
  });

  const TEXTO: Record<string, string> = {
    preparando: "en preparación",
    listo: "listo para retirar",
    "en-camino": "en camino",
    entregado: "entregado",
  };

  return { ok: `${pedido.numero} quedó ${TEXTO[siguiente] ?? siguiente}.` };
}

export async function cancelarPedido(
  id: string,
  motivo?: string,
): Promise<EstadoVenta> {
  const usuario = await requireStaff();

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ estado: "cancelado", updatedAt: new Date() })
      .where(eq(orders.id, id));

    await tx.insert(orderStatusHistory).values({
      orderId: id,
      estado: "cancelado",
      nota: motivo,
      createdByUserId: usuario.userId,
    });

    // La mercadería vuelve a estar disponible. El físico no se toca: nunca
    // salió del galpón.
    await liberarReservas(tx, id);
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "anular",
    entidad: "pedido",
    entidadId: id,
    descripcion: `Canceló el pedido${motivo ? `: ${motivo}` : ""}`,
  });

  refrescar();
  revalidatePath("/admin/stock");
  return { ok: "Pedido cancelado. La mercadería reservada quedó disponible." };
}

const estadoPresupuestoSchema = z.enum([
  "pendiente",
  "revision",
  "enviado",
  "aceptado",
  "rechazado",
  "vencido",
]);

export async function cambiarEstadoPresupuesto(
  id: string,
  estado: string,
): Promise<EstadoVenta> {
  const usuario = await requireStaff();

  const parsed = estadoPresupuestoSchema.safeParse(estado);
  if (!parsed.success) return { error: "Ese estado no existe." };

  await db
    .update(quotes)
    .set({ estado: parsed.data, updatedAt: new Date() })
    .where(eq(quotes.id, id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "presupuesto",
    entidadId: id,
    descripcion: `Pasó el presupuesto a ${parsed.data}`,
  });

  refrescar();
  return { ok: "Presupuesto actualizado." };
}

/* -------------------------------------------------------------------------- */
/* Presupuesto a pedido                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Convierte un presupuesto aceptado en pedido.
 *
 * Copia las líneas con el precio que tenían: el cliente aceptó ese número, y si
 * el precio de lista subió en el medio, el pedido tiene que respetar lo pactado.
 */
export async function convertirEnPedido(quoteId: string): Promise<EstadoVenta> {
  const usuario = await requireStaff();

  const [presupuesto] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);

  if (!presupuesto) return { error: "No se encontró el presupuesto." };

  const [yaExiste] = await db
    .select({ numero: orders.numero })
    .from(orders)
    .where(eq(orders.quoteId, quoteId))
    .limit(1);

  if (yaExiste) {
    return { error: `Ya se convirtió en el pedido ${yaExiste.numero}.` };
  }

  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId));

  if (items.length === 0) {
    return { error: "El presupuesto no tiene ítems." };
  }

  // Se asigna adentro de la transacción y se usa afuera, en el mensaje.
  let numero = "";

  await db.transaction(async (tx) => {
    // Adentro de la transacción, que es donde el lock de la serie protege algo.
    numero = await siguienteNumeroDePedido(tx);

    const [pedido] = await tx
      .insert(orders)
      .values({
        numero,
        customerId: presupuesto.customerId,
        quoteId: presupuesto.id,
        contactoNombre: presupuesto.contactoNombre,
        contactoEmail: presupuesto.contactoEmail,
        contactoTelefono: presupuesto.contactoTelefono,
        branchId: presupuesto.branchId,
        estado: "pendiente",
        origen: "presupuesto",
        subtotal: presupuesto.subtotal,
        total: presupuesto.total,
        notas: presupuesto.notas,
        createdByUserId: usuario.userId,
      })
      .returning();

    await tx.insert(orderItems).values(
      items.map((item) => ({
        orderId: pedido.id,
        variantId: item.variantId,
        descripcion: item.descripcion,
        unidad: item.unidad,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        subtotal: item.subtotal,
        orden: item.orden,
      })),
    );

    await tx.insert(orderStatusHistory).values({
      orderId: pedido.id,
      estado: "pendiente",
      nota: `Generado desde el presupuesto ${presupuesto.numero}`,
      createdByUserId: usuario.userId,
    });

    await tx
      .update(quotes)
      .set({ estado: "aceptado", updatedAt: new Date() })
      .where(eq(quotes.id, quoteId));

    // Desde acá la mercadería tiene dueño y deja de estar disponible para el
    // resto, aunque siga en el galpón hasta que la retiren.
    await reservarPedido(tx, pedido.id);
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "pedido",
    entidadId: quoteId,
    descripcion: `Convirtió el presupuesto ${presupuesto.numero} en el pedido ${numero}`,
  });

  refrescar();
  revalidatePath("/admin/stock");
  return { ok: `Se creó el pedido ${numero}.` };
}

/* -------------------------------------------------------------------------- */
/* Cobro                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Marca un pedido como cobrado.
 *
 * Si el pedido era a cuenta corriente, además baja la deuda del cliente: cobrar
 * en un lado y no en el otro es cómo se desincroniza una cuenta.
 */
export async function marcarPagado(id: string): Promise<EstadoVenta> {
  const usuario = await requireStaff();

  const [pedido] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  if (!pedido) return { error: "No se encontró el pedido." };
  if (pedido.estadoPago === "pagado") return { error: "Ya figura como pagado." };

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ estadoPago: "pagado", updatedAt: new Date() })
      .where(eq(orders.id, id));

    if (pedido.medioPago === "cuenta_corriente" && pedido.customerId) {
      await tx.insert(accountMovements).values({
        customerId: pedido.customerId,
        tipo: "pago",
        monto: (-Number(pedido.total)).toFixed(2),
        detalle: `Cobro del pedido ${pedido.numero}`,
        referencia: pedido.numero,
        createdByUserId: usuario.userId,
      });
    }
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cobrar",
    entidad: "pedido",
    entidadId: id,
    descripcion: `Marcó ${pedido.numero} como cobrado (${pedido.medioPago ?? "sin medio"})`,
    detalle: { total: pedido.total, medioPago: pedido.medioPago },
  });

  refrescar();
  return { ok: `${pedido.numero} quedó cobrado.` };
}
