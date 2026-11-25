import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificación de la firma del webhook de Mercado Pago.
 *
 * Va en su propio módulo, sin `server-only`, para poder tener tests: la firma
 * es la única defensa que hay contra alguien que descubra la URL del webhook y
 * mande "pago aprobado" para un pedido que no pagó. Un error acá no se nota en
 * ninguna pantalla.
 *
 * Mercado Pago manda dos cabeceras:
 *
 *   x-signature: ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e839
 *   x-request-id: 3e4f1a2b-...
 *
 * y firma con HMAC-SHA256 sobre un texto armado con partes de la URL y de esas
 * cabeceras. Los segmentos cuyo valor no existe se omiten enteros: incluirlos
 * vacíos da otra firma y hace fallar avisos legítimos.
 */

export interface PartesFirma {
  /** El `data.id` del query string, en minúsculas si es alfanumérico. */
  dataId: string | null;
  requestId: string | null;
  ts: string;
  v1: string;
}

/** Parte la cabecera `x-signature` en sus campos. Null si viene rota. */
export function leerCabeceraFirma(
  cabecera: string | null,
): { ts: string; v1: string } | null {
  if (!cabecera) return null;

  let ts: string | null = null;
  let v1: string | null = null;

  for (const parte of cabecera.split(",")) {
    const separador = parte.indexOf("=");
    if (separador < 0) continue;

    const clave = parte.slice(0, separador).trim();
    const valor = parte.slice(separador + 1).trim();

    if (clave === "ts") ts = valor;
    if (clave === "v1") v1 = valor;
  }

  return ts && v1 ? { ts, v1 } : null;
}

/**
 * Arma el texto que Mercado Pago firmó.
 *
 * El orden de los segmentos es parte del contrato y no se puede reordenar.
 */
export function manifiestoFirma(partes: Omit<PartesFirma, "v1">): string {
  const segmentos: string[] = [];

  if (partes.dataId) segmentos.push(`id:${partes.dataId};`);
  if (partes.requestId) segmentos.push(`request-id:${partes.requestId};`);
  segmentos.push(`ts:${partes.ts};`);

  return segmentos.join("");
}

/** Tolerancia de reloj para el `ts` firmado: cinco minutos para cada lado. */
const DESFASE_MAXIMO_MS = 5 * 60_000;

/**
 * Dice si la firma es de Mercado Pago.
 *
 * Sin secreto configurado devuelve `false`, nunca `true`: un webhook sin
 * verificar es un endpoint público que acredita pagos. Quien llama decide qué
 * hacer con eso —en desarrollo, registrar el aviso sin acreditar—.
 */
export function firmaValida(
  partes: PartesFirma,
  secreto: string | null | undefined,
  ahora = Date.now(),
): boolean {
  if (!secreto) return false;

  const marca = Number(partes.ts);
  if (!Number.isFinite(marca)) return false;

  // El `ts` viene en segundos o en milisegundos según el aviso; se normaliza
  // mirando el orden de magnitud en vez de asumir uno de los dos.
  const marcaMs = marca > 1e12 ? marca : marca * 1000;
  if (Math.abs(ahora - marcaMs) > DESFASE_MAXIMO_MS) return false;

  const esperada = createHmac("sha256", secreto)
    .update(manifiestoFirma(partes))
    .digest("hex");

  const recibida = partes.v1.trim().toLowerCase();
  if (recibida.length !== esperada.length) return false;

  // Comparación de tiempo constante: comparar hashes con === filtra el secreto
  // de a un byte por vez para quien mida los tiempos de respuesta.
  return timingSafeEqual(Buffer.from(esperada), Buffer.from(recibida));
}
