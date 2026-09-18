"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { regimenesRetencion } from "@/lib/db/schema";
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

export interface EstadoRegimen {
  error?: string;
  ok?: string;
}

/**
 * Cambia la alícuota de un régimen de retención.
 *
 * Es lo que permite lo que pidió la clienta —«dejar en 0 los demás sin
 * borrarlos»— sin tocar la base ni desplegar: un régimen con alícuota cero no
 * retiene nada y sigue cargado, con su código, para el día que vuelva a
 * corresponder.
 *
 * Solo el administrador: es el número con el que se le retiene plata a un
 * proveedor y después se le entrega un certificado firmado.
 */
export async function guardarRegimen(
  _previo: EstadoRegimen,
  formData: FormData,
): Promise<EstadoRegimen> {
  const usuario = await requireStaffRole("admin");

  const parsed = z
    .object({
      id: z.string().uuid(),
      alicuota: z.coerce.number().min(0).max(100),
      alicuotaNoInscripto: z.coerce.number().min(0).max(100),
      activo: z.boolean(),
    })
    .safeParse({
      id: formData.get("id"),
      alicuota: formData.get("alicuota"),
      alicuotaNoInscripto: formData.get("alicuotaNoInscripto"),
      activo: formData.get("activo") === "on",
    });

  if (!parsed.success) {
    return {
      error: "Revisá las alícuotas: van en porcentaje, de 0 a 100.",
    };
  }

  const [regimen] = await db
    .update(regimenesRetencion)
    .set({
      alicuota: parsed.data.alicuota.toFixed(3),
      alicuotaNoInscripto: parsed.data.alicuotaNoInscripto.toFixed(3),
      activo: parsed.data.activo,
    })
    .where(eq(regimenesRetencion.id, parsed.data.id))
    .returning({
      codigo: regimenesRetencion.codigo,
      nombre: regimenesRetencion.nombre,
    });

  if (!regimen) return { error: "Ese régimen ya no está." };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "retencion",
    entidadId: parsed.data.id,
    descripcion: `Dejó ${regimen.nombre} al ${parsed.data.alicuota}%${parsed.data.activo ? "" : " y lo apagó"}`,
    // Queda quién cambió con cuánto se retiene: es plata de un tercero.
    detalle: {
      alicuota: parsed.data.alicuota,
      alicuotaNoInscripto: parsed.data.alicuotaNoInscripto,
      activo: parsed.data.activo,
    },
  });

  revalidatePath("/admin/arca/retenciones");
  revalidatePath("/admin/compras/pagos");

  return {
    ok:
      parsed.data.alicuota === 0
        ? "Listo: queda cargado y no retiene."
        : "Alícuota actualizada.",
  };
}
