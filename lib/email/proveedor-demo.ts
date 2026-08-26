import "server-only";

import type { MensajeEmail, ProveedorEmail, ResultadoEmail } from "./tipos";

/**
 * Proveedor de demostración.
 *
 * Arma el correo entero y no lo manda. Sirve para dos cosas: desarrollar sin
 * gastar envíos ni escribirle sin querer a un cliente real con datos de prueba,
 * y tener el módulo terminado antes de que el cliente decida qué casilla usa.
 *
 * Deja el asunto y el destinatario en la consola, y quien lo llama lo registra
 * en `notifications_log` con estado `simulada` —nunca `enviada`—, para que
 * nadie lea la bitácora y crea que el correo salió.
 */
export const proveedorDemoEmail: ProveedorEmail = {
  nombre: "demo",
  real: false,

  async enviar(mensaje: MensajeEmail): Promise<ResultadoEmail> {
    console.info(
      JSON.stringify({
        scope: "email.demo",
        para: mensaje.para,
        asunto: mensaje.asunto,
        adjuntos: mensaje.adjuntos?.map((a) => a.nombre) ?? [],
      }),
    );

    return { enviado: false, simulado: true };
  },
};
