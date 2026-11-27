"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { vaciarCarrito } from "@/app/(public)/carrito-actions";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

export interface EstadoPresupuesto {
  error?: string;
  ok?: string;
  numero?: string;
  /** Verdadero cuando entró por la cola express, para decirlo en pantalla. */
  express?: boolean;
}

/**
 * Convierte el presupuesto en curso en una cotización real, con número y los
 * precios del momento. Después **el carrito se vacía**: seguía lleno con
 * «Continuar con el pedido» activo, y el mismo pedido salía dos veces (mes
 * simulado, M2S2-075). El presupuesto se acepta desde Mi cuenta. Lo hace Go (backend/internal/checkout, tanda 6): el esquema, el
 * freno por IP y correo, la numeración y el plazo de respuesta (express de 24
 * horas para un profesional aprobado) y el correo de «recibimos tu pedido»,
 * que encola en la misma transacción.
 */
export async function pedirPresupuesto(
  _previo: EstadoPresupuesto,
  formData: FormData,
): Promise<EstadoPresupuesto> {
  const r = await (await api()).POST("/api/v1/carrito/presupuesto", {
    body: {
      nombre: formData.get("nombre"),
      email: formData.get("email"),
      telefono: formData.get("telefono"),
      sucursalId: (formData.get("sucursalId") as string) || undefined,
      necesitaPara: (formData.get("necesitaPara") as string) || undefined,
      motivos: formData.getAll("motivos").map(String),
      notas: (formData.get("notas") as string) || undefined,
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };

  const { ok, numero, express } = r.data;
  revalidatePath("/admin/presupuestos");
  revalidatePath("/admin");
  const vaciado = await vaciarCarrito();
  if (vaciado.error) return { ok, numero, express };
  redirect(`/carrito?presupuesto=${encodeURIComponent(numero ?? "")}`);
}
