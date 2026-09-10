"use server";

import { revalidatePath, updateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { priceLists } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { ETIQUETAS } from "@/lib/cache-publico";

export interface EstadoLista {
  error?: string;
  ok?: string;
}

const esquema = z.object({
  id: z.string().uuid(),
  /*
   * El porcentaje sobre la general de una lista derivada. Acotado a ±50:
   * más que eso no es una lista comercial, es un error de tipeo, y el
   * catálogo entero saldría publicado a ese precio.
   */
  porcentaje: z.coerce.number().min(-50).max(50).nullable(),
});

/**
 * Ajusta el porcentaje global de una lista derivada.
 *
 * Es el "manejo global de precios especiales por porcentaje ajustable" que
 * pidió la clienta: la constructora vale "general − N %" y ese N se toca acá,
 * impactando en todo el catálogo de una vez. Los ítems propios cargados a mano
 * no se tocan: siguen pisando al derivado.
 */
export async function ajustarPorcentajeDeLista(
  _previo: EstadoLista,
  formData: FormData,
): Promise<EstadoLista> {
  const usuario = await requireStaffRole("admin");

  const crudo = (formData.get("porcentaje") as string)?.trim() ?? "";
  const parsed = esquema.safeParse({
    id: formData.get("id"),
    porcentaje: crudo === "" ? null : crudo.replace(",", "."),
  });

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "El porcentaje tiene que estar entre −50 y 50.",
    };
  }

  const [lista] = await db
    .select({ nombre: priceLists.name, isDefault: priceLists.isDefault })
    .from(priceLists)
    .where(eq(priceLists.id, parsed.data.id))
    .limit(1);

  if (!lista) return { error: "Esa lista no existe." };
  if (lista.isDefault) {
    return { error: "La lista general no se deriva de sí misma." };
  }

  await db
    .update(priceLists)
    .set({
      porcentajeSobreGeneral:
        parsed.data.porcentaje === null
          ? null
          : parsed.data.porcentaje.toFixed(2),
    })
    .where(eq(priceLists.id, parsed.data.id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "lista_precios",
    entidadId: parsed.data.id,
    descripcion:
      parsed.data.porcentaje === null
        ? `${lista.nombre}: dejó de derivarse de la general`
        : `${lista.nombre}: ${parsed.data.porcentaje > 0 ? "+" : ""}${parsed.data.porcentaje}% sobre la lista general`,
  });

  // El catálogo cachea por lista y factor; con el tag además se limpia lo que
  // haya quedado servido con el porcentaje anterior.
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/admin/precios/listas");
  return { ok: "Porcentaje guardado. Impacta en todo el catálogo de esa lista." };
}
