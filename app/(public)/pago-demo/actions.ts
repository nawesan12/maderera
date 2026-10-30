"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { apiPublica } from "@/lib/api/servidor";

/**
 * Simulación del resultado de un pago.
 *
 * Go (backend/internal/pagos) arma el mismo aviso que mandaría Mercado Pago y
 * lo pasa por el mismo procesamiento: si la acreditación tiene un error, este
 * botón lo reproduce. Solo sobre cobros del proveedor `demo`. Si se acreditó,
 * el aviso al cliente queda encolado y lo manda el worker de Go.
 */
export async function simularResultado(formData: FormData): Promise<void> {
  const pagoId = String(formData.get("pagoId") ?? "").slice(0, 64);
  const decision = String(formData.get("decision") ?? "");

  const r = await apiPublica.POST("/api/v1/pagos/demo/{id}", {
    params: { path: { id: pagoId || "-" } },
    body: { decision },
  });
  if (!r.data) redirect("/");

  const { volverA, estado } = r.data;

  revalidatePath(volverA);
  revalidatePath("/admin/pagos");
  // El de un pedido ya trae `?t=<token>`: el TS le pegaba otro `?` y el token
  // quedaba roto («abc?pago=aprobado»), así que quien compró sin cuenta
  // volvía de pagar a una página de «no encontrado».
  redirect(`${volverA}${volverA.includes("?") ? "&" : "?"}pago=${estado}`);
}
