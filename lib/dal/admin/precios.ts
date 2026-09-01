import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  categories,
  productImages,
  priceHistory,
  priceListItems,
  priceLists,
  productVariants,
  products,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { coincideBusqueda } from "@/lib/busqueda";

export interface FilaPrecio {
  variantId: string;
  productId: string;
  sku: string;
  producto: string;
  medida: string;
  categoria: string;
  categoriaSlug: string;
  unidad: string;
  imagen: string | null;
  precioGeneral: string;
  precioProfesional: string;
  /** Cuánto más barato es el precio profesional, en porcentaje. */
  brecha: number | null;
  /** Cuándo se tocó por última vez, para ver qué quedó viejo. */
  actualizado: Date | null;
  /**
   * Si el precio quedó viejo y conviene revisarlo.
   *
   * El criterio vive acá y no en la pantalla por dos razones: es una decisión
   * de negocio —cada cuánto se considera desactualizado un precio— y depende de
   * la hora actual, que leída durante el render de un Server Component es una
   * impureza. Acá se calcula una sola vez, al armar los datos.
   */
  desactualizado: boolean;
}

/** Días sin cambios a partir de los cuales un precio entra en la lista a revisar. */
export const DIAS_PARA_REVISAR = 60;

export async function listarPrecios(
  filtros: { busqueda?: string; categoria?: string } = {},
): Promise<FilaPrecio[]> {
  await requireStaff();

  const listas = await db.select().from(priceLists);
  const general = listas.find((l) => l.isDefault);
  const profesional = listas.find((l) => l.slug === "profesional");

  const limiteDeRevision =
    Date.now() - DIAS_PARA_REVISAR * 24 * 60 * 60 * 1000;

  const condiciones = [
    eq(products.active, true),
    eq(productVariants.active, true),
  ];

  if (filtros.categoria && filtros.categoria !== "todos") {
    condiciones.push(eq(categories.slug, filtros.categoria));
  }
  if (filtros.busqueda) {
    const coincidencia = coincideBusqueda(filtros.busqueda, [
      products.name,
      productVariants.sku,
      productVariants.label,
      products.brand,
      categories.name,
    ]);
    if (coincidencia) condiciones.push(coincidencia);
  }

  const filas = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      sku: productVariants.sku,
      producto: products.name,
      medida: productVariants.label,
      categoria: categories.name,
      categoriaSlug: categories.slug,
      unidad: products.unit,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...condiciones))
    .orderBy(asc(categories.sortOrder), asc(products.name), asc(productVariants.sortOrder));

  if (filas.length === 0) return [];

  const portadas = await db
    .select({
      productId: productImages.productId,
      url: productImages.url,
    })
    .from(productImages)
    .where(
      inArray(productImages.productId, [
        ...new Set(filas.map((f) => f.productId)),
      ]),
    )
    .orderBy(asc(productImages.sortOrder));

  const portadaPorProducto = new Map<string, string>();
  for (const p of portadas) {
    if (!portadaPorProducto.has(p.productId)) {
      portadaPorProducto.set(p.productId, p.url);
    }
  }

  const precios = await db
    .select({
      variantId: priceListItems.variantId,
      priceListId: priceListItems.priceListId,
      price: priceListItems.price,
      updatedAt: priceListItems.updatedAt,
    })
    .from(priceListItems)
    .where(
      inArray(
        priceListItems.variantId,
        filas.map((f) => f.variantId),
      ),
    );

  const buscar = (variantId: string, listaId?: string) =>
    precios.find((p) => p.variantId === variantId && p.priceListId === listaId)
      ?.price ?? "0";

  return filas.map((fila) => {
    const precioGeneral = buscar(fila.variantId, general?.id);
    const precioProfesional = buscar(fila.variantId, profesional?.id);
    const g = Number(precioGeneral);
    const p = Number(precioProfesional);

    const fechas = precios
      .filter((x) => x.variantId === fila.variantId)
      .map((x) => x.updatedAt)
      .filter((f): f is Date => f !== null);

    const actualizado =
      fechas.length > 0
        ? new Date(Math.max(...fechas.map((f) => f.getTime())))
        : null;

    return {
      ...fila,
      imagen: portadaPorProducto.get(fila.productId) ?? null,
      precioGeneral,
      precioProfesional,
      brecha: g > 0 && p > 0 ? Math.round((1 - p / g) * 1000) / 10 : null,
      actualizado,
      desactualizado:
        g > 0 && (actualizado === null || actualizado.getTime() < limiteDeRevision),
    };
  });
}

/** Últimos cambios de precio, para saber qué se tocó y cuándo. */
export async function historialDePrecios(limite = 40) {
  await requireStaff();

  return db
    .select({
      id: priceHistory.id,
      sku: productVariants.sku,
      producto: products.name,
      medida: productVariants.label,
      lista: priceLists.name,
      precioAnterior: priceHistory.precioAnterior,
      precioNuevo: priceHistory.precioNuevo,
      origen: priceHistory.origen,
      motivo: priceHistory.motivo,
      createdAt: priceHistory.createdAt,
    })
    .from(priceHistory)
    .innerJoin(productVariants, eq(productVariants.id, priceHistory.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(priceLists, eq(priceLists.id, priceHistory.priceListId))
    .orderBy(desc(priceHistory.createdAt))
    .limit(limite);
}

export async function listarListasDePrecios() {
  await requireStaff();
  return db.select().from(priceLists).orderBy(desc(priceLists.isDefault));
}
