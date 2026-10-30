"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, comoFormulario, mensajeDe, soloCampos, type Problema } from "@/lib/api/servidor";

/**
 * Acciones de cobro del lado del cliente. Las hace Go (backend/internal/pagos,
 * tanda 6): el importe sale de la base, el token del pedido (o el dueño con
 * sesión) es lo que autoriza, y los comprobantes y cheques quedan en revisión
 * con el freno de siempre. Acá queda qué se vuelve a dibujar.
 */

export interface EstadoPago {
  error?: string;
  ok?: string;
}

/** Abre el checkout de un pedido y manda a la persona a pagar. */
export async function pagarPedido(_previo: EstadoPago, formData: FormData): Promise<EstadoPago> {
  const numero = String(formData.get("numero") ?? "");
  const token = String(formData.get("token") ?? "") || undefined;
  if (!numero) return { error: "Falta el número de pedido." };

  const r = await (await api()).POST("/api/v1/pagos/pedido", {
    body: { numero: numero.slice(0, 40), token: token?.slice(0, 64) },
  });
  if (!r.data) {
    return {
      error: mensajeDe(
        r.error as Problema | undefined,
        "No pudimos abrir el pago. Probá de nuevo en un momento o escribinos por WhatsApp.",
      ),
    };
  }
  redirect(r.data.urlPago);
}

/**
 * El pago online de la deuda, apagado (de la clienta, 30/9/2026): la cuenta
 * corriente se paga con transferencia, depósito o cheque.
 */
export async function pagarDeuda(): Promise<EstadoPago> {
  return {
    error: "La cuenta corriente se paga con transferencia, depósito o cheque.",
  };
}

/** Sube el comprobante de una transferencia de un pedido: queda en revisión. */
export async function subirComprobante(_previo: EstadoPago, formData: FormData): Promise<EstadoPago> {
  const numero = String(formData.get("numero") ?? "");
  const r = await (await api()).POST("/api/v1/pagos/comprobante", {
    body: soloCampos(formData) as never,
    ...comoFormulario,
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No pudimos guardar el comprobante.") };
  revalidatePath(`/pedido/${numero}`);
  revalidatePath("/admin/pagos");
  return { ok: r.data.ok };
}

/** Igual que la anterior, pero para la deuda de cuenta corriente. */
export async function subirComprobanteDeDeuda(_previo: EstadoPago, formData: FormData): Promise<EstadoPago> {
  const r = await (await api()).POST("/api/v1/pagos/comprobante-deuda", {
    body: soloCampos(formData) as never,
    ...comoFormulario,
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No pudimos guardar el comprobante.") };
  revalidatePath("/mi-cuenta/cuenta-corriente");
  revalidatePath("/mi-cuenta/movimientos");
  revalidatePath("/admin/pagos");
  return { ok: r.data.ok };
}

/**
 * El cliente informa los cheques con los que paga su cuenta. Nacen
 * «informados» y no mueven la cuenta hasta que alguien de la casa los acepta.
 */
export async function informarChequesDeDeuda(_previo: EstadoPago, formData: FormData): Promise<EstadoPago> {
  const partes = formData.get("partes");
  const r = await (await api()).POST("/api/v1/pagos/cheques", {
    body: { partes: typeof partes === "string" ? partes : null },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los cheques.") };
  revalidatePath("/mi-cuenta/cuenta-corriente");
  revalidatePath("/mi-cuenta/movimientos");
  revalidatePath("/admin/cheques");
  return { ok: r.data.ok };
}
