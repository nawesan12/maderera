"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cobroSimulado } from "@/lib/dal/pagos";
import { idSimulado } from "@/lib/pagos/proveedor-demo";
import { procesarAviso } from "@/lib/pagos/webhook";
import { notificarResultadoDePago } from "@/lib/notificaciones/avisos";

/**
 * Simulación del resultado de un pago.
 *
 * Arma el mismo aviso que mandaría Mercado Pago y lo mete por el mismo
 * `procesarAviso`. No hay un camino alternativo para la demo: si la
 * acreditación tiene un error, este botón lo reproduce.
 *
 * Solo funciona sobre cobros del proveedor `demo`; `cobroSimulado` ya filtra
 * por eso, así que este endpoint no puede aprobar un cobro real.
 */
export async function simularResultado(formData: FormData): Promise<void> {
  const pagoId = String(formData.get("pagoId") ?? "");
  const decision = String(formData.get("decision") ?? "");

  const pago = await cobroSimulado(pagoId);
  if (!pago) redirect("/");

  const estado = decision === "aprobar" ? "aprobado" : "rechazado";

  const resultado = await procesarAviso({
    proveedor: "demo",
    cuerpo: {
      id: `demo-evento-${pagoId}-${estado}`,
      type: "payment",
      data: { id: idSimulado(pagoId, estado) },
    },
    url: new URL("https://demo.local/api/pagos/webhook"),
    firmaVerificada: null,
  });

  if (resultado.resultado === "acreditado") {
    await notificarResultadoDePago({ ...resultado, detalle: "aprobado" });
  }

  revalidatePath(pago.volverA);
  revalidatePath("/admin/pagos");

  redirect(`${pago.volverA}?pago=${estado}`);
}
