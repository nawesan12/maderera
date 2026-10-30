"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { notificarPresupuestoRecibido } from "@/lib/notificaciones/presupuestos";

export interface EstadoPresupuesto {
  error?: string;
  ok?: string;
  numero?: string;
  /** Verdadero cuando entró por la cola express, para decirlo en pantalla. */
  express?: boolean;
}

/**
 * Convierte el presupuesto en curso en una cotización real, con número y los
 * precios del momento. **El carrito no se vacía**: pedir un presupuesto no es
 * comprar. Lo hace Go (backend/internal/checkout, tanda 6): el esquema, el
 * freno por IP y correo, la numeración y el plazo de respuesta (express de 24
 * horas para un profesional aprobado). El correo de «recibimos tu pedido»
 * sigue saliendo de acá.
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

  const { quoteId, ok, numero, express } = r.data;
  after(async () => {
    await notificarPresupuestoRecibido(quoteId);
  });
  revalidatePath("/admin/presupuestos");
  revalidatePath("/admin");
  return { ok, numero, express };
}
