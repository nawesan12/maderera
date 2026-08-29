"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { products, relatedProducts } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";

export interface EstadoSugeridos {
  error?: string;
  ok?: string;
}

const altaSchema = z.object({
  productId: z.string().uuid(),
  relatedProductId: z.string().uuid(),
  tipo: z.enum(["complementario", "similar"]),
});

/**
 * Suma un sugerido a la ficha.
 *
 * La relación **no** se guarda en los dos sentidos. Parece simétrica y no lo es:
 * el sellador es complemento del deck, pero el deck no es un complemento del
 * sellador —quien viene a comprar sellador no está por hacer un deck—. Si en
 * algún caso conviene el recíproco, se carga a mano desde la otra ficha.
 */
export async function agregarSugerido(
  _previo: EstadoSugeridos,
  formData: FormData,
): Promise<EstadoSugeridos> {
  const usuario = await requireStaff();

  const parsed = altaSchema.safeParse({
    productId: formData.get("productId"),
    relatedProductId: formData.get("relatedProductId"),
    tipo: formData.get("tipo"),
  });

  if (!parsed.success) return { error: "Elegí un producto de la lista." };

  const { productId, relatedProductId, tipo } = parsed.data;

  if (productId === relatedProductId) {
    return { error: "Un producto no puede sugerirse a sí mismo." };
  }

  const [sugerido] = await db
    .select({ nombre: products.name })
    .from(products)
    .where(eq(products.id, relatedProductId))
    .limit(1);

  if (!sugerido) return { error: "Ese producto ya no existe." };

  // El orden nuevo va al final de su tipo: el vendedor pone primero lo que más
  // se lleva, y una alta no puede reacomodarle la lista.
  const [ultimo] = await db
    .select({ max: sql<number>`coalesce(max(${relatedProducts.orden}), -1)::int` })
    .from(relatedProducts)
    .where(
      and(eq(relatedProducts.productId, productId), eq(relatedProducts.tipo, tipo)),
    );

  const resultado = await db
    .insert(relatedProducts)
    .values({
      productId,
      relatedProductId,
      tipo,
      orden: (ultimo?.max ?? -1) + 1,
    })
    // El índice único cubre (producto, sugerido, tipo): cargar dos veces el
    // mismo no es un error que valga la pena mostrar, simplemente no hace nada.
    .onConflictDoNothing()
    .returning({ id: relatedProducts.id });

  if (resultado.length === 0) {
    return { error: `${sugerido.nombre} ya estaba en la lista.` };
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "producto",
    entidadId: productId,
    descripcion: `Agregó ${sugerido.nombre} como ${tipo}`,
  });

  refrescar(productId);
  return { ok: `${sugerido.nombre} quedó como ${tipo}.` };
}

export async function quitarSugerido(
  _previo: EstadoSugeridos,
  formData: FormData,
): Promise<EstadoSugeridos> {
  const usuario = await requireStaff();

  const parsed = z
    .object({ id: z.string().uuid(), productId: z.string().uuid() })
    .safeParse({
      id: formData.get("id"),
      productId: formData.get("productId"),
    });

  if (!parsed.success) return { error: "No se pudo identificar la relación." };

  // El `productId` va en el `where` además del id propio: sin eso, un id
  // adivinado borraría una relación de otra ficha.
  const borradas = await db
    .delete(relatedProducts)
    .where(
      and(
        eq(relatedProducts.id, parsed.data.id),
        eq(relatedProducts.productId, parsed.data.productId),
      ),
    )
    .returning({ id: relatedProducts.id });

  if (borradas.length === 0) return { error: "Esa relación ya no estaba." };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "producto",
    entidadId: parsed.data.productId,
    descripcion: "Quitó un producto sugerido",
  });

  refrescar(parsed.data.productId);
  return { ok: "Listo." };
}

/** El bloque de sugeridos se ve en la ficha pública, así que hay que refrescarla. */
function refrescar(productId: string) {
  revalidatePath(`/admin/productos/${productId}`);
  revalidatePath("/catalogo", "layout");
}
