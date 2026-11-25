import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * El enlace para darse de baja de las campañas.
 *
 * Va firmado: sin firma, cualquiera podría dar de baja a otra persona
 * cambiando la dirección en el enlace. La firma es un HMAC de la dirección con
 * un secreto del servidor, así que no hay nada que guardar por enlace y no
 * vence —una baja tiene que andar aunque el correo tenga dos años—.
 *
 * El secreto llega por parámetro para poder probarlo; en el sistema sale de
 * `BETTER_AUTH_SECRET` (ver `secretoDeBajas`), con un prefijo propio para que
 * la misma clave no firme dos cosas distintas.
 */
export function normalizarCorreo(email: string): string {
  return email.trim().toLowerCase();
}

function firma(email: string, secreto: string): string {
  return createHmac("sha256", `bajas:${secreto}`)
    .update(normalizarCorreo(email))
    .digest("base64url")
    .slice(0, 32);
}

export function codificarCorreo(email: string): string {
  return Buffer.from(normalizarCorreo(email)).toString("base64url");
}

export function decodificarCorreo(codificado: string): string | null {
  try {
    const email = Buffer.from(codificado, "base64url").toString("utf8");
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  } catch {
    return null;
  }
}

export function parametrosDeBaja(email: string, secreto: string): { e: string; t: string } {
  return { e: codificarCorreo(email), t: firma(email, secreto) };
}

/** La dirección, si el enlace es auténtico; si no, null. */
export function verificarBaja(e: string, t: string, secreto: string): string | null {
  const email = decodificarCorreo(e);
  if (!email || !t) return null;
  const esperada = Buffer.from(firma(email, secreto));
  const recibida = Buffer.from(t);
  if (esperada.length !== recibida.length) return null;
  return timingSafeEqual(esperada, recibida) ? email : null;
}

export function secretoDeBajas(): string {
  const secreto = process.env.BETTER_AUTH_SECRET;
  if (!secreto) throw new Error("Falta BETTER_AUTH_SECRET para firmar los enlaces de baja.");
  return secreto;
}
