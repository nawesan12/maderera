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
 *
 * Anda igual con el correo de Hostinger (Business Email) en vez del servidor
 * propio: `SMTP_HOST=smtp.hostinger.com`, `SMTP_PUERTO=465` y la casilla.
 * Hostinger tampoco deja mandar a nombre de otra dirección, y `remitente()`
 * ya lo resuelve.
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
    // Solo para un nombre interno (`correo`, sin punto). Un servidor público
    // —`smtp.hostinger.com`— trae el certificado de su propio nombre, y
    // validarlo contra `mail.<dominio>`, que el compose pone por omisión,
    // haría fallar todos los envíos.
    nombreTls: host.includes(".") ? null : process.env.SMTP_NOMBRE_TLS?.trim() || null,
  };
}

/**
 * El «De» del correo: el nombre de `EMAIL_REMITENTE` con la dirección de la
 * casilla autenticada.
 *
 * El servidor de correo rechaza mandar a nombre de otra dirección (es lo que
 * impide que una cuenta robada suplante a `info@`), así que la dirección
 * visible **tiene** que ser la de la casilla. Tomarla de acá evita que un
 * `EMAIL_REMITENTE` mal escrito deje a todos los avisos rebotando.
 */
function remitente(usuario: string): string {
  const visible = remitenteVisible();
  const nombre = visible.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim();
  return nombre ? `"${nombre.replace(/"/g, "")}" <${usuario}>` : usuario;
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
        from: remitente(config.usuario),
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
      const e = error as { message?: string; responseCode?: number; code?: string };
      return {
        enviado: false,
        simulado: false,
        error: e.message ?? "Error de SMTP.",
        temporal:
          (typeof e.responseCode === "number" && e.responseCode >= 400 && e.responseCode < 500) ||
          ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET"].includes(e.code ?? ""),
      };
    }
  },
};
