"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { supplierTerms, suppliers } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";

export interface EstadoCondicion {
  error?: string;
  ok?: string;
}

const esquema = z.object({
  id: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  modalidad: z.enum(["transferencia", "cheque", "echeq", "efectivo", "otro"]),
  plazoDias: z.coerce.number().int().min(0).max(365).default(0),
  bonificacionPct: z.coerce.number().min(0).max(90).default(0),
  detalle: z.string().trim().max(300).optional(),
});

/**
 * Una condición de pago del proveedor, por escrito.
 *
 * Es el pedido de la clienta: que los descuentos, las bonificaciones y las
 * modalidades que acepta cada proveedor queden asentados y no en la memoria
 * de quien paga.
 */
export async function guardarCondicion(
  _previo: EstadoCondicion,
  formData: FormData,
): Promise<EstadoCondicion> {
  const usuario = await requireStaffRole("admin");

  const parsed = esquema.safeParse({
    id: (formData.get("id") as string) || undefined,
    supplierId: formData.get("supplierId"),
    modalidad: formData.get("modalidad") ?? "transferencia",
    plazoDias: formData.get("plazoDias") || 0,
    bonificacionPct: (formData.get("bonificacionPct") as string)?.replace(",", ".") || 0,
    detalle: (formData.get("detalle") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = parsed.data;
  const valores = {
    supplierId: d.supplierId,
    modalidad: d.modalidad,
    plazoDias: d.plazoDias,
    bonificacionPct: d.bonificacionPct.toFixed(2),
    detalle: d.detalle ?? null,
  };

  if (d.id) {
    await db.update(supplierTerms).set(valores).where(eq(supplierTerms.id, d.id));
  } else {
    await db.insert(supplierTerms).values(valores);
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: d.id ? "editar" : "crear",
    entidad: "condicion_proveedor",
    entidadId: d.id ?? null,
    descripcion: `Condición de pago: ${d.modalidad} a ${d.plazoDias} días${d.bonificacionPct > 0 ? `, ${d.bonificacionPct}% de bonificación` : ""}`,
  });

  revalidatePath(`/admin/proveedores/${d.supplierId}`);
  return { ok: "Guardada." };
}

export async function borrarCondicion(
  id: string,
  supplierId: string,
): Promise<EstadoCondicion> {
  const usuario = await requireStaffRole("admin");

  await db.delete(supplierTerms).where(eq(supplierTerms.id, id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "eliminar",
    entidad: "condicion_proveedor",
    entidadId: id,
    descripcion: "Borró una condición de pago del proveedor",
  });

  revalidatePath(`/admin/proveedores/${supplierId}`);
  return { ok: "Borrada." };
}

/** Los convenios en prosa: lo pactado que no entra en una fila. */
export async function guardarConvenios(
  supplierId: string,
  convenios: string,
): Promise<EstadoCondicion> {
  const usuario = await requireStaffRole("admin");

  if (convenios.length > 2000) {
    return { error: "El texto de convenios es demasiado largo." };
  }

  await db
    .update(suppliers)
    .set({ convenios: convenios.trim() || null })
    .where(eq(suppliers.id, supplierId));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "proveedor",
    entidadId: supplierId,
    descripcion: "Actualizó los convenios del proveedor",
  });

  revalidatePath(`/admin/proveedores/${supplierId}`);
  return { ok: "Convenios guardados." };
}
