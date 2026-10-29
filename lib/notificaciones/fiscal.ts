import "server-only";

import { apiInterna } from "@/lib/api/servidor";
import { notificarFacturaEmitida } from "./avisos";

/**
 * El comprobante en PDF tal como lo arma Go (backend/internal/facturacion),
 * pedido con el secreto interno: quien llama (el aviso al dueño, WhatsApp) ya
 * decidió que se puede mandar. Null si no existe.
 */
export async function pdfDelComprobante(invoiceId: string): Promise<{ nombre: string; contenido: Uint8Array } | null> {
  const r = await apiInterna.GET("/api/v1/comprobantes/{id}/pdf", {
    params: { path: { id: invoiceId } },
    parseAs: "arrayBuffer",
  });
  if (!r.response.ok || !r.data) return null;
  const disposicion = r.response.headers.get("Content-Disposition") ?? "";
  const nombre = /filename="([^"]+)"/.exec(disposicion)?.[1] ?? "comprobante.pdf";
  return { nombre, contenido: new Uint8Array(r.data as ArrayBuffer) };
}

/**
 * Le manda al cliente su comprobante en PDF (cláusula 1.6).
 *
 * Sale dos veces cuando ARCA está conectado: al emitir, con el aviso de que
 * todavía no está autorizado, y al recibir el CAE con el definitivo. Entre las
 * dos cosas pueden pasar horas si el webservice de ARCA está caído, y el
 * cliente que compró necesita su comprobante ahora, aunque sea provisorio. La
 * plantilla dice con todas las letras cuál es cuál.
 *
 * Lo encola Go (el trabajo `factura.aviso`, en la misma transacción que
 * emite) y lo atiende la cola de acá mientras los correos sigan en TS. Como
 * todos los avisos, no lanza: emitir no puede fallar porque el correo no salió.
 */
export async function enviarComprobantePorCorreo(invoiceId: string): Promise<void> {
  try {
    const pdf = await pdfDelComprobante(invoiceId);
    if (!pdf) return;
    await notificarFacturaEmitida(invoiceId, { nombre: pdf.nombre, contenido: pdf.contenido, tipo: "application/pdf" });
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
