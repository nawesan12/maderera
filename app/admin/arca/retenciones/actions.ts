"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { cargarRetencionSufrida } from "@/lib/dal/admin/retenciones-sufridas";
import { formatearMonto } from "@/lib/formato";

export interface EstadoSufrida {
  error?: string;
  ok?: string;
}

const esquema = z.object({
  customerId: z.string().uuid("Elegí el cliente."),
  numero: z.string().trim().min(1, "Poné el número del certificado.").max(40),
  impuesto: z.enum(["ganancias", "iva", "suss", "iibb"]),
  codigoRegimen: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : null)),
  base: z.coerce.number().min(0),
  alicuota: z.coerce.number().min(0).max(100).optional(),
  importe: z.coerce.number().positive("El importe tiene que ser mayor a cero."),
  fecha: z.string(),
  referencia: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : null)),
});

/**
 * Carga un certificado que nos entregó un cliente.
 *
 * **Baja lo que el cliente debe**, igual que un pago: es plata que ya entregó,
 * solo que al fisco. Tratarlo como descuento comercial lo sacaría del crédito
 * fiscal, que es plata recuperable.
 */
export async function cargarSufrida(
  datos: z.input<typeof esquema>,
): Promise<EstadoSufrida> {
  const usuario = await requireStaffRole("admin");

  const leido = esquema.safeParse(datos);
  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = leido.data;

  const resultado = await cargarRetencionSufrida({
    customerId: d.customerId,
    numero: d.numero,
    impuesto: d.impuesto,
    codigoRegimen: d.codigoRegimen,
    base: d.base,
    alicuota: d.alicuota ?? null,
    importe: d.importe,
    fecha: new Date(d.fecha),
    referencia: d.referencia,
    usuarioId: usuario.userId,
  });

  if (!resultado.ok) return { error: resultado.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "retencion_sufrida",
    descripcion: `Cargó el certificado ${d.numero} por ${formatearMonto(d.importe)}`,
  });

  revalidatePath("/admin/arca/retenciones");
  revalidatePath(`/admin/clientes/${d.customerId}`);

  return {
    ok: `Certificado cargado. La cuenta del cliente baja ${formatearMonto(d.importe)}.`,
  };
}
