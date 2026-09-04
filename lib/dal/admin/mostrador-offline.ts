import "server-only";

import { and, asc, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  categories,
  customers,
  inventory,
  priceListItems,
  priceLists,
  productVariants,
  products,
} from "@/lib/db/schema";
import { normalizar } from "@/lib/mostrador/offline/busqueda-local";

/**
 * La copia del mostrador para trabajar sin internet.
 *
 * **El campo `busqueda` lo arma el servidor, con la misma función que usa el
 * navegador para normalizar lo que se tipea** (`normalizar` de
 * `busqueda-local.ts`). Así no hay dos normalizadores que puedan discrepar, y
 * ocho mil filas no se normalizan de nuevo en cada tecla.
 *
 * **Se bajan solo las listas de precios alcanzables**: la general y las que
 * tiene asignada algún cliente activo. Mandar todas puede ser un orden de
 * magnitud más de lo necesario.
 */

export interface CopiaDelMostrador {
  variantes: {
    variantId: string;
    sku: string;
    producto: string;
    medida: string;
    unidad: string;
    marca: string | null;
    categoria: string;
    sortOrder: number;
    busqueda: string;
  }[];
  precios: { priceListId: string; variantId: string; precio: number }[];
  stock: { branchId: string; variantId: string; qty: number }[];
  listas: { id: string; nombre: string; esGeneral: boolean }[];
  /**
   * Variantes que dejaron de estar disponibles desde el último delta.
   *
   * **Sin esto la copia local nunca se achica.** Una variante dada de baja
   * simplemente dejaba de aparecer en el delta, así que se quedaba en el
   * mostrador para siempre: salía en el buscador con precio "a definir" y sin
   * stock, y quien atiende la podía cargar en una venta.
   *
   * Va vacío en la copia completa, donde el borrado lo hace el reemplazo.
   */
  bajas: string[];
  /** Marca de tiempo para pedir el próximo delta. */
  generadoAt: string;
}

/**
 * Margen hacia atrás del `generadoAt`.
 *
 * Una fila escrita **mientras** corría esta consulta tiene un `updatedAt`
 * anterior al fin de la consulta pero ya no la devolvimos. Sin el margen, cae
 * en el hueco entre dos deltas y no se ve nunca más.
 */
const MARGEN_MS = 5_000;

export async function copiaDelMostrador(
  desde?: Date | null,
): Promise<CopiaDelMostrador> {
  // El `now()` se toma al principio, no al final: ver el comentario del margen.
  const generadoAt = new Date(Date.now() - MARGEN_MS);

  const nuevo = (columna: typeof productVariants.updatedAt) =>
    desde ? gt(columna, desde) : undefined;

  const filasVariantes = await db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      producto: products.name,
      medida: productVariants.label,
      unidad: products.unit,
      marca: products.brand,
      categoria: categories.name,
      sortOrder: productVariants.sortOrder,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        eq(productVariants.active, true),
        eq(products.active, true),
        desde
          ? or(nuevo(productVariants.updatedAt), gt(products.updatedAt, desde))
          : undefined,
      ),
    )
    .orderBy(asc(productVariants.sortOrder));

  /*
   * Las bajas solo tienen sentido en un delta: en la copia completa el cliente
   * reemplaza todo, así que lo que no viene desaparece solo. Eso además limpia
   * lo que se borró de verdad, que no deja rastro en `updatedAt`.
   */
  const bajas = desde
    ? (
        await db
          .select({ variantId: productVariants.id })
          .from(productVariants)
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(
            and(
              or(
                eq(productVariants.active, false),
                eq(products.active, false),
              ),
              or(
                gt(productVariants.updatedAt, desde),
                gt(products.updatedAt, desde),
              ),
            ),
          )
      ).map((f) => f.variantId)
    : [];

  const listasAlcanzables = await db
    .selectDistinct({ id: priceLists.id, nombre: priceLists.name, esGeneral: priceLists.isDefault })
    .from(priceLists)
    .leftJoin(customers, eq(customers.priceListId, priceLists.id))
    .where(
      and(
        eq(priceLists.active, true),
        or(eq(priceLists.isDefault, true), isNotNull(customers.id)),
      ),
    );

  const ids = listasAlcanzables.map((l) => l.id);

  const filasPrecios = ids.length
    ? await db
        .select({
          priceListId: priceListItems.priceListId,
          variantId: priceListItems.variantId,
          precio: priceListItems.price,
        })
        .from(priceListItems)
        .where(
          and(
            sql`${priceListItems.priceListId} in ${ids}`,
            desde ? gt(priceListItems.updatedAt, desde) : undefined,
          ),
        )
    : [];

  const filasStock = await db
    .select({
      branchId: inventory.branchId,
      variantId: inventory.variantId,
      qty: inventory.qty,
    })
    .from(inventory)
    .innerJoin(branches, eq(branches.id, inventory.branchId))
    .where(
      and(
        eq(branches.active, true),
        desde ? gt(inventory.updatedAt, desde) : undefined,
      ),
    );

  return {
    variantes: filasVariantes.map((v) => ({
      ...v,
      busqueda: normalizar(
        [v.producto, v.medida, v.sku, v.marca, v.categoria]
          .filter(Boolean)
          .join(" "),
      ),
    })),
    precios: filasPrecios.map((p) => ({ ...p, precio: Number(p.precio) })),
    stock: filasStock,
    listas: listasAlcanzables,
    bajas,
    generadoAt: generadoAt.toISOString(),
  };
}

export interface ClienteDeLaCopia {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: string;
  priceListId: string | null;
  estado: string;
  limiteCredito: number;
  busqueda: string;
}

export async function clientesDelMostrador(
  desde?: Date | null,
): Promise<{ clientes: ClienteDeLaCopia[]; generadoAt: string }> {
  const generadoAt = new Date(Date.now() - MARGEN_MS);

  const filas = await db
    .select({
      id: customers.id,
      nombre: customers.nombre,
      razonSocial: customers.razonSocial,
      cuit: customers.cuit,
      condicionIva: customers.condicionIva,
      priceListId: customers.priceListId,
      estado: customers.estado,
      limiteCredito: customers.limiteCredito,
    })
    .from(customers)
    .where(
      and(
        eq(customers.active, true),
        desde ? gt(customers.updatedAt, desde) : undefined,
      ),
    )
    .orderBy(asc(customers.nombre));

  return {
    clientes: filas.map((c) => ({
      ...c,
      limiteCredito: Number(c.limiteCredito ?? 0),
      busqueda: normalizar(
        [c.nombre, c.razonSocial, c.cuit].filter(Boolean).join(" "),
      ),
    })),
    generadoAt: generadoAt.toISOString(),
  };
}
