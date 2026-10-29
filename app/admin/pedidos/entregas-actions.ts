"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { notificarRemitoParaFirmar } from "@/lib/notificaciones/entregas";

export interface EstadoEntrega {
  error?: string;
  ok?: string;
  /** Link de firma del remito recién creado, para mostrarlo o mandarlo. */
  linkFirma?: string;
  numero?: string;
}

/**
 * Prepara un remito con lo que el cliente se lleva ahora.
 *
 * Lo hace Go (backend/internal/entregas): valida el formulario como el
 * esquema de siempre —en un retiro el documento es obligatorio: la firma sola
 * no identifica a nadie—, controla las cantidades contra lo que queda en
 * acopio y saca la mercadería del depósito, todo con el candado de la serie
 * de remitos.
 */
export async function prepararRemito(
  _previo: EstadoEntrega,
  formData: FormData,
): Promise<EstadoEntrega> {
  const orderId = String(formData.get("orderId") ?? "");

  // Las cantidades llegan como `cantidad-<orderItemId>`, una por renglón.
  const cantidades: { orderItemId: string; valor: string }[] = [];
  for (const [clave, valor] of formData.entries()) {
    if (clave.startsWith("cantidad-")) {
      cantidades.push({ orderItemId: clave.slice("cantidad-".length), valor: String(valor) });
    }
  }

  const r = await (await api()).POST("/api/v1/admin/remitos", {
    body: {
      orderId,
      tipo: String(formData.get("tipo") ?? "retiro"),
      receptorNombre: (formData.get("receptorNombre") as string) || undefined,
      receptorDocumento: (formData.get("receptorDocumento") as string) || undefined,
      transportista: (formData.get("transportista") as string) || undefined,
      numeroSeguimiento: (formData.get("numeroSeguimiento") as string) || undefined,
      notas: (formData.get("notas") as string) || undefined,
      cantidades,
    },
  });

  if (!r.data) {
    if (r.response.status >= 500) console.error(`prepararRemito: la API respondió ${r.response.status}`);
    return {
      error: r.response.status >= 500 ? "No pudimos preparar el remito." : mensajeDe(r.error as Problema | undefined),
    };
  }

  const entrega = r.data;
  revalidatePath(`/admin/pedidos/${orderId}`);
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/stock");

  after(async () => {
    await notificarRemitoParaFirmar(entrega.id);
  });

  return { ok: entrega.ok, numero: entrega.numero, linkFirma: `/firmar/${entrega.firmaToken}` };
}

/** Anula un remito y devuelve la mercadería al stock. */
export async function anularRemito(
  _previo: EstadoEntrega,
  formData: FormData,
): Promise<EstadoEntrega> {
  const deliveryId = String(formData.get("deliveryId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");

  if (!deliveryId) return { error: "Falta el remito." };

  const r = await (await api()).POST("/api/v1/admin/remitos/{id}/anular", { params: { path: { id: deliveryId } } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };

  revalidatePath(`/admin/pedidos/${orderId}`);
  revalidatePath("/admin/stock");

  return { ok: r.data.ok };
}
