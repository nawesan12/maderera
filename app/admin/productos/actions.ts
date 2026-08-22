"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  inventory,
  inventoryMovements,
  priceListItems,
  priceLists,
  productImages,
  productVariants,
  products,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { productoSchema } from "@/lib/validation/product";

export interface EstadoFormulario {
  error?: string;
  campo?: string;
}

/** Lee el formulario, que manda las variantes como JSON en un campo oculto. */
function parsearFormulario(formData: FormData) {
  const variantesCrudas = formData.get("variantes");

  return productoSchema.safeParse({
    id: (formData.get("id") as string) || undefined,
    name: formData.get("name"),
    slug: formData.get("slug"),
    categoryId: formData.get("categoryId"),
    subcategory: (formData.get("subcategory") as string) || undefined,
    description: formData.get("description") ?? "",
    brand: (formData.get("brand") as string) || undefined,
    unit: formData.get("unit"),
    featured: formData.get("featured") === "on",
    active: formData.get("active") === "on",
    imagen: formData.get("imagen") ?? "",
    variantes: variantesCrudas ? JSON.parse(variantesCrudas as string) : [],
  });
}

export async function guardarProducto(
  _previo: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const usuario = await requireStaff();

  const parsed = parsearFormulario(formData);
  if (!parsed.success) {
    const primero = parsed.error.issues[0];
    return {
      error: primero?.message ?? "Revisá los datos del formulario.",
      campo: primero?.path.join("."),
    };
  }

  const datos = parsed.data;

  // El slug viaja en la URL pública, así que dos productos no pueden compartirlo.
  const [choque] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.slug, datos.slug))
    .limit(1);

  if (choque && choque.id !== datos.id) {
    return {
      error: "Ya hay otro producto con esa dirección web. Cambiá el nombre o el slug.",
      campo: "slug",
    };
  }

  let productoId = datos.id;

  await db.transaction(async (tx) => {
    const [listaGeneral] = await tx
      .select()
      .from(priceLists)
      .where(eq(priceLists.isDefault, true))
      .limit(1);
    const [listaProfesional] = await tx
      .select()
      .from(priceLists)
      .where(eq(priceLists.slug, "profesional"))
      .limit(1);
    const sucursales = await tx.select().from(branches);
    const central = sucursales.find((s) => s.slug === "casa-central");
    const aserradero = sucursales.find((s) => s.slug === "aserradero");

    const camposProducto = {
      name: datos.name,
      slug: datos.slug,
      categoryId: datos.categoryId,
      subcategory: datos.subcategory || null,
      description: datos.description,
      brand: datos.brand || null,
      unit: datos.unit,
      featured: datos.featured,
      active: datos.active,
      updatedAt: new Date(),
    };

    if (productoId) {
      await tx
        .update(products)
        .set(camposProducto)
        .where(eq(products.id, productoId));
    } else {
      const [creado] = await tx
        .insert(products)
        .values(camposProducto)
        .returning({ id: products.id });
      productoId = creado.id;
    }

    // Las fotos se administran desde la galería, con sus propias acciones. Acá
    // solo se guarda la primera de un producto recién creado que haya llegado
    // con una imagen: borrar y reinsertar en cada guardado se llevaba puesta la
    // galería entera cada vez que se corregía una coma en la descripción.
    if (!datos.id && datos.imagen) {
      await tx.insert(productImages).values({
        productId: productoId,
        url: datos.imagen,
        alt: datos.name,
      });
    }

    const idsEnviados = datos.variantes
      .map((v) => v.id)
      .filter((id): id is string => Boolean(id));

    // Las variantes que ya no vienen en el formulario se dan de baja en lugar de
    // borrarse: pueden estar referenciadas por presupuestos o facturas viejas.
    const existentes = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.productId, productoId));

    const aDesactivar = existentes
      .map((e) => e.id)
      .filter((id) => !idsEnviados.includes(id));

    if (aDesactivar.length > 0) {
      await tx
        .update(productVariants)
        .set({ active: false, updatedAt: new Date() })
        .where(inArray(productVariants.id, aDesactivar));
    }

    for (const [orden, variante] of datos.variantes.entries()) {
      const campos = {
        productId: productoId,
        sku: variante.sku,
        label: variante.label,
        largoMm: variante.largoMm,
        anchoMm: variante.anchoMm,
        espesorMm: variante.espesorMm,
        material: variante.material || null,
        color: variante.color || null,
        sortOrder: orden,
        active: true,
        updatedAt: new Date(),
      };

      let varianteId = variante.id;

      if (varianteId) {
        await tx
          .update(productVariants)
          .set(campos)
          .where(eq(productVariants.id, varianteId));
      } else {
        const [creada] = await tx
          .insert(productVariants)
          .values(campos)
          .returning({ id: productVariants.id });
        varianteId = creada.id;
      }

      // Precios: uno por lista.
      for (const [lista, precio] of [
        [listaGeneral, variante.precioGeneral],
        [listaProfesional, variante.precioProfesional],
      ] as const) {
        if (!lista) continue;
        await tx
          .insert(priceListItems)
          .values({
            priceListId: lista.id,
            variantId: varianteId,
            price: precio,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [priceListItems.priceListId, priceListItems.variantId],
            set: { price: precio, updatedAt: new Date() },
          });
      }

      // Stock: la diferencia contra lo que había queda registrada como ajuste,
      // para que el inventario siempre tenga una explicación.
      for (const [sucursal, cantidad, minimo] of [
        [central, variante.stockCentral ?? 0, variante.minCentral ?? 0],
        [aserradero, variante.stockAserradero ?? 0, variante.minAserradero ?? 0],
      ] as const) {
        if (!sucursal) continue;

        const [previo] = await tx
          .select({ qty: inventory.qty })
          .from(inventory)
          .where(
            and(
              eq(inventory.variantId, varianteId),
              eq(inventory.branchId, sucursal.id),
            ),
          )
          .limit(1);

        const anterior = previo?.qty ?? 0;

        await tx
          .insert(inventory)
          .values({
            variantId: varianteId,
            branchId: sucursal.id,
            qty: cantidad,
            minQty: minimo,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [inventory.variantId, inventory.branchId],
            set: { qty: cantidad, minQty: minimo, updatedAt: new Date() },
          });

        if (cantidad !== anterior) {
          await tx.insert(inventoryMovements).values({
            variantId: varianteId,
            branchId: sucursal.id,
            type: "ajuste",
            qty: cantidad - anterior,
            note: `Ajuste manual desde la ficha del producto (${anterior} → ${cantidad})`,
            createdByUserId: usuario.userId,
          });
        }
      }
    }
  });

  revalidatePath("/catalogo");
  revalidatePath("/stock");
  revalidatePath("/admin/productos");
  redirect("/admin/productos?guardado=1");
}

/** Baja lógica: el producto desaparece del sitio pero queda en el historial. */
export async function alternarActivo(id: string, activo: boolean) {
  await requireStaff();

  await db
    .update(products)
    .set({ active: activo, updatedAt: new Date() })
    .where(eq(products.id, id));

  revalidatePath("/catalogo");
  revalidatePath("/admin/productos");
}
