import "server-only";

import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { coincideBusqueda } from "@/lib/busqueda";
import { db } from "@/lib/db";
import {
  branches,
  categories,
  inventory,
  priceListItems,
  priceLists,
  productImages,
  productVariants,
  products,
  relatedProducts,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

/**
 * Consultas de gestión de productos.
 *
 * A diferencia de `lib/dal/catalog.ts`, acá se ven las dos listas de precios, las
 * cantidades exactas y los productos dados de baja. Cada función empieza pidiendo
 * sesión de staff: no alcanza con que la página esté detrás del panel, porque
 * estas funciones también se llaman desde Server Actions.
 */

export interface ProductoAdmin {
  id: string;
  slug: string;
  name: string;
  categoryName: string;
  brand: string | null;
  unit: string;
  featured: boolean;
  active: boolean;
  variantes: number;
  stockTotal: number;
  imagen: string | null;
  /** Precio más bajo entre las variantes, para el "desde". */
  precioDesde: string | null;
  sinFoto: boolean;
}

export async function listarProductosAdmin(filtros: {
  busqueda?: string;
  categoria?: string;
} = {}): Promise<ProductoAdmin[]> {
  await requireStaff();

  const condiciones = [];
  if (filtros.categoria && filtros.categoria !== "todos") {
    condiciones.push(eq(categories.slug, filtros.categoria));
  }
  if (filtros.busqueda) {
    const coincidencia = coincideBusqueda(filtros.busqueda, [
      products.name,
      products.brand,
      products.subcategory,
      categories.name,
    ]);
    if (coincidencia) condiciones.push(coincidencia);
  }

  const filas = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      categoryName: categories.name,
      brand: products.brand,
      unit: products.unit,
      featured: products.featured,
      active: products.active,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(products.updatedAt));

  if (filas.length === 0) return [];

  const conteos = await db
    .select({
      productId: productVariants.productId,
      variantes: count(productVariants.id),
    })
    .from(productVariants)
    .where(
      inArray(
        productVariants.productId,
        filas.map((f) => f.id),
      ),
    )
    .groupBy(productVariants.productId);

  const stock = await db
    .select({
      productId: productVariants.productId,
      qty: inventory.qty,
    })
    .from(productVariants)
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(
      inArray(
        productVariants.productId,
        filas.map((f) => f.id),
      ),
    );

  const ids = filas.map((f) => f.id);

  const [portadas, precios] = await Promise.all([
    db
      .select({
        productId: productImages.productId,
        url: productImages.url,
        sortOrder: productImages.sortOrder,
      })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.sortOrder)),
    db
      .select({
        productId: productVariants.productId,
        price: priceListItems.price,
      })
      .from(productVariants)
      .innerJoin(
        priceListItems,
        eq(priceListItems.variantId, productVariants.id),
      )
      .innerJoin(
        priceLists,
        and(
          eq(priceLists.id, priceListItems.priceListId),
          eq(priceLists.isDefault, true),
        ),
      )
      .where(inArray(productVariants.productId, ids)),
  ]);

  const portadaPorProducto = new Map<string, string>();
  for (const p of portadas) {
    if (!portadaPorProducto.has(p.productId)) {
      portadaPorProducto.set(p.productId, p.url);
    }
  }

  const precioPorProducto = new Map<string, number>();
  for (const p of precios) {
    const valor = Number(p.price);
    if (!Number.isFinite(valor) || valor <= 0) continue;
    const actual = precioPorProducto.get(p.productId);
    if (actual === undefined || valor < actual) {
      precioPorProducto.set(p.productId, valor);
    }
  }

  const variantesPorProducto = new Map(
    conteos.map((c) => [c.productId, c.variantes]),
  );
  const stockPorProducto = new Map<string, number>();
  for (const s of stock) {
    stockPorProducto.set(
      s.productId,
      (stockPorProducto.get(s.productId) ?? 0) + (s.qty ?? 0),
    );
  }

  return filas.map((f) => {
    const precio = precioPorProducto.get(f.id);
    const imagen = portadaPorProducto.get(f.id) ?? null;

    return {
      ...f,
      variantes: variantesPorProducto.get(f.id) ?? 0,
      stockTotal: stockPorProducto.get(f.id) ?? 0,
      imagen,
      precioDesde: precio !== undefined ? String(precio) : null,
      sinFoto: imagen === null,
    };
  });
}

