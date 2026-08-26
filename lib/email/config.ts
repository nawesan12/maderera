import "server-only";

/**
 * Configuración del correo saliente.
 *
 * Variables (`.env.local`):
 *   RESEND_API_KEY     clave de la cuenta de Resend
 *   EMAIL_REMITENTE    "Maderera Juan B. Justo <pedidos@mjbj.ar>"
 *   EMAIL_RESPUESTAS   a dónde contestan los clientes, si difiere del remitente
 *   EMAIL_PROVIDER=demo  fuerza el proveedor de demostración
 *
 * El dominio del remitente tiene que estar verificado en Resend (SPF y DKIM).
 * Mandar desde un dominio sin verificar hace que el correo salga y termine en
 * spam, que es peor que no mandarlo: nadie se entera de que falló.
 */

export interface ConfigEmail {
  apiKey: string;
  remitente: string;
  responderA: string | null;
}

const REMITENTE_POR_DEFECTO = "Maderera Juan B. Justo <pedidos@mjbj.ar>";

export function configEmail(): ConfigEmail | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  return {
    apiKey,
    remitente: process.env.EMAIL_REMITENTE ?? REMITENTE_POR_DEFECTO,
    responderA: process.env.EMAIL_RESPUESTAS ?? null,
  };
}

export function hayEmail(): boolean {
  return configEmail() !== null;
}

export function remitenteVisible(): string {
  return process.env.EMAIL_REMITENTE ?? REMITENTE_POR_DEFECTO;
}
