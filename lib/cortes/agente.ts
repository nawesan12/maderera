import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Autenticación del agente del taller.
 *
 * El agente es un script que corre en la PC del aserradero, no un navegador:
 * no tiene cookie de sesión, así que se identifica con un token compartido en
 * el encabezado `Authorization`.
 *
 * **Sin `CORTES_AGENTE_TOKEN` configurado la integración está apagada** y los
 * endpoints responden 404, no 401. Un 401 confirmaría que la ruta existe; un
 * 404 no le dice nada a quien esté probando URLs.
 *
 * La comparación es de tiempo constante por la misma razón que la firma de
 * pagos: comparar con `===` filtra, carácter a carácter, cuánto del token se
 * acertó.
 */
export function tokenDelAgente(): string | null {
  const token = process.env.CORTES_AGENTE_TOKEN?.trim();
  return token && token.length >= 16 ? token : null;
}

export function agenteAutorizado(request: Request): boolean {
  const esperado = tokenDelAgente();
  if (!esperado) return false;

  const cabecera = request.headers.get("authorization") ?? "";
  const recibido = cabecera.startsWith("Bearer ")
    ? cabecera.slice(7).trim()
    : "";

  // `timingSafeEqual` explota si los largos difieren, y el largo del token no
  // es secreto: se compara antes.
  if (recibido.length !== esperado.length) return false;

  return timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
}
