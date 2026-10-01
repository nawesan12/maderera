"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { requireStaff, requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { ErrorDeCobro, anularRecibo, emitirRecibo } from "@/lib/cobros/recibo";
import { leerPartes } from "@/lib/cobros/leer";
import { notificarRecibo } from "@/lib/notificaciones/cobros";

export interface EstadoCobro {
  ok?: string;
  error?: string;
  receiptId?: string;
  /** Algo que hay que decir aunque el cobro salió bien: la caja cerrada. */
  aviso?: string;
}

/**
 * Registra lo que pagó un cliente y emite el recibo.
 *
 * Reemplaza al «Pago recibido» del movimiento manual de la ficha, que bajaba
 * la deuda con un importe y un texto y no dejaba ningún papel. Ahora se dice
 * con qué pagó —cada cheque con su banco y número—, los cheques entran a la
 * cartera y el cliente recibe su recibo por correo.
 *
 * Con `orderId` es el cobro de un pedido a cuenta corriente: el recibo nombra
 * el pedido, y si alcanza a cubrirlo el pedido queda cobrado.
 */
export async function registrarCobroDeCliente(
  _previo: EstadoCobro,
  formData: FormData,
): Promise<EstadoCobro> {
  const usuario = await requireStaff();

  const ids = z
    .object({
      customerId: z.string().uuid(),
      orderId: z.string().uuid().optional(),
      concepto: z.string().trim().max(200).optional(),
    })
    .safeParse({
      customerId: formData.get("customerId"),
      orderId: (formData.get("orderId") as string) || undefined,
      concepto: (formData.get("concepto") as string) || undefined,
    });
  if (!ids.success) return { error: "Falta el cliente." };

  const leidas = leerPartes(formData.get("partes"));
  if ("error" in leidas) return { error: leidas.error };

  let resultado: { receiptId: string; numero: string; total: number; aviso: string | null; pedido: string | null };
  try {
    resultado = await db.transaction(async (tx) => {
      const pedido = ids.data.orderId
        ? (
            await tx
              .select({
                id: orders.id,
                numero: orders.numero,
                total: orders.total,
                customerId: orders.customerId,
                branchId: orders.branchId,
              })
              .from(orders)
              .where(eq(orders.id, ids.data.orderId))
              .limit(1)
          )[0]
        : undefined;

      if (ids.data.orderId && (!pedido || pedido.customerId !== ids.data.customerId)) {
        throw new ErrorDeCobro("El pedido no es de este cliente.");
      }

      const recibo = await emitirRecibo(tx, {
        customerId: ids.data.customerId,
        branchId: pedido?.branchId ?? null,
        origen: "panel",
        concepto: pedido
          ? `Cobro del pedido ${pedido.numero}`
          : (ids.data.concepto ?? "Pago a cuenta"),
        partes: leidas.partes,
        caja: "buscar",
        usuarioId: usuario.userId,
      });

      // Un pedido queda cobrado cuando el recibo lo cubre entero. Un pago
      // parcial baja la deuda igual, pero el pedido sigue pendiente.
      if (pedido && recibo.total + 0.005 >= Number(pedido.total)) {
        await tx
          .update(orders)
          .set({ estadoPago: "pagado", updatedAt: new Date() })
          .where(eq(orders.id, pedido.id));
      }

      return { ...recibo, pedido: pedido?.numero ?? null };
    });
  } catch (error) {
    if (error instanceof ErrorDeCobro) return { error: error.message };
    throw error;
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cobrar",
    entidad: "cliente",
    entidadId: ids.data.customerId,
    descripcion: `Emitió el recibo ${resultado.numero} por ${resultado.total.toFixed(2)}${resultado.pedido ? ` (pedido ${resultado.pedido})` : ""}`,
    detalle: { receiptId: resultado.receiptId },
  });

  after(() => notificarRecibo(resultado.receiptId));

  revalidatePath("/admin/clientes");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/cheques");

  return {
    ok: `Recibo ${resultado.numero} emitido.`,
    aviso: resultado.aviso ?? undefined,
    receiptId: resultado.receiptId,
  };
}

/**
 * Anula un recibo, con motivo.
 *
 * Solo el admin: deshacer un cobro es plata que vuelve a deberse, y un recibo
 * es un papel que el cliente ya tiene en la mano.
 */
export async function anularReciboDesdeElPanel(
  receiptId: string,
  motivo: string,
): Promise<EstadoCobro> {
  const usuario = await requireStaffRole("admin");

  const limpio = motivo.trim().slice(0, 300);
  if (!limpio) return { error: "Poné el motivo de la anulación." };

  let anulado: { numero: string; customerId: string | null };
  try {
    anulado = await db.transaction((tx) =>
      anularRecibo(tx, { receiptId, motivo: limpio, usuarioId: usuario.userId }),
    );
  } catch (error) {
    if (error instanceof ErrorDeCobro) return { error: error.message };
    throw error;
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: "anular",
    entidad: "recibo",
    entidadId: receiptId,
    descripcion: `Anuló el recibo ${anulado.numero}: ${limpio}`,
  });

  revalidatePath("/admin/clientes");
  revalidatePath("/admin/cheques");
  return { ok: `Recibo ${anulado.numero} anulado. La deuda volvió a la cuenta.` };
}
