"use server";

import { revalidatePath, updateTag } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { productReviews, products } from "@/lib/db/schema";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { puedeResenar } from "@/lib/dal/resenas";
import { ETIQUETAS } from "@/lib/cache-publico";

export interface EstadoResena {
  error?: string;
  ok?: string;
}

const esquema = z.object({
  productId: z.string().uuid(),
  orderId: z.string().uuid(),
  estrellas: z.coerce
    .number()
    .int()
    .min(1, "Elegí de una a cinco estrellas.")
    .max(5, "Elegí de una a cinco estrellas."),
  texto: z.string().trim().max(1000, "Quedó muy largo.").optional(),
});

/**
 * Deja una reseña de un producto comprado.
 *
 * **Nace pendiente.** Una reseña es un texto de un tercero que aparece firmado
 * en el sitio: el día que entre un insulto o el teléfono de un competidor, va a
 * estar ahí hasta que alguien de la casa lo vea. Publicarla sola ahorra un
 * clic y cuesta eso.
 *
 * La verificación de que compró se rehace acá contra la base. La pantalla ya
 * filtra qué se puede reseñar, pero el formulario manda ids: sin este control,
 * cualquiera con sesión reseña cualquier producto cambiando un campo oculto.
 */
export async function dejarResena(
  _previo: EstadoResena,
  formData: FormData,
): Promise<EstadoResena> {
  const cliente = await clienteDeLaSesion();

  if (!cliente) {
    return { error: "Entrá con tu cuenta para dejar una reseña." };
  }

  const parsed = esquema.safeParse({
    productId: formData.get("productId"),
    orderId: formData.get("orderId"),
    estrellas: formData.get("estrellas"),
    texto: (formData.get("texto") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const { productId, orderId, estrellas, texto } = parsed.data;

  const habilitado = await puedeResenar(cliente.id, orderId, productId);

  if (!habilitado) {
    return {
      error:
        "Solo se pueden reseñar los productos de un pedido que ya recibiste.",
    };
  }

  const [yaEstaba] = await db
    .select({ id: productReviews.id })
    .from(productReviews)
    .where(
      and(
        eq(productReviews.orderId, orderId),
        eq(productReviews.productId, productId),
      ),
    )
    .limit(1);

  if (yaEstaba) {
    return { error: "Ya dejaste una reseña de este producto en esa compra." };
  }

  await db.insert(productReviews).values({
    productId,
    customerId: cliente.id,
    orderId,
    estrellas,
    texto: texto ?? "",
    nombre: cliente.nombre,
  });

  const [producto] = await db
    .select({ slug: products.slug })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  revalidatePath("/mi-cuenta/resenas");
  revalidatePath("/admin/contenido");
  if (producto) revalidatePath(`/catalogo/${producto.slug}`);
  updateTag(ETIQUETAS.catalogo);

  return {
    ok: "Gracias. La publicamos apenas la revisemos.",
  };
}
