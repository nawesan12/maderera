import "server-only";

import { remitoCompleto, remitoParaAvisar } from "@/lib/dal/admin/entregas";
import { urlBase } from "@/lib/pagos/config";
import { fechaHoraDeFirma } from "@/lib/entregas/fecha";
import * as plantillas from "@/lib/email/plantillas";
import { despacharEmail } from "./avisos";

/**
 * Avisos de entrega.
 *
 * Van en su propio módulo porque necesitan el remito armado y no solo un id de
 * pedido. Los datos los da la API de Go (backend/internal/entregas); el correo
 * sigue saliendo de acá. Como todos los avisos: no lanzan nunca, y el remito
 * se prepara igual aunque el correo no salga.
 */

/** Le manda al cliente el link para firmar desde el celular. */
export async function notificarRemitoParaFirmar(
  deliveryId: string,
): Promise<void> {
  try {
    const datos = await remitoParaAvisar(deliveryId);

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
    const [remito, pedido] = await Promise.all([remitoCompleto(deliveryId), remitoParaAvisar(deliveryId)]);
    if (!remito || !pedido) return;

    const email = pedido.email ?? pedido.emailCliente;

    if (!email) return;

    await despacharEmail({
      evento: "remito_firmado",
      para: email,
      entidadTipo: "delivery",
      entidadId: deliveryId,
      correo: plantillas.remitoFirmado({
        nombre: (pedido.nombre ?? remito.clienteNombre).split(" ")[0],
        remito: remito.numero,
        numero: remito.pedidoNumero,
        // En hora de Argentina: el servidor corre en UTC.
        fecha: fechaHoraDeFirma.format(remito.firmadoAt ?? new Date()),
        pendiente: pedido.estadoPedido !== "entregado",
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
