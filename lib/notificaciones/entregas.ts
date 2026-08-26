import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, deliveries, orders } from "@/lib/db/schema";
import { remitoCompleto } from "@/lib/dal/admin/entregas";
import { urlBase } from "@/lib/pagos/config";
import { fechaHora } from "@/lib/formato";
import * as plantillas from "@/lib/email/plantillas";
import { despacharEmail } from "./avisos";

/**
 * Avisos de entrega.
 *
 * Van en su propio módulo porque necesitan el remito armado y no solo un id de
 * pedido. Como todos los avisos: no lanzan nunca, y el remito se prepara igual
 * aunque el correo no salga.
 */

/** Le manda al cliente el link para firmar desde el celular. */
export async function notificarRemitoParaFirmar(
  deliveryId: string,
): Promise<void> {
  try {
    const [datos] = await db
      .select({
        firmaToken: deliveries.firmaToken,
        numero: deliveries.numero,
        pedidoNumero: orders.numero,
        nombre: orders.contactoNombre,
        email: orders.contactoEmail,
      })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .where(eq(deliveries.id, deliveryId))
      .limit(1);

    if (!datos?.firmaToken || !datos.email) return;

    await despacharEmail({
      evento: "remito_para_firmar",
      para: datos.email,
      entidadTipo: "delivery",
      entidadId: deliveryId,
      correo: plantillas.pedidoParaFirmar({
        nombre: datos.nombre.split(" ")[0],
        numero: datos.pedidoNumero,
        remito: datos.numero,
        url: `${urlBase()}/firmar/${datos.firmaToken}`,
      }),
    });
  } catch {
    // El remito ya está preparado; el aviso es un extra.
  }
}

/** Constancia de lo que se retiró, con el saldo que queda en acopio. */
export async function notificarRemitoFirmado(
  deliveryId: string,
): Promise<void> {
  try {
    const remito = await remitoCompleto(deliveryId);
    if (!remito) return;

    const [pedido] = await db
      .select({
        email: orders.contactoEmail,
        nombre: orders.contactoNombre,
        estado: orders.estado,
      })
      .from(orders)
      .where(eq(orders.id, remito.pedidoId))
      .limit(1);

    const email =
      pedido?.email ??
      (remito.customerId
        ? (
            await db
              .select({ email: customers.email })
              .from(customers)
              .where(eq(customers.id, remito.customerId))
              .limit(1)
          )[0]?.email
        : null);

    if (!email) return;

    await despacharEmail({
      evento: "remito_firmado",
      para: email,
      entidadTipo: "delivery",
      entidadId: deliveryId,
      correo: plantillas.remitoFirmado({
        nombre: (pedido?.nombre ?? remito.clienteNombre).split(" ")[0],
        remito: remito.numero,
        numero: remito.pedidoNumero,
        fecha: fechaHora.format(remito.firmadoAt ?? new Date()),
        pendiente: pedido?.estado !== "entregado",
        lineas: remito.lineas.map((l) => ({
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          unidad: l.unidad,
          // Sin importe: el remito es constancia de entrega, no de venta.
          importe: null,
        })),
      }),
    });
  } catch {
    // La firma ya quedó guardada.
  }
}
