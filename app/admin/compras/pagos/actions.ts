"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { formatearMonto } from "@/lib/formato";
import { registrarPagoAProveedor } from "@/lib/retenciones/pago";
import { acumuladoDelMes } from "@/lib/dal/admin/pagos-proveedor";

export interface EstadoPago {
  error?: string;
  ok?: string;
  /** Los certificados emitidos, para poder imprimirlos en el acto. */
  certificados?: { numero: string; impuesto: string; importe: number }[];
}

const esquema = z.object({
  supplierId: z.string().uuid("Elegí el proveedor."),
  total: z.coerce.number().positive("El pago tiene que ser mayor a cero."),
  medio: z.enum(["transferencia", "efectivo", "cheque", "echeq"]),
  referencia: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : null)),
  notas: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null)),
  retenciones: z.array(
    z.object({
      regimenId: z.string().uuid(),
      base: z.coerce.number().min(0),
    }),
  ),
});

/**
 * Registra el pago y emite los certificados.
 *
 * El importe que se carga es **lo que se le imputa a la deuda**, retenciones
 * incluidas. Lo que sale del banco lo calcula el sistema restando lo retenido:
 * pedir los dos números invita a que no coincidan, y cuál de los dos es el
 * bueno no es algo que se pueda deducir después.
 */
export async function pagarAProveedor(
  datos: z.input<typeof esquema>,
): Promise<EstadoPago> {
  const usuario = await requireStaffRole("admin");

  const leido = esquema.safeParse(datos);
  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = leido.data;

  const resultado = await registrarPagoAProveedor({
    supplierId: d.supplierId,
    total: d.total,
    medio: d.medio,
    referencia: d.referencia,
    notas: d.notas,
    retenciones: d.retenciones.filter((r) => r.base > 0),
    usuarioId: usuario.userId,
  });

  if (!resultado.ok) return { error: resultado.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "pago_proveedor",
    entidadId: resultado.paymentId,
    descripcion:
      `Pagó ${formatearMonto(d.total)} por ${d.medio}` +
      (resultado.certificados.length > 0
        ? `, con ${resultado.certificados.length} retenciones`
        : ""),
  });

  revalidatePath("/admin/compras/pagos");
  revalidatePath(`/admin/proveedores/${d.supplierId}`);

  return {
    ok:
      resultado.certificados.length > 0
        ? `Pago registrado. Salieron ${formatearMonto(resultado.neto)} y se retuvieron ${formatearMonto(d.total - resultado.neto)}.`
        : `Pago registrado por ${formatearMonto(resultado.neto)}.`,
    certificados: resultado.certificados,
  };
}

/** Lo ya retenido este mes, para mostrarlo antes de pagar. */
export async function verAcumulado(supplierId: string) {
  return acumuladoDelMes(supplierId);
}
