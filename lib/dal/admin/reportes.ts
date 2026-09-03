import "server-only";

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  customers,
  orderItems,
  orders,
  productVariants,
  products,
  user,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import type { Periodo } from "@/lib/periodos";
import type { CorteDelReporte } from "@/lib/reportes-cortes";

/**
 * Los números de venta, cortados por donde se los mira.
 *
 * El resumen del panel contesta "cómo venimos". Esto contesta las cuatro
 * preguntas que vienen después y que hasta ahora no tenían pantalla: qué se
 * vende, quién compra, quién vende y en qué sucursal.
 *
 * **Las canceladas quedan afuera de todo.** Un pedido cancelado no es una
 * venta, y contarlo infla el ranking de un vendedor con lo que no cobró.
 */

export interface FilaDeReporte {
  clave: string;
  etiqueta: string;
  detalle: string | null;
  cantidad: number;
  total: number;
}

/** El filtro común: pedidos reales del período. */
function enElPeriodo(periodo: Periodo) {
  const condiciones = [sql`${orders.estado} <> 'cancelado'`];

  if (periodo.desde) condiciones.push(gte(orders.createdAt, periodo.desde));
  if (periodo.hasta) condiciones.push(lt(orders.createdAt, periodo.hasta));

  return and(...condiciones);
}

/** Qué se vendió, por producto. Ordenado por lo que más facturó. */
export async function ventasPorProducto(
  periodo: Periodo,
  tope = 50,
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const filas = await db
    .select({
      clave: sql<string>`coalesce(${products.id}::text, ${orderItems.descripcion})`,
      etiqueta: sql<string>`coalesce(${products.name}, ${orderItems.descripcion})`,
      detalle: sql<string | null>`max(${productVariants.label})`,
      cantidad: sql<string>`sum(${orderItems.cantidad})`,
      total: sql<string>`sum(${orderItems.subtotal})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .where(enElPeriodo(periodo))
    .groupBy(sql`1`, sql`2`)
    .orderBy(desc(sql`sum(${orderItems.subtotal})`))
    .limit(tope);

  return filas.map((f) => ({
    clave: f.clave,
    etiqueta: f.etiqueta,
    detalle: f.detalle,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
  }));
}

/** Quién compró. Sirve para saber a quién llamar cuando deja de comprar. */
export async function ventasPorCliente(
  periodo: Periodo,
  tope = 50,
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const filas = await db
    .select({
      clave: sql<string>`coalesce(${customers.id}::text, ${orders.contactoNombre})`,
      etiqueta: sql<string>`coalesce(${customers.razonSocial}, ${customers.nombre}, ${orders.contactoNombre})`,
      detalle: customers.cuit,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(enElPeriodo(periodo))
    .groupBy(sql`1`, sql`2`, customers.cuit)
    .orderBy(desc(sql`sum(${orders.total})`))
    .limit(tope);

  return filas.map((f) => ({
    clave: f.clave,
    etiqueta: f.etiqueta,
    detalle: f.detalle,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
  }));
}

/**
 * Quién vendió.
 *
 * Solo cuenta lo que tiene autor: el checkout del sitio no lo atiende nadie, y
 * sumarlo a un vendedor sería regalarle ventas que no hizo.
 */
export async function ventasPorVendedor(
  periodo: Periodo,
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const filas = await db
    .select({
      clave: user.id,
      etiqueta: user.name,
      detalle: sql<string | null>`null`,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
    })
    .from(orders)
    .innerJoin(user, eq(user.id, orders.createdByUserId))
    .where(enElPeriodo(periodo))
    .groupBy(user.id, user.name)
    .orderBy(desc(sql`sum(${orders.total})`));

  return filas.map((f) => ({
    clave: f.clave,
    etiqueta: f.etiqueta,
    detalle: null,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
  }));
}

/** Dónde se vendió, por sucursal y por canal. */
export async function ventasPorSucursal(
  periodo: Periodo,
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const filas = await db
    .select({
      clave: sql<string>`coalesce(${branches.id}::text, 'sin-sucursal')`,
      etiqueta: sql<string>`coalesce(${branches.name}, 'Sin sucursal')`,
      detalle: sql<string | null>`null`,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
    })
    .from(orders)
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .where(enElPeriodo(periodo))
    .groupBy(sql`1`, sql`2`)
    .orderBy(desc(sql`sum(${orders.total})`));

  return filas.map((f) => ({
    clave: f.clave,
    etiqueta: f.etiqueta,
    detalle: null,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
  }));
}

/** Por dónde entró la venta: mostrador, sitio, presupuesto, teléfono. */
export async function ventasPorCanal(
  periodo: Periodo,
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const filas = await db
    .select({
      clave: orders.origen,
      etiqueta: orders.origen,
      detalle: sql<string | null>`null`,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
    })
    .from(orders)
    .where(enElPeriodo(periodo))
    .groupBy(orders.origen)
    .orderBy(desc(sql`sum(${orders.total})`));

  return filas.map((f) => ({
    clave: f.clave ?? "sin-origen",
    etiqueta: f.etiqueta ?? "sin origen",
    detalle: null,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
  }));
}

/*
 * Los cortes y su lectura viven en `lib/reportes-cortes.ts`, que no es
 * `server-only`: los botones que eligen el corte corren en el navegador y no
 * pueden importar desde acá.
 */
export {
  CORTES,
  leerCorte,
  type CorteDelReporte,
} from "@/lib/reportes-cortes";

/** El reporte pedido, sin que la pantalla tenga que saber cuál es cuál. */
export async function reporteDeVentas(
  corte: CorteDelReporte,
  periodo: Periodo,
): Promise<FilaDeReporte[]> {
  if (corte === "cliente") return ventasPorCliente(periodo);
  if (corte === "vendedor") return ventasPorVendedor(periodo);
  if (corte === "sucursal") return ventasPorSucursal(periodo);
  if (corte === "canal") return ventasPorCanal(periodo);
  return ventasPorProducto(periodo);
}
