"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion, miSaldo } from "@/lib/dal/cuenta";
import { guardarAdjunto } from "@/lib/almacenamiento";
import {
  ErrorDeCobro,
  iniciarPagoDeDeuda,
  iniciarPagoDePedido,
  registrarTransferencia,
} from "@/lib/pagos/crear";
import { parsearImporte } from "@/lib/formato";

/**
 * Acciones de cobro del lado del cliente.
 *
 * Nada de lo que llega del navegador decide cuánta plata se cobra: el importe
 * del pedido sale de la base, y el de la deuda se valida contra el saldo real
 * calculado en el DAL. Lo único que aporta el formulario es la intención.
 */

export interface EstadoPago {
  error?: string;
  ok?: string;
}

/** Abre el checkout de un pedido y manda a la persona a pagar. */
export async function pagarPedido(
  _previo: EstadoPago,
  formData: FormData,
): Promise<EstadoPago> {
  const numero = String(formData.get("numero") ?? "");
  if (!numero) return { error: "Falta el número de pedido." };

  const [pedido] = await db
    .select({ id: orders.id, estadoPago: orders.estadoPago })
    .from(orders)
    .where(eq(orders.numero, numero))
    .limit(1);

  if (!pedido) return { error: "No encontramos ese pedido." };
  if (pedido.estadoPago === "pagado") return { error: "Este pedido ya está pagado." };

  const sesion = await getSession();

  let destino: string;

  try {
    const cobro = await iniciarPagoDePedido(pedido.id, sesion?.userId);
    destino = cobro.urlPago;
  } catch (error) {
    if (error instanceof ErrorDeCobro) return { error: error.message };
    console.error(error);
    return {
      error:
        "No pudimos abrir el pago. Probá de nuevo en un momento o escribinos por WhatsApp.",
    };
  }

  redirect(destino);
}

/**
 * Pago de deuda de cuenta corriente (cláusula 1.6).
 *
 * El saldo se recalcula acá aunque la pantalla ya lo muestre: entre que se
 * cargó la página y se apretó el botón puede haber entrado una compra.
 */
export async function pagarDeuda(
  _previo: EstadoPago,
  formData: FormData,
): Promise<EstadoPago> {
  const cliente = await clienteDeLaSesion();
  if (!cliente) return { error: "Iniciá sesión para pagar tu cuenta." };

  const saldo = await miSaldo();
  const bruto = String(formData.get("monto") ?? "").trim();

  // `parsearImporte` mira la coma para decidir el formato. Escrito a mano
  // —quitando todos los puntos— convertía $528.300 en $52.830.000.
  const monto = bruto ? parsearImporte(bruto) : saldo;

  if (!Number.isFinite(monto) || monto <= 0) {
    return { error: "Ingresá un importe válido." };
  }

  const sesion = await getSession();
  let destino: string;

  try {
    const cobro = await iniciarPagoDeDeuda(
      cliente.id,
      monto,
      saldo,
      sesion?.userId,
    );
    destino = cobro.urlPago;
  } catch (error) {
    if (error instanceof ErrorDeCobro) return { error: error.message };
    console.error(error);
    return { error: "No pudimos abrir el pago. Probá de nuevo en un momento." };
  }

  redirect(destino);
}

const TIPOS_COMPROBANTE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/**
 * Sube el comprobante de una transferencia.
 *
 * Queda en revisión, nunca acreditado: una captura de pantalla no es plata en
 * la cuenta. La concilia alguien de la casa desde `/admin/pagos` mirando el
 * extracto, y recién ahí pasa por `acreditarPago`.
 */
export async function subirComprobante(
  _previo: EstadoPago,
  formData: FormData,
): Promise<EstadoPago> {
  const numero = String(formData.get("numero") ?? "");
  const archivo = formData.get("comprobante");

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: "Adjuntá el comprobante de la transferencia." };
  }

  if (!TIPOS_COMPROBANTE.has(archivo.type)) {
    return { error: "Subí una imagen o un PDF." };
  }

  const [pedido] = await db
    .select({
      id: orders.id,
      total: orders.total,
      customerId: orders.customerId,
      estadoPago: orders.estadoPago,
    })
    .from(orders)
    .where(eq(orders.numero, numero))
    .limit(1);

  if (!pedido) return { error: "No encontramos ese pedido." };
  if (pedido.estadoPago === "pagado") return { error: "Este pedido ya está pagado." };

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const guardado = await guardarAdjunto(bytes, archivo.type, "comprobante");

  if (!guardado.url) {
    return { error: guardado.error ?? "No pudimos guardar el comprobante." };
  }

  await registrarTransferencia({
    orderId: pedido.id,
    customerId: pedido.customerId,
    tipo: "pedido",
    monto: Number(pedido.total),
    comprobanteUrl: guardado.url,
  });

  await db
    .update(orders)
    .set({ estadoPago: "pendiente", updatedAt: new Date() })
    .where(eq(orders.id, pedido.id));

  revalidatePath(`/pedido/${numero}`);
  revalidatePath("/admin/pagos");

  return {
    ok: "Recibimos tu comprobante. Lo verificamos y te confirmamos el pago.",
  };
}

/** Igual que la anterior, pero para cancelar deuda de cuenta corriente. */
export async function subirComprobanteDeDeuda(
  _previo: EstadoPago,
  formData: FormData,
): Promise<EstadoPago> {
  const cliente = await clienteDeLaSesion();
  if (!cliente) return { error: "Iniciá sesión para informar un pago." };

  const archivo = formData.get("comprobante");

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: "Adjuntá el comprobante de la transferencia." };
  }

  if (!TIPOS_COMPROBANTE.has(archivo.type)) {
    return { error: "Subí una imagen o un PDF." };
  }

  const monto = parsearImporte(String(formData.get("monto") ?? ""));

  if (!Number.isFinite(monto) || monto <= 0) {
    return { error: "Ingresá el importe que transferiste." };
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const guardado = await guardarAdjunto(bytes, archivo.type, "comprobante");

  if (!guardado.url) {
    return { error: guardado.error ?? "No pudimos guardar el comprobante." };
  }

  await registrarTransferencia({
    customerId: cliente.id,
    tipo: "deuda",
    monto,
    comprobanteUrl: guardado.url,
  });

  revalidatePath("/mi-cuenta/cuenta-corriente");
  revalidatePath("/admin/pagos");

  return {
    ok: "Recibimos tu comprobante. Lo imputamos a tu cuenta al verificarlo.",
  };
}
