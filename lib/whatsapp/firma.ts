import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Valida `X-Hub-Signature-256: sha256=<hmac>` contra el secreto de la app.
 *
 * Sin secreto devuelve false: si no se puede verificar quién manda, no se
 * procesa. El webhook es público y escribe en la base; sin la firma,
 * cualquiera podría inventar mensajes de cualquier cliente.
 *
 * Se calcula sobre **los bytes crudos** del cuerpo: parsear y volver a
 * serializar cambia espacios y escapes (`á` contra `á`), y la firma deja
 * de coincidir. La comparación es de tiempo constante a propósito: con `===`
 * la respuesta tarda distinto según cuántos caracteres acierta, y eso alcanza
 * para ir adivinando.
 *
 * Aparte del resto del webhook, sin base ni `server-only`, para probarla.
 */
export function firmaValida(
  cuerpoCrudo: string | Uint8Array,
  cabecera: string | null | undefined,
  secreto: string | null | undefined,
): boolean {
  if (!secreto || !cabecera) return false;
  if (!cabecera.startsWith("sha256=")) return false;

  const esperada = createHmac("sha256", secreto)
    .update(typeof cuerpoCrudo === "string" ? Buffer.from(cuerpoCrudo, "utf8") : cuerpoCrudo)
    .digest("hex");

  const recibida = Buffer.from(cabecera.slice("sha256=".length).trim().toLowerCase(), "utf8");
  const calculada = Buffer.from(esperada, "utf8");

  if (recibida.length !== calculada.length) return false;
  return timingSafeEqual(recibida, calculada);
}

/** La cabecera que pondría Meta, para el simulador y los tests. */
export function firmar(cuerpo: string | Uint8Array, secreto: string): string {
  return `sha256=${createHmac("sha256", secreto).update(cuerpo).digest("hex")}`;
}
