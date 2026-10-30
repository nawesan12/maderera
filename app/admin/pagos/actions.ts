"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

export interface EstadoAccionPago {
  error?: string;
  ok?: string;
}

/*
 * La conciliación la hace Go (backend/internal/pagos, tanda 6), con el
 * permiso de la pantalla (/admin/pagos), la bitácora y el mismo `acreditar`
 * que el webhook. Si algo se acreditó, Go deja encolado el aviso al cliente
 * (pago.resultado) y su worker lo manda en el acto.
 */

/** Conciliación de una transferencia: la decide una persona y queda firmada. */
export async function conciliarTransferencia(
  _previo: EstadoAccionPago,
  formData: FormData,
): Promise<EstadoAccionPago> {
  const pagoId = String(formData.get("pagoId") ?? "").slice(0, 64);
  const r = await (await api()).POST("/api/v1/admin/pagos/{id}/conciliar", {
    params: { path: { id: pagoId || "-" } },
    body: {
      decision: String(formData.get("decision") ?? ""),
      motivo: (formData.get("motivo") as string) || null,
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No pudimos registrar la decisión.") };
  revalidatePath("/admin/pagos");
  revalidatePath("/admin/pedidos");
  return { ok: r.data.ok };
}

/** Le vuelve a preguntar a Mercado Pago el estado de un cobro. */
export async function reconsultarCobro(
  _previo: EstadoAccionPago,
  formData: FormData,
): Promise<EstadoAccionPago> {
  const pagoId = String(formData.get("pagoId") ?? "").slice(0, 64);
  const r = await (await api()).POST("/api/v1/admin/pagos/{id}/reconsultar", {
    params: { path: { id: pagoId || "-" } },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo consultar.") };
  revalidatePath("/admin/pagos");
  revalidatePath("/admin/pedidos");
  return { ok: r.data.ok };
}

/** Datos bancarios que ve quien va a transferir. Una sola fila, editable. */
export async function guardarDatosBancarios(
  _previo: EstadoAccionPago,
  formData: FormData,
): Promise<EstadoAccionPago> {
  const r = await (await api()).PUT("/api/v1/admin/pagos/datos-bancarios", {
    body: {
      banco: formData.get("banco") ?? "",
      titular: formData.get("titular") ?? "",
      cuit: formData.get("cuit") ?? "",
      cbu: String(formData.get("cbu") ?? "").replace(/\s/g, ""),
      alias: formData.get("alias") ?? "",
      instrucciones: (formData.get("instrucciones") as string) || undefined,
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  revalidatePath("/admin/pagos");
  revalidatePath("/carrito/confirmar");
  return { ok: r.data.ok };
}
