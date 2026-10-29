"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * La cartera de cheques: cargar uno a mano y moverlo de estado. Lo hace la
 * API de Go (backend/internal/cobros): aceptar uno informado emite el recibo,
 * y rechazar uno que ya contaba devuelve la deuda con una nota de débito y le
 * avisa al cliente.
 */

export interface EstadoCheque {
  error?: string;
  ok?: string;
  /** El recibo que se emitió al aceptar un cheque informado. */
  receiptId?: string;
}

const campo = (formData: FormData, nombre: string) => (formData.get(nombre) as string | null) ?? undefined;

export async function cargarCheque(_previo: EstadoCheque, formData: FormData): Promise<EstadoCheque> {
  const r = await (await api()).POST("/api/v1/admin/cheques", {
    body: {
      sentido: campo(formData, "sentido"),
      tipo: campo(formData, "tipo"),
      numero: campo(formData, "numero"),
      banco: campo(formData, "banco"),
      librador: campo(formData, "librador"),
      fechaPago: campo(formData, "fechaPago"),
      importe: campo(formData, "importe"),
      customerId: campo(formData, "customerId"),
      circuito: campo(formData, "circuito"),
      notas: campo(formData, "notas"),
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  revalidatePath("/admin/cheques");
  return { ok: r.data.ok };
}

export async function cambiarEstadoDeCheque(id: string, nuevoEstado: string, motivo?: string): Promise<EstadoCheque> {
  const r = await (await api()).PUT("/api/v1/admin/cheques/{id}/estado", {
    params: { path: { id } },
    body: { estado: nuevoEstado, motivo },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  revalidatePath("/admin/cheques");
  revalidatePath("/admin/clientes");
  return { ok: r.data.ok, receiptId: r.data.receiptId };
}
