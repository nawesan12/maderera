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

  /* ---- Margen ---- */

  /**
   * Lo vendido **sin IVA**.
   *
   * No es `total` menos un porcentaje fijo: se desagrega renglón por renglón
   * con la alícuota de cada uno, porque la maderera vende algunos ítems al
   * 10,5 % y la constante 21 desviaría el margen de esos casi diez puntos.
   */
  netoVenta: number;

  /**
   * Lo que costó, congelado en cada venta. `null` cuando ninguna línea del
   * grupo tiene costo, que es todo lo anterior al módulo de compras.
   */
  costo: number | null;

  /**
   * Renglones sin costo conocido.
   *
   * Se cuentan y se muestran **aparte**, no se tratan como costo cero. Un cero
   * daría 100 % de margen y mezclaría lo que no se sabe con lo que se sabe: el
   * promedio resultante es exactamente el número sobre el que no se puede
   * decidir nada.
   */
  lineasSinCosto: number;
}

/**
 * El neto y el costo de cada pedido, en una sola pasada.
 *
 * Va como subconsulta agregada y no como join directo contra `order_items`:
 * los reportes por cliente, vendedor, sucursal y canal agrupan **pedidos**, y
 * unirlos a los renglones sin agregar primero multiplicaría cada pedido por su
 * cantidad de líneas y el total saldría inflado.
 */
function margenesPorPedido() {
  return db
    .select({
      orderId: orderItems.orderId,
      neto: sql<string>`sum(${orderItems.subtotal} / (1 + coalesce(${orderItems.alicuotaIva}, 21) / 100))`.as(
        "neto",
      ),
      costo: sql<
        string | null
      >`sum(${orderItems.cantidad} * ${orderItems.costoUnitario}) filter (where ${orderItems.costoUnitario} is not null)`.as(
        "costo",
      ),
      sinCosto: sql<number>`count(*) filter (where ${orderItems.costoUnitario} is null)::int`.as(
        "sin_costo",
      ),
    })
    .from(orderItems)
    .groupBy(orderItems.orderId)
    .as("margenes");
}

/** Lo que devuelve la base para las columnas de margen, ya en números. */
function leerMargen(f: {
  netoVenta: string | null;
  costo: string | null;
  lineasSinCosto: number | null;
}) {
  return {
    netoVenta: Number(f.netoVenta ?? 0),
    costo: f.costo === null ? null : Number(f.costo),
    lineasSinCosto: Number(f.lineasSinCosto ?? 0),
  };
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
      netoVenta: sql<string>`sum(${orderItems.subtotal} / (1 + coalesce(${orderItems.alicuotaIva}, 21) / 100))`,
      costo: sql<
        string | null
      >`sum(${orderItems.cantidad} * ${orderItems.costoUnitario}) filter (where ${orderItems.costoUnitario} is not null)`,
      lineasSinCosto: sql<number>`count(*) filter (where ${orderItems.costoUnitario} is null)::int`,
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
    ...leerMargen(f),
  }));
}

/** Quién compró. Sirve para saber a quién llamar cuando deja de comprar. */
export async function ventasPorCliente(
  periodo: Periodo,
  tope = 50,
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const margenes = margenesPorPedido();
  const filas = await db
    .select({
      clave: sql<string>`coalesce(${customers.id}::text, ${orders.contactoNombre})`,
      etiqueta: sql<string>`coalesce(${customers.razonSocial}, ${customers.nombre}, ${orders.contactoNombre})`,
      detalle: customers.cuit,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
      netoVenta: sql<string>`sum(coalesce(margenes.neto, 0))`,
      costo: sql<string | null>`sum(margenes.costo)`,
      lineasSinCosto: sql<number>`coalesce(sum(margenes.sin_costo), 0)::int`,
    })
    .from(orders)
    .leftJoin(margenes, eq(margenes.orderId, orders.id))
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
    ...leerMargen(f),
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

  const margenes = margenesPorPedido();
  const filas = await db
    .select({
      clave: user.id,
      etiqueta: user.name,
      detalle: sql<string | null>`null`,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
      netoVenta: sql<string>`sum(coalesce(margenes.neto, 0))`,
      costo: sql<string | null>`sum(margenes.costo)`,
      lineasSinCosto: sql<number>`coalesce(sum(margenes.sin_costo), 0)::int`,
    })
    .from(orders)
    .leftJoin(margenes, eq(margenes.orderId, orders.id))
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
    ...leerMargen(f),
  }));
}

/** Dónde se vendió, por sucursal y por canal. */
export async function ventasPorSucursal(
  periodo: Periodo,
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const margenes = margenesPorPedido();
  const filas = await db
    .select({
      clave: sql<string>`coalesce(${branches.id}::text, 'sin-sucursal')`,
      etiqueta: sql<string>`coalesce(${branches.name}, 'Sin sucursal')`,
      detalle: sql<string | null>`null`,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
      netoVenta: sql<string>`sum(coalesce(margenes.neto, 0))`,
      costo: sql<string | null>`sum(margenes.costo)`,
      lineasSinCosto: sql<number>`coalesce(sum(margenes.sin_costo), 0)::int`,
    })
    .from(orders)
    .leftJoin(margenes, eq(margenes.orderId, orders.id))
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
    ...leerMargen(f),
  }));
}

/** Por dónde entró la venta: mostrador, sitio, presupuesto, teléfono. */
export async function ventasPorCanal(
  periodo: Periodo,
): Promise<FilaDeReporte[]> {
  await requireStaff();

  const margenes = margenesPorPedido();
  const filas = await db
    .select({
      clave: orders.origen,
      etiqueta: orders.origen,
      detalle: sql<string | null>`null`,
      cantidad: sql<string>`count(*)`,
      total: sql<string>`sum(${orders.total})`,
      netoVenta: sql<string>`sum(coalesce(margenes.neto, 0))`,
      costo: sql<string | null>`sum(margenes.costo)`,
      lineasSinCosto: sql<number>`coalesce(sum(margenes.sin_costo), 0)::int`,
    })
    .from(orders)
    .leftJoin(margenes, eq(margenes.orderId, orders.id))
    .where(enElPeriodo(periodo))
    .groupBy(orders.origen)
    .orderBy(desc(sql`sum(${orders.total})`));

  return filas.map((f) => ({
    clave: f.clave ?? "sin-origen",
    etiqueta: f.etiqueta ?? "sin origen",
    detalle: null,
    cantidad: Number(f.cantidad),
    total: Number(f.total),
    ...leerMargen(f),
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
