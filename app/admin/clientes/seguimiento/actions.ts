"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * El seguimiento de cobranza y de venta. Lo guarda la API de Go
 * (backend/internal/clientes): cada movimiento suma una nota fechada a las
 * anteriores, y cerrar limpia la próxima acción.
 */

export interface EstadoGestion {
  error?: string;
  ok?: string;
}

function refrescar(customerId?: string) {
  revalidatePath("/admin/clientes/seguimiento");
  revalidatePath("/admin");
  if (customerId) revalidatePath(`/admin/clientes/${customerId}`);
}

export async function crearGestion(_previo: EstadoGestion, formData: FormData): Promise<EstadoGestion> {
  const customerId = (formData.get("customerId") as string | null) ?? "";
  const r = await (await api()).POST("/api/v1/admin/seguimiento", {
    body: {
      customerId,
      asunto: (formData.get("asunto") as string | null) ?? "",
      notas: (formData.get("notas") as string | null) || undefined,
      proximaAccion: (formData.get("proximaAccion") as string | null) || undefined,
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  refrescar(customerId);
  return { ok: r.data.ok };
}

export async function moverGestion(
  id: string,
  etapa: "pendiente" | "hablando" | "promesa" | "cerrado",
  nota?: string,
  proximaAccion?: string,
): Promise<EstadoGestion> {
  const r = await (await api()).PUT("/api/v1/admin/seguimiento/{id}", {
    params: { path: { id } },
    body: { etapa, nota, proximaAccion },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo mover el seguimiento.") };
  refrescar(r.data.customerId);
  return { ok: r.data.ok };
}
