import "server-only";

/**
 * Credenciales de la WhatsApp Cloud API.
 *
 * Viven solo en variables de entorno: un access token de Meta con permiso para
 * escribirle a los clientes no puede estar en el repo ni llegar al navegador.
 * Este módulo es el único que las lee.
 *
 * Variables (`.env.local`):
 *   WHATSAPP_PHONE_NUMBER_ID        id del número en Meta
 *   WHATSAPP_ACCESS_TOKEN           token permanente del System User
 *   WHATSAPP_BUSINESS_ACCOUNT_ID    WABA, para listar plantillas
 *   WHATSAPP_APP_SECRET             valida la firma del webhook
 *   WHATSAPP_WEBHOOK_SECRET         verify token del alta del webhook
 *   WHATSAPP_BUSINESS_PHONE         número legible, informativo
 *   WHATSAPP_PROVIDER=demo          fuerza el proveedor de demostración
 */

export interface ConfigCloud {
  phoneNumberId: string;
  accessToken: string;
  wabaId: string | null;
  appSecret: string | null;
  telefono: string | null;
  graphVersion: string;
}

const VERSION_GRAPH = "v21.0";

/**
 * Devuelve la config solo si está lo mínimo para enviar y recibir. Null si
 * falta algo: ahí el sistema usa el proveedor de demostración en vez de
 * intentar llamar a Meta y fallar en cada acción.
 */
export function configCloud(): ConfigCloud | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;

  return {
    phoneNumberId,
    accessToken,
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? null,
    appSecret: process.env.WHATSAPP_APP_SECRET ?? null,
    telefono: process.env.WHATSAPP_BUSINESS_PHONE ?? null,
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? VERSION_GRAPH,
  };
}

export function hayCloud(): boolean {
  return configCloud() !== null;
}

export function urlGraph(config: ConfigCloud, path: string): string {
  return `https://graph.facebook.com/${config.graphVersion}/${path}`;
}

/**
 * Número en el formato que espera la Cloud API: solo dígitos, sin "+".
 * Acepta un JID ("5492235550000@s.whatsapp.net"), un "+54 9 223…" o los
 * dígitos pelados.
 */
export function aTelefono(waJidOTelefono: string): string {
  return waJidOTelefono.split("@")[0].replace(/\D/g, "");
}

/**
 * Pasa un teléfono argentino al JID que usa WhatsApp.
 *
 * Los teléfonos de la base vienen como los tipeó quien atendió: "223 590-3118",
 * "(0223) 474-3328", "+5492235903118". Para hablarle a esa persona hace falta
 * el formato internacional con el 9 de celular, así que se normaliza acá y en
 * un solo lugar.
 */
export function aJid(telefono: string): string | null {
  let digitos = telefono.replace(/\D/g, "");
  if (digitos.length < 8) return null;

  // Saca el 0 de larga distancia y el 15 de celular, que conviven en cómo se
  // escriben los números en Argentina pero no van en el formato internacional.
  if (digitos.startsWith("0")) digitos = digitos.slice(1);

  if (!digitos.startsWith("54")) {
    // Sin código de país: se asume Argentina. Si arranca con 15 después del
    // characterístico, ese 15 se descarta.
    digitos = digitos.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");
    digitos = `54${digitos}`;
  }

  // Todo celular argentino lleva un 9 después del 54 para WhatsApp.
  if (!digitos.startsWith("549")) {
    digitos = `549${digitos.slice(2)}`;
  }

  if (digitos.length < 12 || digitos.length > 15) return null;

  return `${digitos}@s.whatsapp.net`;
}

/** Muestra un JID como número legible: "+54 9 223 590-3118". */
export function jidLegible(waJid: string): string {
  const d = aTelefono(waJid);
  if (d.length < 10) return waJid;

  const sinPais = d.startsWith("549") ? d.slice(3) : d.replace(/^54/, "");
  const area = sinPais.slice(0, 3);
  const resto = sinPais.slice(3);

  return `+54 9 ${area} ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}
