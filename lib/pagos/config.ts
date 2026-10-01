import "server-only";

/**
 * Credenciales de Mercado Pago.
 *
 * Igual que con WhatsApp y con ARCA, viven solo en variables de entorno y este
 * módulo es el único que las lee. Un access token de producción de Mercado Pago
 * permite mover plata de la cuenta del cliente: no puede estar en el repo ni
 * llegar nunca al navegador.
 *
 * Variables (`.env.local`):
 *   MP_ACCESS_TOKEN     token privado de la aplicación (APP_USR-… en producción)
 *   MP_WEBHOOK_SECRET   clave secreta del webhook, se copia del panel de MP
 *   MP_PUBLIC_KEY       clave pública, informativa
 *   PAGOS_PROVIDER=demo fuerza el proveedor de demostración
 *   APP_URL             base pública del sitio, para armar retornos y webhook
 */

export interface ConfigMercadoPago {
  accessToken: string;
  webhookSecret: string | null;
  publicKey: string | null;
  /** En producción el token arranca con APP_USR; el de prueba con TEST. */
  esProduccion: boolean;
}

export function configMercadoPago(): ConfigMercadoPago | null {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) return null;

  return {
    accessToken,
    webhookSecret: process.env.MP_WEBHOOK_SECRET ?? null,
    publicKey: process.env.MP_PUBLIC_KEY ?? null,
    esProduccion: !accessToken.startsWith("TEST-"),
  };
}

export function hayMercadoPago(): boolean {
  return configMercadoPago() !== null;
}

/**
 * Base pública del sitio.
 *
 * Mercado Pago necesita URLs absolutas y alcanzables desde afuera, así que esto
 * no puede salir de la request: en desarrollo la request dice `localhost`, que
 * para Mercado Pago no existe.
 *
 * Las URLs de Vercel son un respaldo que solo existe en la plataforma. En un
 * servidor propio no hay de dónde adivinar el dominio, y por eso ahí `APP_URL`
 * es obligatoria: si falta, el servidor no arranca (ver `lib/entorno.ts`) en
 * vez de caer al `localhost` de abajo y mandar a Mercado Pago a ninguna parte.
 */
export function urlBase(): string {
  const explicita = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicita) return explicita.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

export function urlWebhookPagos(): string {
  return `${urlBase()}/api/pagos/webhook`;
}
