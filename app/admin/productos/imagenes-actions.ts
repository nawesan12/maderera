"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { productImages } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { borrarImagen, guardarImagen } from "@/lib/almacenamiento";

export interface ResultadoImagen {
  error?: string;
  url?: string;
  id?: string;
}

function refrescar(productId?: string) {
  revalidatePath("/admin/productos");
  if (productId) revalidatePath(`/admin/productos/${productId}`);
  revalidatePath("/catalogo");
}

/**
 * Sube una foto y la agrega a la galería del producto.
 *
 * La primera que se sube queda como principal, que es la que se ve en el
 * catálogo y en los listados.
 */
export async function subirImagen(formData: FormData): Promise<ResultadoImagen> {
  await requireStaff();

  const archivo = formData.get("archivo");
  const productId = formData.get("productId");

  if (!(archivo instanceof File)) return { error: "Elegí una imagen." };
  if (typeof productId !== "string" || !productId) {
    return { error: "Falta el producto." };
  }

  const guardado = await guardarImagen(archivo, "producto");
  if (guardado.error || !guardado.url) {
    return { error: guardado.error ?? "No se pudo guardar la imagen." };
  }

  const [{ siguiente }] = await db
    .select({
      siguiente: sql<number>`coalesce(max(${productImages.sortOrder}), -1) + 1`,
    })
    .from(productImages)
    .where(eq(productImages.productId, productId));

  const [creada] = await db
    .insert(productImages)
    .values({
      productId,
      url: guardado.url,
      sortOrder: siguiente,
    })
    .returning({ id: productImages.id });

  refrescar(productId);
  return { url: guardado.url, id: creada.id };
}

export async function eliminarImagen(
  imagenId: string,
): Promise<ResultadoImagen> {
  await requireStaff();

  const [imagen] = await db
    .select()
    .from(productImages)
    .where(eq(productImages.id, imagenId))
    .limit(1);

  if (!imagen) return { error: "Esa imagen ya no está." };

  await db.delete(productImages).where(eq(productImages.id, imagenId));
  await borrarImagen(imagen.url);

  refrescar(imagen.productId);
  return {};
}

/**
 * Mueve una imagen a la primera posición.
 *
 * Se reordena todo el conjunto en una transacción en lugar de intercambiar dos
 * filas: así el orden queda siempre 0, 1, 2… sin huecos ni empates.
 */
export async function hacerPrincipal(
  imagenId: string,
): Promise<ResultadoImagen> {
  await requireStaff();

  const [imagen] = await db
    .select()
    .from(productImages)
    .where(eq(productImages.id, imagenId))
    .limit(1);

  if (!imagen) return { error: "Esa imagen ya no está." };

  await db.transaction(async (tx) => {
    const todas = await tx
      .select({ id: productImages.id })
      .from(productImages)
      .where(eq(productImages.productId, imagen.productId))
      .orderBy(asc(productImages.sortOrder));

    const ordenado = [
      imagenId,
      ...todas.map((i) => i.id).filter((id) => id !== imagenId),
    ];

    for (const [posicion, id] of ordenado.entries()) {
      await tx
        .update(productImages)
        .set({ sortOrder: posicion })
        .where(
          and(
            eq(productImages.id, id),
            eq(productImages.productId, imagen.productId),
          ),
        );
    }
  });

  refrescar(imagen.productId);
  return {};
}