/** Producto completo para el formulario de edición. */
export async function obtenerProductoAdmin(id: string) {
  await requireStaff();

  const [producto] = await db
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1);

  if (!producto) return null;

  const [imagenes, variantes, listas, sucursales] = await Promise.all([
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.sortOrder)),
    db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))
      .orderBy(asc(productVariants.sortOrder)),
    db.select().from(priceLists),
    db.select().from(branches).orderBy(asc(branches.sortOrder)),
  ]);

  const ids = variantes.map((v) => v.id);

  const [precios, stock] = await Promise.all([
    ids.length > 0
      ? db
          .select()
          .from(priceListItems)
          .where(inArray(priceListItems.variantId, ids))
      : Promise.resolve([]),
    ids.length > 0
      ? db.select().from(inventory).where(inArray(inventory.variantId, ids))
      : Promise.resolve([]),
  ]);

  const listaGeneral = listas.find((l) => l.isDefault);
  const listaProfesional = listas.find((l) => l.slug === "profesional");
  const central = sucursales.find((s) => s.slug === "casa-central");
  const aserradero = sucursales.find((s) => s.slug === "aserradero");

  return {
    ...producto,
    imagen: imagenes[0]?.url ?? "",
    galeria: imagenes.map((i) => ({ id: i.id, url: i.url, alt: i.alt })),
    variantes: variantes.map((v) => ({
      id: v.id,
      sku: v.sku,
      label: v.label,
      largoMm: v.largoMm,
      anchoMm: v.anchoMm,
      espesorMm: v.espesorMm,
      material: v.material ?? "",
      color: v.color ?? "",
      precioGeneral:
        precios.find(
          (p) => p.variantId === v.id && p.priceListId === listaGeneral?.id,
        )?.price ?? "0",
      precioProfesional:
        precios.find(
          (p) => p.variantId === v.id && p.priceListId === listaProfesional?.id,
        )?.price ?? "0",
      stockCentral:
        stock.find((s) => s.variantId === v.id && s.branchId === central?.id)
          ?.qty ?? 0,
      stockAserradero:
        stock.find((s) => s.variantId === v.id && s.branchId === aserradero?.id)
          ?.qty ?? 0,
      minCentral:
        stock.find((s) => s.variantId === v.id && s.branchId === central?.id)
          ?.minQty ?? 0,
      minAserradero:
        stock.find((s) => s.variantId === v.id && s.branchId === aserradero?.id)
          ?.minQty ?? 0,
    })),
  };
}

export async function listarCategoriasAdmin() {
  await requireStaff();
  return db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .orderBy(asc(categories.sortOrder));
}

/* -------------------------------------------------------------------------- */
/* Productos sugeridos                                                         */
/* -------------------------------------------------------------------------- */

export interface SugeridoCargado {
  id: string;
  relatedProductId: string;
  nombre: string;
  categoria: string;
  imagen: string | null;
  activo: boolean;
  tipo: "complementario" | "similar";
  orden: number;
}

/** Los sugeridos ya cargados de un producto, con lo justo para listarlos. */
export async function sugeridosDelProducto(
  productId: string,
): Promise<SugeridoCargado[]> {
  await requireStaff();

  const sugerido = alias(products, "sugerido");

  const filas = await db
    .select({
      id: relatedProducts.id,
      relatedProductId: relatedProducts.relatedProductId,
      nombre: sugerido.name,
      categoria: categories.name,
      activo: sugerido.active,
      tipo: relatedProducts.tipo,
      orden: relatedProducts.orden,
    })
    .from(relatedProducts)
    .innerJoin(sugerido, eq(sugerido.id, relatedProducts.relatedProductId))
    .leftJoin(categories, eq(categories.id, sugerido.categoryId))
    .where(eq(relatedProducts.productId, productId))
    .orderBy(asc(relatedProducts.tipo), asc(relatedProducts.orden));

  if (filas.length === 0) return [];

  const imagenes = await db
    .select({ productId: productImages.productId, url: productImages.url })
    .from(productImages)
    .where(
      inArray(
        productImages.productId,
        filas.map((f) => f.relatedProductId),
      ),
    )
    .orderBy(asc(productImages.sortOrder));

  const primera = new Map<string, string>();
  for (const img of imagenes) {
    if (!primera.has(img.productId)) primera.set(img.productId, img.url);
  }

  return filas.map((f) => ({
    ...f,
    categoria: f.categoria ?? "Sin categoría",
    imagen: primera.get(f.relatedProductId) ?? null,
  }));
}

/**
 * Candidatos para el buscador de sugeridos.
 *
 * Devuelve nombre y categoría de todos los productos activos menos el propio.
 * Son un par de cientos de filas de texto corto: se mandan enteras y el filtrado
 * pasa en el navegador, que responde a cada tecla sin ida y vuelta al servidor.
 * Con miles de productos esto habría que darlo vuelta.
 */
export async function candidatosParaSugerir(productId: string) {
  await requireStaff();

  return db
    .select({
      id: products.id,
      nombre: products.name,
      categoria: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.active, true), ne(products.id, productId)))
    .orderBy(asc(products.name));
}
