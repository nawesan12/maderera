import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  categories,
  goodsReceiptItems,
  goodsReceipts,
  productVariants,
  products,
  suppliers,
  variantCosts,
} from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { coincideBusqueda } from "@/lib/busqueda";

/**
 * Las recepciones de mercadería.
 *
 * El total se agrega en SQL y no sumando en JavaScript: el listado muestra
 * treinta recepciones y traerse todas sus líneas para sumarlas sería mover diez
 * veces más datos para mostrar una columna.
 */
export async function listarRecepciones(limite = 50) {
  await requireStaffRole("admin");

  const totales = db
    .select({
      receiptId: goodsReceiptItems.receiptId,
      lineas: sql<number>`count(*)::int`.as("lineas"),
      neto: sql<string>`sum(${goodsReceiptItems.cantidad} * ${goodsReceiptItems.costoUnitario})`.as(
        "neto",
      ),
    })
    .from(goodsReceiptItems)
    .groupBy(goodsReceiptItems.receiptId)
    .as("totales");

  const filas = await db
    .select({
      id: goodsReceipts.id,
      numeroRemito: goodsReceipts.numeroRemito,
      fecha: goodsReceipts.fecha,
      estado: goodsReceipts.estado,
      gastos: goodsReceipts.gastos,
      proveedor: suppliers.nombre,
      supplierId: goodsReceipts.supplierId,
      sucursal: branches.name,
      lineas: totales.lineas,
      neto: totales.neto,
    })
    .from(goodsReceipts)
    .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
    .leftJoin(branches, eq(branches.id, goodsReceipts.branchId))
    .leftJoin(totales, eq(totales.receiptId, goodsReceipts.id))
    .orderBy(desc(goodsReceipts.fecha))
    .limit(limite);

  return filas.map((f) => ({
    ...f,
    lineas: Number(f.lineas ?? 0),
    neto: Number(f.neto ?? 0) + Number(f.gastos),
  }));
}

/** Una recepción con sus líneas y la cuenta del costo, si ya se confirmó. */
export async function obtenerRecepcion(id: string) {
  await requireStaffRole("admin");

  const [recepcion] = await db
    .select({
      id: goodsReceipts.id,
      numeroRemito: goodsReceipts.numeroRemito,
      fecha: goodsReceipts.fecha,
      estado: goodsReceipts.estado,
      gastos: goodsReceipts.gastos,
      notas: goodsReceipts.notas,
      confirmadaAt: goodsReceipts.confirmadaAt,
      supplierId: goodsReceipts.supplierId,
      proveedor: suppliers.nombre,
      branchId: goodsReceipts.branchId,
      sucursal: branches.name,
    })
    .from(goodsReceipts)
    .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
    .leftJoin(branches, eq(branches.id, goodsReceipts.branchId))
    .where(eq(goodsReceipts.id, id))
    .limit(1);

  if (!recepcion) return null;

  const items = await db
    .select({
      id: goodsReceiptItems.id,
      variantId: goodsReceiptItems.variantId,
      producto: products.name,
      variante: productVariants.label,
      sku: productVariants.sku,
      cantidad: goodsReceiptItems.cantidad,
      costoUnitario: goodsReceiptItems.costoUnitario,
      alicuotaIva: goodsReceiptItems.alicuotaIva,
      costoConGastos: goodsReceiptItems.costoConGastos,
      cantidadAnterior: goodsReceiptItems.cantidadAnterior,
      costoAnterior: goodsReceiptItems.costoAnterior,
      costoResultante: goodsReceiptItems.costoResultante,
      orden: goodsReceiptItems.orden,
    })
    .from(goodsReceiptItems)
    .leftJoin(
      productVariants,
      eq(productVariants.id, goodsReceiptItems.variantId),
    )
    .leftJoin(products, eq(products.id, productVariants.productId))
    .where(eq(goodsReceiptItems.receiptId, id))
    .orderBy(goodsReceiptItems.orden);

  return { ...recepcion, items };
}

/**
 * Buscar mercadería para cargar una recepción.
 *
 * Es otra búsqueda que la del mostrador y no la misma: allá lo que importa es
 * el precio de venta según el cliente y el stock de esa sucursal; acá lo que
 * hace falta ver es **a cuánto está costando hoy**, que es contra lo que se
 * compara el costo del remito antes de darlo por bueno.
 */
export async function buscarParaRecibir(texto: string) {
  await requireStaffRole("admin");

  const consulta = texto.trim();
  if (consulta.length < 2) return [];

  const porTexto = coincideBusqueda(consulta, [
    products.name,
    productVariants.label,
    productVariants.sku,
    products.brand,
    categories.name,
  ]);

  return db
    .select({
      variantId: productVariants.id,
      producto: products.name,
      variante: productVariants.label,
      sku: productVariants.sku,
      unidad: products.unit,
      alicuotaIva: products.alicuotaIva,
      costoActual: variantCosts.costoPromedio,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(variantCosts, eq(variantCosts.variantId, productVariants.id))
    .where(and(eq(productVariants.active, true), porTexto))
    .orderBy(products.name)
    .limit(20);
}
