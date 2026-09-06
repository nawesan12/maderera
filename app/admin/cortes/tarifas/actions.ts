"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cuttingRates } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { parsearImporte } from "@/lib/formato";

export interface EstadoTarifa {
  error?: string;
  ok?: string;
}

const esquema = z.object({
  id: z.string().uuid().optional(),
  material: z.string().trim().min(2, "Poné el material.").max(80),
  /** Vacío significa "para cualquier lista": es la tarifa de público. */
  priceListId: z.string().uuid().nullable(),
  precioPorPasada: z.string().min(1, "Poné el precio por pasada."),
  activo: z.boolean(),
});

export async function guardarTarifaDeCorte(
  _previo: EstadoTarifa,
  formData: FormData,
): Promise<EstadoTarifa> {
  const usuario = await requireStaffRole("admin");

  const parsed = esquema.safeParse({
    id: (formData.get("id") as string) || undefined,
    material: formData.get("material"),
    priceListId: (formData.get("priceListId") as string) || null,
    precioPorPasada: (formData.get("precioPorPasada") as string) || "",
    activo: formData.get("activo") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;

  // `parsearImporte` y no `Number`: acá se tipea "1.200", y leerlo como punto
  // decimal convertiría mil doscientos pesos en uno con veinte.
  const precio = parsearImporte(datos.precioPorPasada);

  if (!Number.isFinite(precio) || precio <= 0) {
    return { error: "El precio por pasada tiene que ser mayor a cero." };
  }

  const valores = {
    material: datos.material,
    priceListId: datos.priceListId,
    precioPorPasada: precio.toFixed(2),
    activo: datos.activo,
    updatedAt: new Date(),
  };

  try {
    if (datos.id) {
      await db.update(cuttingRates).set(valores).where(eq(cuttingRates.id, datos.id));
    } else {
      await db.insert(cuttingRates).values(valores);
    }
  } catch {
    return {
      error: `Ya hay una tarifa de "${datos.material}" para esa lista de precios.`,
    };
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: datos.id ? "editar" : "crear",
    entidad: "tarifa_corte",
    entidadId: datos.id ?? null,
    descripcion: `Corte de ${datos.material}: $${precio.toFixed(2)} por pasada`,
    detalle: valores,
  });

  revalidatePath("/admin/cortes/tarifas");
  return { ok: "Tarifa guardada." };
}
