import "server-only";

import { obtenerComprobante, configuracionFiscalActual } from "@/lib/dal/admin/facturacion";
import { comprobantePdf } from "@/lib/pdf/comprobante";
import { numeroFormateado } from "@/lib/fiscal/comprobantes";
import { notificarFacturaEmitida } from "./avisos";

/**
 * Le manda al cliente su comprobante en PDF (cláusula 1.6).
 *
 * Sale dos veces cuando ARCA está conectado: al emitir, con el aviso de que
 * todavía no está autorizado, y al recibir el CAE con el definitivo. Parece
 * redundante y no lo es: entre las dos cosas pueden pasar horas si el
 * webservice de ARCA está caído, y el cliente que compró necesita su
 * comprobante ahora, aunque sea provisorio. La plantilla dice con todas las
 * letras cuál es cuál.
 *
 * Como todos los avisos, no lanza: emitir un comprobante no puede fallar porque
 * el correo no salió.
 */
export async function enviarComprobantePorCorreo(
  invoiceId: string,
): Promise<void> {
  try {
    const [comprobante, emisor] = await Promise.all([
      obtenerComprobante(invoiceId),
      configuracionFiscalActual(),
    ]);

    if (!comprobante) return;

    const pdf = await comprobantePdf(comprobante, emisor);
    const nombre = `${comprobante.tipo.toUpperCase()}-${numeroFormateado(
      comprobante.puntoVenta,
      comprobante.numero,
    ).replace(/\s/g, "")}.pdf`;

    await notificarFacturaEmitida(invoiceId, {
      nombre,
      contenido: pdf,
      tipo: "application/pdf",
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "notificaciones.fiscal",
        invoiceId,
        error: error instanceof Error ? error.message : "desconocido",
      }),
    );
  }
}
