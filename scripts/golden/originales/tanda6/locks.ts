import { sql } from "drizzle-orm";

/**
 * El lock que protege el stock de una variante en una sucursal.
 *
 * Vive acá y no dentro de `reservas.ts` porque lo usan tres módulos —las
 * reservas, la recepción de compras y el ajuste manual— y dos definiciones del
 * mismo hash es de las cosas que se separan en silencio: alcanza con que
 * alguien concatene en otro orden para que dos transacciones que deberían
 * esperarse pasen juntas.
 *
 * La concatenación es a propósito, y el orden también: `variantId + branchId`.
 * Sumar los dos hashes por separado haría que (A,B) y (B,A) cayeran en la misma
 * clave.
 */
export function claveDeLock(variantId: string, branchId: string) {
  return sql`hashtext(${variantId + branchId})`;
}
