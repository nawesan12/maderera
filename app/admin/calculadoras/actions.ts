"use server";

import { revalidatePath, updateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { calculatorSettings } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { ETIQUETAS } from "@/lib/cache-publico";

export interface EstadoCalculadoras {
  error?: string;
  ok?: string;
}

/**
 * Un porcentaje que se guarda como fracción.
 *
 * En pantalla se escribe 12 y en la base va 0,12. Se pide en porcentaje porque
 * es como lo dice el brief —"un +20 %"— y como lo diría cualquiera; guardarlo
 * como fracción es lo que la fórmula necesita.
 */
const porcentaje = z.coerce
  .number()
  .min(0, "No puede ser negativo.")
  .max(100, "Más de 100 % de desperdicio no es un dato, es un error de tipeo.");

const medida = z.coerce
  .number()
  .positive("Tiene que ser mayor a cero.")
  .max(100);

const esquema = z.object({
  mermaMachimbre: porcentaje,
  factorPendiente: porcentaje,
  margenSeguridad: porcentaje,
  anchoSierraMm: z.coerce.number().min(0).max(50),
  rindeRolloMembrana: medida,
  rindeRolloAislacion: medida,
  separacionTechoM: medida,
  separacionPisoM: medida,
  deckGrandisLargoM: medida,
  deckGrandisAnchoM: medida,
  deckPvcLargoM: medida,
  deckPvcAnchoM: medida,
});

/**
 * Guarda los parámetros de las calculadoras.
 *
 * Es una fila única: si no existe se crea, y si existe se actualiza. No hay
 * "juegos de parámetros" porque no hay dos negocios.
 */
export async function guardarParametros(
  _previo: EstadoCalculadoras,
  formData: FormData,
): Promise<EstadoCalculadoras> {
  const usuario = await requireStaff();

  const parsed = esquema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const problema = parsed.error.issues[0];
    return {
      error: `${problema?.path.join(".") ?? "Un campo"}: ${problema?.message ?? "revisá los datos."}`,
    };
  }

  const d = parsed.data;

  const valores = {
    mermaMachimbre: (d.mermaMachimbre / 100).toFixed(4),
    factorPendiente: (d.factorPendiente / 100).toFixed(4),
    margenSeguridad: (d.margenSeguridad / 100).toFixed(4),
    anchoSierraMm: Math.round(d.anchoSierraMm),
    rindeRolloMembrana: d.rindeRolloMembrana.toFixed(2),
    rindeRolloAislacion: d.rindeRolloAislacion.toFixed(2),
    separacionTechoM: d.separacionTechoM.toFixed(2),
    separacionPisoM: d.separacionPisoM.toFixed(2),
    deckGrandisLargoM: d.deckGrandisLargoM.toFixed(2),
    deckGrandisAnchoM: d.deckGrandisAnchoM.toFixed(3),
    deckPvcLargoM: d.deckPvcLargoM.toFixed(2),
    deckPvcAnchoM: d.deckPvcAnchoM.toFixed(3),
    updatedAt: new Date(),
  };

  const [fila] = await db
    .select({ id: calculatorSettings.id })
    .from(calculatorSettings)
    .limit(1);

  if (fila) {
    await db
      .update(calculatorSettings)
      .set(valores)
      .where(eq(calculatorSettings.id, fila.id));
  } else {
    await db.insert(calculatorSettings).values(valores);
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "configuracion",
    descripcion: "Cambió los parámetros de las calculadoras",
  });

  // La calculadora pública se sirve del CDN: sin invalidar, el cambio no se ve.
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/admin/calculadoras");
  revalidatePath("/calculadora");

  return { ok: "Parámetros guardados. La calculadora ya usa estos números." };
}
