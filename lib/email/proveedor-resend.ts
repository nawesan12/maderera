import "server-only";

import { configEmail } from "./config";
import type { MensajeEmail, ProveedorEmail, ResultadoEmail } from "./tipos";

/**
 * Resend por HTTP.
 *
 * Un endpoint, un JSON. El SDK oficial no agrega nada que justifique la
 * dependencia, igual que con Mercado Pago y con ARCA.
 */

const API = "https://api.resend.com/emails";

export const proveedorResend: ProveedorEmail = {
  nombre: "resend",
  real: true,

  async enviar(mensaje: MensajeEmail): Promise<ResultadoEmail> {
    const config = configEmail();
    if (!config) {
      return { enviado: false, simulado: false, error: "Resend no está configurado." };
    }

    try {
      const respuesta = await fetch(API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.remitente,
          to: [mensaje.para],
          subject: mensaje.asunto,
          html: mensaje.html,
          text: mensaje.texto,
          reply_to: mensaje.responderA ?? config.responderA ?? undefined,
          attachments: mensaje.adjuntos?.map((a) => ({
            filename: a.nombre,
            content: Buffer.from(a.contenido).toString("base64"),
            content_type: a.tipo,
          })),
        }),
        cache: "no-store",
      });

      const texto = await respuesta.text();

      if (!respuesta.ok) {
        return {
          enviado: false,
          simulado: false,
          error: `Resend respondió ${respuesta.status}: ${texto.slice(0, 300)}`,
        };
      }

      const datos = texto ? (JSON.parse(texto) as { id?: string }) : {};
      return { enviado: true, simulado: false, id: datos.id };
    } catch (error) {
      return {
        enviado: false,
        simulado: false,
        error: error instanceof Error ? error.message : "Error de red.",
      };
    }
  },
};
