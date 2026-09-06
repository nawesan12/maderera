"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { paymentDiscounts } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { parsearImporte } from "@/lib/formato";

export interface EstadoDescuento {
  error?: string;
  ok?: string;
}

const esquema = z.object({
  id: z.string().uuid().optional(),
  medio: z.enum([
    "mercado_pago",
    "transferencia",
    "efectivo",
    "debito",
    "credito",
    "cuenta_corriente",
  ]),
  desdeMonto: z.string().default("0"),
  porcentaje: z.string().min(1, "Poné el porcentaje."),
  etiqueta: z.string().trim().max(80).default(""),
  activo: z.boolean(),
});

export async function guardarDescuentoDePago(
  _previo: EstadoDescuento,
  formData: FormData,
): Promise<EstadoDescuento> {
  const usuario = await requireStaffRole("admin");

  const parsed = esquema.safeParse({
    id: (formData.get("id") as string) || undefined,
    medio: formData.get("medio"),
    desdeMonto: (formData.get("desdeMonto") as string) || "0",
    porcentaje: (formData.get("porcentaje") as string) || "",
    etiqueta: (formData.get("etiqueta") as string) || "",
    activo: formData.get("activo") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;
  const desde = parsearImporte(datos.desdeMonto);
  const porcentaje = parsearImporte(datos.porcentaje);

  if (!Number.isFinite(desde) || desde < 0) {
    return { error: "El monto desde el que aplica no puede ser negativo." };
  }

  /*
   * El mismo tope de 90 % que los descuentos por volumen.
   *
   * Alguien que tipea el monto en el campo del porcentaje dejaría cada venta
   * en cero. Noventa deja lugar a cualquier promoción real y frena el error de
   * tipeo antes de que llegue a una caja.
   */
  if (!Number.isFinite(porcentaje) || porcentaje <= 0 || porcentaje > 90) {
    return { error: "El porcentaje tiene que estar entre 1 y 90." };
  }

  const valores = {
    medio: datos.medio,
    desdeMonto: desde.toFixed(2),
    porcentaje: porcentaje.toFixed(2),
    etiqueta: datos.etiqueta,
    activo: datos.activo,
  };

  try {
    if (datos.id) {
      await db
        .update(paymentDiscounts)
        .set(valores)
        .where(eq(paymentDiscounts.id, datos.id));
    } else {
      await db.insert(paymentDiscounts).values(valores);
    }
  } catch {
    return {
      error: "Ya hay un escalón de ese medio de pago con el mismo monto desde.",
    };
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: datos.id ? "editar" : "crear",
    entidad: "descuento_pago",
    entidadId: datos.id ?? null,
    descripcion: `${datos.medio}: ${porcentaje}% desde $${desde.toFixed(2)}`,
    detalle: valores,
  });

  revalidatePath("/admin/precios/formas-de-pago");
  revalidatePath("/checkout");
  return { ok: "Descuento guardado." };
}
