/**
 * La firma con que esta sesión deja sus ventas en la cola sin conexión.
 *
 * La entrega el servidor en cada latido (backend/internal/mostrador/firma.go)
 * y se guarda acá para tenerla cuando se corta internet. Al drenar, una venta
 * queda a nombre de quien la cobró solo si lleva la firma de ese usuario; sin
 * ella, queda a nombre de quien la sube.
 *
 * Va en localStorage y no en la cola de IndexedDB porque es una sola por
 * puesto y se pisa con cada latido. Si el almacenamiento falla, la venta se
 * encola sin firma: nunca se pierde una venta por esto.
 */

const CLAVE = "mjbj-mostrador-firma-cola";

export interface FirmaDeCola {
  usuarioId: string;
  firma: string;
  /** ISO. */
  vence: string;
}

export function guardarFirma(datos: unknown): void {
  if (!datos || typeof datos !== "object") return;
  const f = datos as Partial<FirmaDeCola>;
  if (typeof f.usuarioId !== "string" || typeof f.firma !== "string" || typeof f.vence !== "string") return;
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ usuarioId: f.usuarioId, firma: f.firma, vence: f.vence }));
  } catch {
    // Sin almacenamiento, las ventas salen sin firma.
  }
}

/** La firma de usuarioId si es la guardada y no venció. */
export function firmaPara(usuarioId: string, ahora = new Date()): string | undefined {
  try {
    const f = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as FirmaDeCola | null;
    if (!f || f.usuarioId !== usuarioId || new Date(f.vence) < ahora) return undefined;
    return f.firma;
  } catch {
    return undefined;
  }
}
