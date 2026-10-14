import "server-only";

import { aWaId, numeroLegible, soloDigitos, waIdDeJid } from "./numeros";

/**
 * Credenciales de la WhatsApp Cloud API.
 *
 * Viven solo en variables de entorno: un token de Meta con permiso para
 * escribirle a los clientes no puede estar en el repo ni llegar al navegador.
 * Este módulo es el único que las lee. Todas están explicadas en
 * `.env.example` y el trámite para conseguirlas, en `docs/WHATSAPP.md`.
 *
 *   WHATSAPP_PHONE_NUMBER_ID        id del número en Meta (no es el teléfono)
 *   WHATSAPP_ACCESS_TOKEN           token permanente del usuario del sistema
 *   WHATSAPP_BUSINESS_ACCOUNT_ID    WABA: plantillas, suscripción del webhook
 *   WHATSAPP_APP_SECRET             secreto de la app: valida la firma del webhook
 *   WHATSAPP_WEBHOOK_SECRET         el «verify token» que se pone al dar de alta el webhook
 *   WHATSAPP_BUSINESS_PHONE         el número legible, para mostrar
 *   WHATSAPP_GRAPH_VERSION          versión de la Graph API (por omisión, la de abajo)
 *   WHATSAPP_GRAPH_URL              otra URL base: el simulador en desarrollo
 *   WHATSAPP_PROVIDER=demo          fuerza el modo demostración
 */

export interface ConfigCloud {
  phoneNumberId: string;
  accessToken: string;
  wabaId: string | null;
  appSecret: string | null;
  telefono: string | null;
  graphVersion: string;
  graphUrl: string;
}

/**
 * La versión de la Graph API contra la que se escribió y probó esto.
 *
 * Meta saca una cada pocos meses y cada una vive unos dos años; pasada la
 * fecha, los pedidos a una versión vencida se atienden con la más vieja que
 * siga viva, que puede cambiar respuestas. Se fija acá —y se puede pisar con
 * `WHATSAPP_GRAPH_VERSION`— para que una actualización sea una decisión y no
 * algo que pasa solo.
 */
export const VERSION_GRAPH = "v26.0";

const URL_GRAPH = "https://graph.facebook.com";

/**
 * Devuelve la config solo si está lo mínimo para enviar. Null si falta algo:
 * ahí el sistema usa el proveedor de demostración en vez de llamar a Meta y
 * fallar en cada acción.
 */
export function configCloud(): ConfigCloud | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) return null;

  return {
    phoneNumberId,
    accessToken,
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || null,
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() || null,
    telefono: process.env.WHATSAPP_BUSINESS_PHONE?.trim() || null,
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION?.trim() || VERSION_GRAPH,
    graphUrl: (process.env.WHATSAPP_GRAPH_URL?.trim() || URL_GRAPH).replace(/\/+$/, ""),
  };
}

export function hayCloud(): boolean {
  return configCloud() !== null;
}

/** El secreto de la app, para validar la firma aun sin el resto de la config. */
export function secretoDeLaApp(): string | null {
  return process.env.WHATSAPP_APP_SECRET?.trim() || null;
}

/** Si se está hablando con el simulador y no con Meta. Se avisa en pantalla. */
export function usaSimulador(config: ConfigCloud | null = configCloud()): boolean {
  return Boolean(config && !config.graphUrl.startsWith(URL_GRAPH));
}

export function urlGraph(config: ConfigCloud, ruta: string): string {
  return `${config.graphUrl}/${config.graphVersion}/${ruta.replace(/^\/+/, "")}`;
}

/** Número en el formato que espera la Cloud API: solo dígitos, sin «+». */
export function aTelefono(waJidOTelefono: string): string {
  return soloDigitos(waIdDeJid(waJidOTelefono));
}

/**
 * Pasa un teléfono tipeado a mano al JID que usa la bandeja, o null si no es
 * un número reconocible. La normalización vive en `numeros.ts`.
 */
export function aJid(telefono: string): string | null {
  const waId = aWaId(telefono);
  return waId ? `${waId}@s.whatsapp.net` : null;
}

/** Muestra un JID como número legible: «+54 9 223 590-3118». */
export function jidLegible(waJid: string): string {
  return numeroLegible(waJid);
}
