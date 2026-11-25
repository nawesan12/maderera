import { z } from "zod";

/**
 * Los esquemas de lo que manda el mostrador, en un solo lugar.
 *
 * La venta entra por dos puertas —la acción del servidor, en línea, y la API
 * que vacía la cola de las ventas hechas sin conexión— y cada una tenía su
 * copia del esquema de pagos. Ya habían divergido: la de la cola no conocía
 * las cuotas, así que una venta en doce cuotas hecha sin internet llegaba
 * como un pago (1/10/2026). Una sola definición para las dos.
 */

export const medioDeMostradorSchema = z.enum([
  "efectivo",
  "debito",
  "credito",
  "transferencia",
  "cuenta_corriente",
  "cheque",
]);

export const chequeDePagoSchema = z.object({
  tipo: z.enum(["fisico", "echeq"]).default("fisico"),
  numero: z.string().trim().max(40),
  banco: z.string().trim().max(80),
  fechaPago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha de pago del cheque."),
  librador: z.string().trim().max(120).nullable().optional(),
});

export const pagoDeMostradorSchema = z.object({
  medio: medioDeMostradorSchema,
  importe: z.number().positive(),
  /** Lote y cupón de la terminal: el «código de que se pagó con qué». */
  nroLote: z.string().max(20).nullable().optional(),
  nroCupon: z.string().max(20).nullable().optional(),
  /** En cuántas cuotas. No cambia el importe; ver `PagoDeVenta`. */
  cuotas: z.coerce.number().int().min(1).max(24).nullable().optional(),
  tarjeta: z.string().max(40).nullable().optional(),
  /** El cheque, cuando el medio es `cheque`. */
  cheque: chequeDePagoSchema.nullable().optional(),
});
