import { z } from "zod";
import { parsearImporte } from "@/lib/formato";
import type { ParteDeCobro } from "@/lib/cobros/partes";

/**
 * Lee las partes de un cobro como las manda `CobroMultimedio`.
 *
 * Llegan como JSON en un campo oculto del formulario —un cobro tiene una
 * cantidad variable de renglones, y `FormData` no tiene listas de objetos—.
 * Una acción del servidor se puede invocar sin pasar por el formulario, así
 * que lo que llega se revisa entero acá: forma, importes y fechas.
 */

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha de pago del cheque.")
  // Mediodía y no medianoche: guardado a las 00:00 locales, un 15/11 se lee
  // 14/11 en cualquier lado que lo formatee en UTC.
  .transform((v) => new Date(`${v}T12:00:00`));

const esquemaParte = z.object({
  medio: z.enum([
    "efectivo",
    "transferencia",
    "deposito",
    "cheque",
    "echeq",
    "tarjeta_debito",
    "tarjeta_credito",
    "mercado_pago",
    "retencion",
  ]),
  importe: z.string(),
  referencia: z.string().trim().max(120).optional().nullable(),
  chequeId: z.string().uuid().optional().nullable(),
  cheque: z
    .object({
      numero: z.string().trim().max(40),
      banco: z.string().trim().max(80),
      librador: z.string().trim().max(120).optional().nullable(),
      fechaPago: fecha,
    })
    .optional()
    .nullable(),
});

export function leerPartes(crudo: unknown): { partes: ParteDeCobro[] } | { error: string } {
  let datos: unknown = crudo;
  if (typeof crudo === "string") {
    try {
      datos = JSON.parse(crudo);
    } catch {
      return { error: "No se pudo leer cómo paga. Volvé a cargarlo." };
    }
  }

  const parsed = z.array(esquemaParte).max(20, "Son demasiados medios en un solo cobro.").safeParse(datos);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá cómo paga." };
  }

  return {
    partes: parsed.data.map((p) => ({
      medio: p.medio,
      importe: parsearImporte(p.importe),
      referencia: p.referencia || null,
      chequeId: p.chequeId || null,
      cheque: p.cheque
        ? {
            numero: p.cheque.numero,
            banco: p.cheque.banco,
            librador: p.cheque.librador || null,
            fechaPago: p.cheque.fechaPago,
          }
        : null,
    })),
  };
}
