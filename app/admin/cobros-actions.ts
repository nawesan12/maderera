"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Los cobros a un cliente desde el panel. Los hace la API de Go
 * (backend/internal/cobros): EmitirRecibo es la única puerta para la plata de
 * un cliente; los cheques entran a la cartera, el efectivo a la caja abierta,
 * y el aviso al cliente (correo y WhatsApp con el PDF) se encola en la misma
 * transacción.
 */

export interface EstadoCobro {
  ok?: string;
  error?: string;
  receiptId?: string;
  /** Algo que hay que decir aunque el cobro salió bien: la caja cerrada. */
  aviso?: string;
}

const campo = (formData: FormData, nombre: string) => (formData.get(nombre) as string | null) || undefined;

/**
 * Registra lo que pagó un cliente y emite el recibo. Con `orderId` es el cobro
 * de un pedido a cuenta corriente: si alcanza a cubrirlo, el pedido queda
 * cobrado.
 */
export async function registrarCobroDeCliente(_previo: EstadoCobro, formData: FormData): Promise<EstadoCobro> {
  const customerId = campo(formData, "customerId");
  if (!customerId) return { error: "Falta el cliente." };
  const r = await (await api()).POST("/api/v1/admin/clientes/{id}/cobros", {
    params: { path: { id: customerId } },
    body: {
      partes: (formData.get("partes") as string | null) ?? "",
      orderId: campo(formData, "orderId"),
      concepto: campo(formData, "concepto"),
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/cheques");
  return { ok: r.data.ok, aviso: r.data.aviso, receiptId: r.data.receiptId };
}

/** Anula un recibo, con motivo (solo el admin): la deuda vuelve a la cuenta. */
export async function anularReciboDesdeElPanel(receiptId: string, motivo: string): Promise<EstadoCobro> {
  if (!motivo.trim()) return { error: "Poné el motivo de la anulación." };
  const r = await (await api()).POST("/api/v1/admin/recibos/{id}/anular", {
    params: { path: { id: receiptId } },
    body: { motivo },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/cheques");
  return { ok: r.data.ok };
}
