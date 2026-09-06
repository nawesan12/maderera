"use server";

import { revalidatePath, updateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { banners } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { ETIQUETAS } from "@/lib/cache-publico";
import { borrarImagen, guardarImagen } from "@/lib/almacenamiento";

export interface EstadoBanner {
  error?: string;
  ok?: string;
}

/**
 * Un banner se ve en la portada y en el catálogo, y los dos están cacheados
 * para todas las visitas. Guardar tiene que invalidarlos: un aviso que aparece
 * cinco minutos tarde es tolerable, uno que aparece al día siguiente no sirve
 * para anunciar una promoción de fin de semana.
 */
function refrescar() {
  updateTag(ETIQUETAS.contenido);
  revalidatePath("/admin/contenido/banners");
  revalidatePath("/");
  revalidatePath("/catalogo");
}

/** Fecha de un `input type="date"`, o null. */
const fecha = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? new Date(`${v}T00:00:00`) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), "Revisá la fecha.");

const esquema = z.object({
  id: z.string().uuid().optional(),
  ubicacion: z.enum(["franja", "portada", "catalogo"]),
  etiqueta: z.string().trim().max(30).default(""),
  titulo: z.string().trim().min(2, "Poné el texto del aviso.").max(120),
  bajada: z.string().trim().max(200).default(""),
  enlace: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  textoEnlace: z.string().trim().max(40).default(""),
  desde: fecha,
  hasta: fecha,
  orden: z.coerce.number().int().min(0).max(99).default(0),
  activo: z.boolean(),
});

export async function guardarBanner(
  _previo: EstadoBanner,
  formData: FormData,
): Promise<EstadoBanner> {
  const usuario = await requireStaff();

  const parsed = esquema.safeParse({
    id: (formData.get("id") as string) || undefined,
    ubicacion: formData.get("ubicacion"),
    etiqueta: (formData.get("etiqueta") as string) || "",
    titulo: formData.get("titulo"),
    bajada: (formData.get("bajada") as string) || "",
    enlace: (formData.get("enlace") as string) || undefined,
    textoEnlace: (formData.get("textoEnlace") as string) || "",
    desde: (formData.get("desde") as string) || undefined,
    hasta: (formData.get("hasta") as string) || undefined,
    orden: (formData.get("orden") as string) || 0,
    activo: formData.get("activo") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;

  // Una promoción que termina antes de empezar no se muestra nunca, y quien la
  // cargó se entera recién cuando pregunta por qué no sale.
  if (datos.desde && datos.hasta && datos.hasta < datos.desde) {
    return { error: "La fecha de fin es anterior a la de inicio." };
  }

  let imagenUrl: string | null | undefined;
  const archivo = formData.get("imagen");

  if (archivo instanceof File && archivo.size > 0) {
    const subida = await guardarImagen(archivo, "banner");
    if (subida.error) return { error: subida.error };
    imagenUrl = subida.url ?? null;
  }

  const valores = {
    ubicacion: datos.ubicacion,
    etiqueta: datos.etiqueta,
    titulo: datos.titulo,
    bajada: datos.bajada,
    enlace: datos.enlace,
    textoEnlace: datos.textoEnlace,
    desde: datos.desde,
    hasta: datos.hasta,
    orden: datos.orden,
    activo: datos.activo,
    updatedAt: new Date(),
    ...(imagenUrl !== undefined ? { imagenUrl } : {}),
  };

  if (datos.id) {
    // La imagen anterior se borra recién después de guardar la nueva: si la
    // escritura falla, el banner sigue con la que tenía.
    const [previo] = await db
      .select({ imagenUrl: banners.imagenUrl })
      .from(banners)
      .where(eq(banners.id, datos.id))
      .limit(1);

    await db.update(banners).set(valores).where(eq(banners.id, datos.id));

    if (imagenUrl && previo?.imagenUrl && previo.imagenUrl !== imagenUrl) {
      await borrarImagen(previo.imagenUrl);
    }
  } else {
    await db.insert(banners).values(valores);
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: datos.id ? "editar" : "crear",
    entidad: "banner",
    entidadId: datos.id ?? null,
    descripcion: `Banner en ${datos.ubicacion}: "${datos.titulo}"`,
    detalle: valores,
  });

  refrescar();
  return { ok: "Banner guardado." };
}

/** Baja un banner. Se borra de verdad: no es contenido que haya que auditar. */
export async function borrarBanner(id: string): Promise<EstadoBanner> {
  const usuario = await requireStaff();

  const [previo] = await db
    .select({ titulo: banners.titulo, imagenUrl: banners.imagenUrl })
    .from(banners)
    .where(eq(banners.id, id))
    .limit(1);

  if (!previo) return { error: "Ese banner ya no está." };

  await db.delete(banners).where(eq(banners.id, id));
  if (previo.imagenUrl) await borrarImagen(previo.imagenUrl);

  await registrarEnBitacora({
    sesion: usuario,
    accion: "eliminar",
    entidad: "banner",
    entidadId: id,
    descripcion: `Banner borrado: "${previo.titulo}"`,
  });

  refrescar();
  return { ok: "Banner borrado." };
}
