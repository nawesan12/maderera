"use server";

import { revalidatePath, updateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bankPromotions } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { ETIQUETAS } from "@/lib/cache-publico";
import { borrarImagen, guardarImagen } from "@/lib/almacenamiento";

export interface EstadoPromo {
  error?: string;
  ok?: string;
}

/**
 * Las promociones se ven en la portada, que está cacheada para todas las
 * visitas. Guardar tiene que invalidarla: la que vence hoy no puede seguir
 * anunciada mañana.
 */
function refrescar() {
  updateTag(ETIQUETAS.contenido);
  revalidatePath("/admin/contenido/promociones");
  revalidatePath("/");
}

const esquema = z.object({
  id: z.string().uuid().optional(),
  medio: z.string().trim().min(2, "Poné con qué se paga.").max(60),
  titulo: z.string().trim().min(2, "Poné el beneficio en una línea.").max(120),
  detalle: z.string().trim().max(600).default(""),
  dias: z.string().trim().max(60).default(""),
  /*
   * Quién pone la plata. Sin valor por defecto **a propósito**: cargar una
   * promoción sin decidirlo es lo que después hace que alguien la descuente en
   * el mostrador creyendo que la paga la maderera, o al revés.
   */
  quienPaga: z.enum(["banco", "nosotros"], {
    message: "Decí quién pone el descuento: el banco o la maderera.",
  }),
  vigenciaHasta: z
    .string()
    .trim()
    .optional()
    // Al final del día: una promo "hasta el 31/10" vale el 31 entero.
    .transform((v) => (v ? new Date(`${v}T23:59:59`) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "Revisá la fecha."),
  orden: z.coerce.number().int().min(0).max(99).default(0),
  activo: z.boolean(),
});

export async function guardarPromo(
  _previo: EstadoPromo,
  formData: FormData,
): Promise<EstadoPromo> {
  const usuario = await requireStaff();

  const parsed = esquema.safeParse({
    id: (formData.get("id") as string) || undefined,
    medio: formData.get("medio"),
    titulo: formData.get("titulo"),
    detalle: (formData.get("detalle") as string) || "",
    dias: (formData.get("dias") as string) || "",
    quienPaga: formData.get("quienPaga"),
    vigenciaHasta: (formData.get("vigenciaHasta") as string) || undefined,
    orden: (formData.get("orden") as string) || 0,
    activo: formData.get("activo") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;

  // El logo del banco. `undefined` quiere decir "no mandaron archivo", que no
  // es lo mismo que "sacaron el logo": sin esta distinción, guardar cualquier
  // otro campo borraría la imagen cargada.
  let imagenUrl: string | null | undefined;
  const archivo = formData.get("imagen");

  if (archivo instanceof File && archivo.size > 0) {
    const subida = await guardarImagen(archivo, "promo");
    if (subida.error) return { error: subida.error };
    imagenUrl = subida.url ?? null;
  }

  if (formData.get("quitarImagen") === "on") imagenUrl = null;

  const valores = {
    medio: datos.medio,
    titulo: datos.titulo,
    detalle: datos.detalle,
    dias: datos.dias,
    quienPaga: datos.quienPaga,
    vigenciaHasta: datos.vigenciaHasta,
    orden: datos.orden,
    activo: datos.activo,
    updatedAt: new Date(),
    ...(imagenUrl !== undefined ? { imagenUrl } : {}),
  };

  if (datos.id) {
    // El logo anterior se borra recién después de guardar el nuevo: si la
    // escritura falla, la promoción sigue con el que tenía.
    const [previa] = await db
      .select({ imagenUrl: bankPromotions.imagenUrl })
      .from(bankPromotions)
      .where(eq(bankPromotions.id, datos.id))
      .limit(1);

    await db
      .update(bankPromotions)
      .set(valores)
      .where(eq(bankPromotions.id, datos.id));

    if (previa?.imagenUrl && previa.imagenUrl !== imagenUrl && imagenUrl !== undefined) {
      await borrarImagen(previa.imagenUrl);
    }
  } else {
    await db.insert(bankPromotions).values(valores);
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: datos.id ? "editar" : "crear",
    entidad: "promo_bancaria",
    entidadId: datos.id ?? null,
    descripcion: `Promoción de ${datos.medio}: "${datos.titulo}"`,
    detalle: valores,
  });

  refrescar();
  return { ok: "Promoción guardada." };
}

/** Se borra de verdad: una promo vencida no es contenido que haya que auditar. */
export async function borrarPromo(id: string): Promise<EstadoPromo> {
  const usuario = await requireStaff();

  const [previa] = await db
    .select({
      medio: bankPromotions.medio,
      titulo: bankPromotions.titulo,
      imagenUrl: bankPromotions.imagenUrl,
    })
    .from(bankPromotions)
    .where(eq(bankPromotions.id, id))
    .limit(1);

  if (!previa) return { error: "Esa promoción ya no está." };

  await db.delete(bankPromotions).where(eq(bankPromotions.id, id));

  if (previa.imagenUrl) await borrarImagen(previa.imagenUrl);

  await registrarEnBitacora({
    sesion: usuario,
    accion: "eliminar",
    entidad: "promo_bancaria",
    entidadId: id,
    descripcion: `Promoción borrada: ${previa.medio} — "${previa.titulo}"`,
  });

  refrescar();
  return { ok: "Promoción borrada." };
}
