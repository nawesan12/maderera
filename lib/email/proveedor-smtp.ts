import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { remitenteVisible } from "./config";
import type { MensajeEmail, ProveedorEmail, ResultadoEmail } from "./tipos";

/**
 * Envío por SMTP propio: el servidor de correo de la VPS (contenedor `correo`).
 *
 * La clienta pidió el correo en el servidor (1/10/2026): las casillas, los
 * avisos del sistema y las campañas, sin depender de un servicio externo.
 * Resend sigue como alternativa —se elige con `EMAIL_PROVIDER`— porque un
 * servidor de correo nuevo tarda en ganarse la confianza de Gmail, y si los
 * avisos empiezan a caer en spam, volver es cambiar una variable.
 *
 * La app se conecta al contenedor por la red interna (`SMTP_HOST=correo`),
 * pero el certificado es el público (`mail.<dominio>`): `SMTP_NOMBRE_TLS` le
 * dice contra qué nombre validarlo. Validarlo de verdad, y no apagar la
 * verificación: es la clave de la cuenta la que viaja.
 */
export interface ConfigSmtp {
  host: string;
  puerto: number;
  usuario: string;
  clave: string;
  nombreTls: string | null;
}

export function configSmtp(): ConfigSmtp | null {
  const host = process.env.SMTP_HOST?.trim();
  const usuario = process.env.SMTP_USUARIO?.trim();
  const clave = process.env.SMTP_CLAVE;
  if (!host || !usuario || !clave) return null;
  const puerto = Number.parseInt(process.env.SMTP_PUERTO ?? "587", 10);
  return {
    host,
    puerto: Number.isInteger(puerto) && puerto > 0 ? puerto : 587,
    usuario,
    clave,
    nombreTls: process.env.SMTP_NOMBRE_TLS?.trim() || null,
  };
}

const global = globalThis as unknown as { transporteSmtp?: Transporter };

/** Una sola conexión reutilizable por proceso: abrir una por correo es lento. */
function transporte(config: ConfigSmtp): Transporter {
  global.transporteSmtp ??= nodemailer.createTransport({
    host: config.host,
    port: config.puerto,
    // 465 es TLS desde el saludo; 587 arranca en claro y sube con STARTTLS,
    // que se exige: sin cifrar no se manda la clave.
    secure: config.puerto === 465,
    requireTLS: config.puerto !== 465,
    auth: { user: config.usuario, pass: config.clave },
    tls: config.nombreTls ? { servername: config.nombreTls } : undefined,
    pool: true,
    maxConnections: 2,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  return global.transporteSmtp;
}

export const proveedorSmtp: ProveedorEmail = {
  nombre: "smtp",
  real: true,

  async enviar(mensaje: MensajeEmail): Promise<ResultadoEmail> {
    const config = configSmtp();
    if (!config) {
      return { enviado: false, simulado: false, error: "Falta configurar el SMTP (SMTP_HOST, SMTP_USUARIO, SMTP_CLAVE)." };
    }

    try {
      const info = await transporte(config).sendMail({
        from: remitenteVisible(),
        // El sobre sale de la cuenta autenticada: si el «De» visible es otra
        // dirección del mismo dominio, el servidor igual lo firma con DKIM.
        envelope: { from: config.usuario, to: mensaje.para },
        to: mensaje.para,
        replyTo: mensaje.responderA ?? process.env.EMAIL_RESPUESTAS ?? undefined,
        subject: mensaje.asunto,
        html: mensaje.html,
        text: mensaje.texto,
        headers: mensaje.cabeceras,
        attachments: mensaje.adjuntos?.map((a) => ({
          filename: a.nombre,
          content: Buffer.from(a.contenido),
          contentType: a.tipo,
        })),
      });
      return { enviado: true, simulado: false, id: info.messageId };
    } catch (error) {
      return {
        enviado: false,
        simulado: false,
        error: error instanceof Error ? error.message : "Error de SMTP.",
      };
    }
  },
};
