"use server";

import { revalidatePath, updateTag } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { products, subcategories } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { ETIQUETAS } from "@/lib/cache-publico";
import { generarSlug } from "@/lib/validation/product";

export interface EstadoRubros {
  error?: string;
  ok?: string;
}

function refrescar() {
  // `updateTag` y no `revalidateTag`, igual que en el alta de productos: quien
  // acaba de cargar un rubro tiene que verlo en el catálogo al volver, no en la
  // visita siguiente.
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/admin/productos/rubros");
  revalidatePath("/admin/productos");
  revalidatePath("/catalogo");
}

/**
 * Alta de un rubro.
 *
 * El slug se deriva del nombre y no se pide: es lo que viaja en la URL del
 * catálogo, y dejarlo escribir a mano garantiza que en algún momento haya dos
 * rubros con el mismo.
 */
export async function guardarRubro(
  _previo: EstadoRubros,
  formData: FormData,
): Promise<EstadoRubros> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      categoryId: z.string().uuid("Elegí una categoría."),
      name: z.string().trim().min(2, "El nombre es muy corto.").max(80),
    })
    .safeParse({
      categoryId: formData.get("categoryId"),
      name: formData.get("name"),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const slug = generarSlug(parsed.data.name);
  if (!slug) return { error: "Ese nombre no deja armar una dirección web." };

  const [existe] = await db
    .select({ id: subcategories.id })
    .from(subcategories)
    .where(
      and(
        eq(subcategories.categoryId, parsed.data.categoryId),
        eq(subcategories.slug, slug),
      ),
    )
    .limit(1);

  if (existe) return { error: "Esa categoría ya tiene un rubro con ese nombre." };

  // Al final de la lista: el orden lo acomoda después quien lo necesite, y
  // meterlo al principio movería de lugar todo lo que ya estaba.
  const [{ maximo }] = await db
    .select({ maximo: sql<number>`coalesce(max(${subcategories.sortOrder}), -1)` })
    .from(subcategories)
    .where(eq(subcategories.categoryId, parsed.data.categoryId));

  await db.insert(subcategories).values({
    categoryId: parsed.data.categoryId,
    slug,
    name: parsed.data.name,
    sortOrder: Number(maximo) + 1,
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "producto",
    descripcion: `Creó el rubro "${parsed.data.name}"`,
  });

  refrescar();

  return { ok: "Rubro agregado." };
}

/**
 * Baja y alta de un rubro.
 *
 * Es baja lógica y no borrado: un rubro con productos adentro no se puede
 * borrar sin dejarlos huérfanos, y el histórico de por qué algo estaba en un
 * rubro se pierde. Dado de baja, deja de aparecer en el catálogo y los
 * productos siguen apuntando a él.
 */
export async function alternarRubro(
  _previo: EstadoRubros,
  formData: FormData,
): Promise<EstadoRubros> {
  const usuario = await requireStaff();

  const parsed = z
    .object({ id: z.string().uuid(), activo: z.enum(["si", "no"]) })
    .safeParse({ id: formData.get("id"), activo: formData.get("activo") });

  if (!parsed.success) return { error: "Rubro inválido." };

  const activo = parsed.data.activo === "si";

  const [fila] = await db
    .update(subcategories)
    .set({ active: activo, updatedAt: new Date() })
    .where(eq(subcategories.id, parsed.data.id))
    .returning({ name: subcategories.name });

  if (!fila) return { error: "Ese rubro no existe." };

  await registrarEnBitacora({
    sesion: usuario,
    accion: activo ? "editar" : "eliminar",
    entidad: "producto",
    entidadId: parsed.data.id,
    descripcion: `${activo ? "Reactivó" : "Dio de baja"} el rubro "${fila.name}"`,
  });

  refrescar();

  return { ok: activo ? "Rubro reactivado." : "Rubro dado de baja." };
}

/**
 * Engancha los productos que nombran el rubro como texto y todavía no lo
 * tienen asignado.
 *
 * Es el puente entre lo viejo y lo nuevo: la subcategoría era texto libre en
 * cada producto, y hacerlo a mano para doscientos productos queda a medias.
 */
export async function engancharPorTexto(
  _previo: EstadoRubros,
  formData: FormData,
): Promise<EstadoRubros> {
  await requireStaff();

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Rubro inválido." };

  const [rubro] = await db
    .select({
      id: subcategories.id,
      name: subcategories.name,
      categoryId: subcategories.categoryId,
    })
    .from(subcategories)
    .where(eq(subcategories.id, id.data))
    .limit(1);

  if (!rubro) return { error: "Ese rubro no existe." };

  const { rowCount } = await db
    .update(products)
    .set({ subcategoryId: rubro.id, updatedAt: new Date() })
    .where(
      and(
        eq(products.categoryId, rubro.categoryId),
        sql`${products.subcategoryId} is null`,
        sql`lower(unaccent(${products.subcategory})) = lower(unaccent(${rubro.name}))`,
      ),
    );

  refrescar();

  return rowCount
    ? { ok: `${rowCount} producto${rowCount === 1 ? "" : "s"} enganchado${rowCount === 1 ? "" : "s"} a "${rubro.name}".` }
    : { ok: `No quedaba ningún producto suelto que dijera "${rubro.name}".` };
}
