"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { shippingZones } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { parsearImporte } from "@/lib/formato";

export interface EstadoZona {
  error?: string;
  ok?: string;
}

/**
 * Las zonas de envío se veían solo en el checkout y **no se podían editar
 * desde ningún lado**: existían únicamente en el script de siembra, así que
 * cambiar una tarifa exigía un despliegue. Para un negocio cuyo flete cambia
 * con el combustible, eso es tenerlo desactualizado siempre.
 */
function refrescar() {
  // Comparten etiqueta de caché con las sucursales: las dos las lee el
  // checkout y se invalidan juntas.
  updateTag(ETIQUETAS.sucursales);
  revalidatePath("/admin/envios");
  revalidatePath("/checkout");
}

const esquema = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().trim().min(1, "Poné el nombre de la zona.").max(80),
  cobertura: z.string().trim().max(300).default(""),
  demoraEstimada: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : null)),
  aCotizar: z.boolean().default(false),
  costo: z.string().default("0"),
  envioGratisDesde: z.string().default("0"),
  orden: z.string().default("0"),
  activa: z.boolean().default(true),
});

export async function guardarZona(
  _previo: EstadoZona,
  formData: FormData,
): Promise<EstadoZona> {
  const usuario = await requireStaffRole("admin");

  const parsed = esquema.safeParse({
    id: (formData.get("id") as string) || undefined,
    nombre: formData.get("nombre"),
    cobertura: formData.get("cobertura") ?? "",
    demoraEstimada: formData.get("demoraEstimada") ?? "",
    aCotizar: formData.get("aCotizar") === "on",
    costo: (formData.get("costo") as string) || "0",
    envioGratisDesde: (formData.get("envioGratisDesde") as string) || "0",
    orden: (formData.get("orden") as string) || "0",
    activa: formData.get("activa") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;

  // `parsearImporte` y no `Number`: acá se tipea "18.000" y "18.000,50", y
  // leerlos como punto decimal convertiría dieciocho mil en dieciocho.
  const costo = datos.aCotizar ? 0 : parsearImporte(datos.costo);
  const gratisDesde = datos.aCotizar ? 0 : parsearImporte(datos.envioGratisDesde);

  if (!Number.isFinite(costo) || costo < 0) {
    return { error: "El costo no puede ser negativo." };
  }
  if (!Number.isFinite(gratisDesde) || gratisDesde < 0) {
    return { error: "El monto de envío gratis no puede ser negativo." };
  }

  const valores = {
    nombre: datos.nombre,
    cobertura: datos.cobertura,
    demoraEstimada: datos.demoraEstimada,
    aCotizar: datos.aCotizar,
    costo: costo.toFixed(2),
    envioGratisDesde: gratisDesde.toFixed(2),
    orden: String(Number(datos.orden) || 0),
    activa: datos.activa,
  };

  if (datos.id) {
    await db.update(shippingZones).set(valores).where(eq(shippingZones.id, datos.id));
  } else {
    await db.insert(shippingZones).values(valores);
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: datos.id ? "editar" : "crear",
    entidad: "zona_envio",
    entidadId: datos.id ?? null,
    descripcion: `Zona de envío "${datos.nombre}": ${
      datos.aCotizar ? "flete a cotizar" : `$${costo.toFixed(2)}`
    }`,
    detalle: valores,
  });

  refrescar();
  return { ok: "Zona guardada." };
}
