"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { registrarGasto } from "@/lib/dal/admin/gastos";
import { formatearMonto } from "@/lib/formato";

export interface EstadoGasto {
  error?: string;
  ok?: string;
  aviso?: string;
}

const esquema = z.object({
  fecha: z.string(),
  categoria: z.enum([
    "flete",
    "combustible",
    "servicios",
    "alquiler",
    "sueldos",
    "mantenimiento",
    "impuestos",
    "librería",
    "publicidad",
    "otros",
  ]),
  descripcion: z.string().trim().min(2, "Poné en qué se gastó.").max(200),
  importe: z.coerce.number().positive("El importe tiene que ser mayor a cero."),
  medio: z.enum(["efectivo", "transferencia", "debito", "credito", "cheque"]),
  branchId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null)),
  supplierId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null)),
  notas: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function cargarGasto(
  datos: z.input<typeof esquema>,
): Promise<EstadoGasto> {
  const usuario = await requireStaffRole("admin");

  const leido = esquema.safeParse(datos);
  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = leido.data;

  const resultado = await registrarGasto({
    fecha: new Date(d.fecha),
    categoria: d.categoria,
    descripcion: d.descripcion,
    importe: d.importe,
    medio: d.medio,
    branchId: d.branchId,
    supplierId: d.supplierId,
    notas: d.notas,
    usuarioId: usuario.userId,
  });

  if (!resultado.ok) return { error: resultado.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "gasto",
    descripcion: `Anotó un gasto de ${formatearMonto(d.importe)} en ${d.categoria}: ${d.descripcion}`,
  });

  revalidatePath("/admin/compras/gastos");
  revalidatePath("/admin/caja");

  return {
    ok: `Gasto anotado por ${formatearMonto(d.importe)}.`,
    aviso: resultado.sinCaja
      ? "No había caja abierta en ese momento, así que no salió del turno. La plata igual se fue: el arqueo va a mostrar la diferencia."
      : undefined,
  };
}
