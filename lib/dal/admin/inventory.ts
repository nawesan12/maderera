import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { coincideBusqueda } from "@/lib/busqueda";
import { db } from "@/lib/db";
import {
  branches,
  categories,
  inventory,
  inventoryMovements,
  productImages,
  productVariants,
  products,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { disponible, stockLevel, type StockLevel } from "@/lib/stock-level";

export interface FilaStock {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  label: string;
  sku: string;
  categoryName: string;
  unidad: string;
  imagen: string | null;
  qtyCentral: number;
  qtyAserradero: number;
  /** Comprometido en pedidos que todavía no se retiraron. */
  reservadoCentral: number;
  reservadoAserradero: number;
  minCentral: number;
  minAserradero: number;
  nivelCentral: StockLevel;
  nivelAserradero: StockLevel;
  /** Total entre las dos sucursales, que es lo que hay en la empresa. */
  total: number;
}

/** Inventario por variante, que es la unidad real de stock. */
export async function listarStock(filtros: {
  busqueda?: string;
  categoria?: string;
} = {}): Promise<FilaStock[]> {
  await requireStaff();

  const condiciones = [eq(products.active, true), eq(productVariants.active, true)];

  if (filtros.categoria && filtros.categoria !== "todos") {
    condiciones.push(eq(categories.slug, filtros.categoria));
  }
  if (filtros.busqueda) {
    const coincidencia = coincideBusqueda(filtros.busqueda, [
      products.name,
      productVariants.sku,
      productVariants.label,
      productVariants.material,
      categories.name,
    ]);
    if (coincidencia) condiciones.push(coincidencia);
  }

  const filas = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      label: productVariants.label,
      sku: productVariants.sku,
      categoryName: categories.name,
      unidad: products.unit,
      branchSlug: branches.slug,
      qty: inventory.qty,
      reservado: inventory.reservado,
      minQty: inventory.minQty,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .leftJoin(branches, eq(branches.id, inventory.branchId))
    .where(and(...condiciones))
    .orderBy(asc(products.name), asc(productVariants.sortOrder));

  // Portada de cada producto, para que el stock se reconozca por la foto y no
  // solo por el nombre: en una lista de placas todas se llaman parecido.
  const portadas =
    filas.length > 0
      ? await db
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
          .orderBy(asc(productImages.sortOrder))
      : [];

  const portadaPorProducto = new Map<string, string>();
  for (const p of portadas) {
    if (!portadaPorProducto.has(p.productId)) {
      portadaPorProducto.set(p.productId, p.url);
    }
  }

  const porVariante = new Map<string, FilaStock>();

  for (const fila of filas) {
    const actual = porVariante.get(fila.variantId) ?? {
      variantId: fila.variantId,
      productId: fila.productId,
      productSlug: fila.productSlug,
      productName: fila.productName,
      label: fila.label,
      sku: fila.sku,
      categoryName: fila.categoryName,
      unidad: fila.unidad,
      imagen: portadaPorProducto.get(fila.productId) ?? null,
      qtyCentral: 0,
      qtyAserradero: 0,
      reservadoCentral: 0,
      reservadoAserradero: 0,
      minCentral: 0,
      minAserradero: 0,
      nivelCentral: "sin-stock" as StockLevel,
      nivelAserradero: "sin-stock" as StockLevel,
      total: 0,
    };

    // El nivel sale del disponible y no del físico: el panel tiene que ver lo
    // mismo que ve la tienda, o cada uno dice una cosa distinta sobre el mismo
    // producto.
    if (fila.branchSlug === "casa-central") {
      actual.qtyCentral = fila.qty ?? 0;
      actual.reservadoCentral = fila.reservado ?? 0;
      actual.minCentral = fila.minQty ?? 0;
      actual.nivelCentral = stockLevel(
        disponible(actual.qtyCentral, actual.reservadoCentral),
        actual.minCentral,
      );
    }
    if (fila.branchSlug === "aserradero") {
      actual.qtyAserradero = fila.qty ?? 0;
      actual.reservadoAserradero = fila.reservado ?? 0;
      actual.minAserradero = fila.minQty ?? 0;
      actual.nivelAserradero = stockLevel(
        disponible(actual.qtyAserradero, actual.reservadoAserradero),
        actual.minAserradero,
      );
    }

    actual.total = actual.qtyCentral + actual.qtyAserradero;
    porVariante.set(fila.variantId, actual);
  }

  return [...porVariante.values()];
}

/** Variantes por debajo de su umbral de reposición. */
export async function alertasDeStock(limite = 8) {
  await requireStaff();

  return db
    .select({
      variantId: productVariants.id,
      productName: products.name,
      label: productVariants.label,
      branchName: branches.name,
      qty: inventory.qty,
      reservado: inventory.reservado,
      minQty: inventory.minQty,
    })
    .from(inventory)
    .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(branches, eq(branches.id, inventory.branchId))
    .where(
      and(
        eq(products.active, true),
        eq(productVariants.active, true),
        sql`${inventory.minQty} > 0`,
        // La alerta mira el disponible: si hay veinte placas y diecinueve están
        // vendidas, hay que reponer aunque el físico se vea holgado.
        sql`${inventory.qty} - ${inventory.reservado} <= ${inventory.minQty}`,
      ),
    )
    .orderBy(asc(sql`${inventory.qty} - ${inventory.reservado}`))
    .limit(limite);
}

/** Últimos movimientos, para explicar de dónde salió cada cambio. */
export async function ultimosMovimientos(limite = 10) {
  await requireStaff();

  return db
    .select({
      id: inventoryMovements.id,
      productName: products.name,
      label: productVariants.label,
      branchName: branches.name,
      type: inventoryMovements.type,
      qty: inventoryMovements.qty,
      note: inventoryMovements.note,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .innerJoin(
      productVariants,
      eq(productVariants.id, inventoryMovements.variantId),
    )
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(branches, eq(branches.id, inventoryMovements.branchId))
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(limite);
}

export async function listarSucursales() {
  await requireStaff();
  return db.select().from(branches).orderBy(asc(branches.sortOrder));
}
