"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/dal/session";
import {
  anularEntrega,
  crearEntrega,
  ErrorDeEntrega,
} from "@/lib/entregas";
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
 * Las cantidades vienen del formulario pero no mandan: `crearEntrega` las
 * verifica contra lo que queda pendiente antes de tocar nada. Entregar más de
 * lo pedido dejaría el acopio en negativo y el stock descontado de más.
 */
export async function prepararRemito(
  _previo: EstadoEntrega,
  formData: FormData,
): Promise<EstadoEntrega> {
  const usuario = await requireStaff();

  const orderId = String(formData.get("orderId") ?? "");
  const tipo = String(formData.get("tipo") ?? "retiro");

  const parsed = z
    .object({
      orderId: z.string().uuid(),
      tipo: z.enum(["retiro", "envio"]),
      receptorNombre: z.string().trim().max(120).optional(),
      receptorDocumento: z.string().trim().max(30).optional(),
      transportista: z.string().trim().max(80).optional(),
      numeroSeguimiento: z.string().trim().max(60).optional(),
      notas: z.string().trim().max(400).optional(),
    })
    .safeParse({
      orderId,
      tipo,
      receptorNombre: (formData.get("receptorNombre") as string) || undefined,
      receptorDocumento:
        (formData.get("receptorDocumento") as string) || undefined,
      transportista: (formData.get("transportista") as string) || undefined,
      numeroSeguimiento:
        (formData.get("numeroSeguimiento") as string) || undefined,
      notas: (formData.get("notas") as string) || undefined,
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  // Las cantidades llegan como `cantidad-<orderItemId>`, una por renglón.
  const lineas: { orderItemId: string; cantidad: number }[] = [];

  for (const [clave, valor] of formData.entries()) {
    if (!clave.startsWith("cantidad-")) continue;

    const orderItemId = clave.slice("cantidad-".length);
    const cantidad = Number(String(valor).replace(",", "."));

    if (Number.isFinite(cantidad) && cantidad > 0) {
      lineas.push({ orderItemId, cantidad });
    }
  }

  try {
    const entrega = await crearEntrega({
      ...parsed.data,
      lineas,
      usuarioId: usuario.userId,
    });

    revalidatePath(`/admin/pedidos/${orderId}`);
    revalidatePath("/admin/pedidos");
    revalidatePath("/admin/stock");

    after(async () => {
      await notificarRemitoParaFirmar(entrega.id);
    });

    return {
      ok: entrega.pedidoCompleto
        ? `Remito ${entrega.numero} listo. Con esto el pedido queda entregado.`
        : `Remito ${entrega.numero} listo. Todavía queda mercadería en acopio.`,
      numero: entrega.numero,
      linkFirma: `/firmar/${entrega.firmaToken}`,
    };
  } catch (error) {
    if (error instanceof ErrorDeEntrega) return { error: error.message };
    console.error(error);
    return { error: "No pudimos preparar el remito." };
  }
}

/** Anula un remito y devuelve la mercadería al stock. */
export async function anularRemito(
  _previo: EstadoEntrega,
  formData: FormData,
): Promise<EstadoEntrega> {
  const usuario = await requireStaff();

  const deliveryId = String(formData.get("deliveryId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");

  if (!deliveryId) return { error: "Falta el remito." };

  await anularEntrega(deliveryId, usuario.userId);

  revalidatePath(`/admin/pedidos/${orderId}`);
  revalidatePath("/admin/stock");

  return { ok: "Remito anulado. La mercadería volvió al stock." };
}
