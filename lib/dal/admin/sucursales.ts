import "server-only";

import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  cuttingOrders,
  inventory,
  orders,
  priceListItems,
  priceLists,
  productVariants,
  products,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

/** Medianoche de hoy, para separar "hoy" de "ayer" en hora local. */
function inicioDelDia() {
  const fecha = new Date();
  fecha.setHours(0, 0, 0, 0);
  return fecha;
}

export interface SucursalConMetricas {
  id: string;
  slug: string;
  nombre: string;
  direccion: string;
  telefono: string | null;
  whatsapp: string | null;
  email: string | null;
  horario: string | null;
  mapUrl: string | null;
  imagenUrl: string | null;
  servicios: string;
  destacados: string;
  sortOrder: number;
  active: boolean;
  /** Importe vendido hoy: pedidos no cancelados con fecha de hoy. */
  ventasHoy: number;
  pedidosHoy: number;
  /** Pedidos abiertos, sin importar la fecha: es la cola de trabajo real. */
  pedidosAbiertos: number;
  cortesEnCola: number;
  /** Personas distintas atendidas hoy, no pedidos: dos pedidos de la misma persona son una. */
  clientesAtendidos: number;
  /** Stock valorizado a la lista general. Es una estimación, no un balance. */
  stockValor: number;
  productosStockBajo: number;
}

/**
 * Las sucursales con sus números, calculados de la base.
 *
 * La pantalla era la última maqueta del panel: leía `lib/dashboard-data.ts`,
 * con las direcciones y las métricas escritas a mano. El problema no era que
 * los números fueran inventados —eso se nota— sino que la dirección y el
 * teléfono estaban ahí duplicados: cuando el aserradero cambió de teléfono,
 * el panel siguió mostrando el viejo sin que nadie lo notara.
 *
 * Las seis consultas van en paralelo y se cruzan por `branchId` en memoria: son
 * dos sucursales, y hacer un `join` de todo contra `branches` obligaría a un
 * `group by` por cada métrica igual.
 */
export async function sucursalesConMetricas(): Promise<SucursalConMetricas[]> {
  await requireStaff();

  const hoy = inicioDelDia();
  const noCancelado = sql`${orders.estado} <> 'cancelado'`;

  const [
    fichas,
    ventas,
    abiertos,
    cortes,
    valorStock,
    reponer,
  ] = await Promise.all([
    db.select().from(branches).orderBy(asc(branches.sortOrder)),
    db
      .select({
        branchId: orders.branchId,
        total: sql<string>`coalesce(sum(${orders.total}), 0)`,
        pedidos: sql<number>`count(*)::int`,
        clientes: sql<number>`count(distinct coalesce(${orders.customerId}::text, ${orders.contactoEmail}, ${orders.id}::text))::int`,
      })
      .from(orders)
      .where(and(gte(orders.createdAt, hoy), noCancelado))
      .groupBy(orders.branchId),
    db
      .select({
        branchId: orders.branchId,
        n: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(sql`${orders.estado} not in ('entregado', 'cancelado')`)
      .groupBy(orders.branchId),
    db
      .select({
        branchId: cuttingOrders.branchId,
        n: sql<number>`count(*)::int`,
      })
      .from(cuttingOrders)
      .where(sql`${cuttingOrders.estado} in ('en-cola', 'en-proceso')`)
      .groupBy(cuttingOrders.branchId),
    db
      .select({
        branchId: inventory.branchId,
        total: sql<string>`coalesce(sum(${inventory.qty} * ${priceListItems.price}), 0)`,
      })
      .from(inventory)
      .innerJoin(priceListItems, eq(priceListItems.variantId, inventory.variantId))
      .innerJoin(priceLists, eq(priceLists.id, priceListItems.priceListId))
      .where(eq(priceLists.isDefault, true))
      .groupBy(inventory.branchId),
    db
      .select({
        branchId: inventory.branchId,
        n: sql<number>`count(*)::int`,
      })
      .from(inventory)
      .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          eq(products.active, true),
          eq(productVariants.active, true),
          sql`${inventory.minQty} > 0`,
          sql`${inventory.qty} <= ${inventory.minQty}`,
        ),
      )
      .groupBy(inventory.branchId),
  ]);

  return fichas.map((f) => ({
    id: f.id,
    slug: f.slug,
    nombre: f.name,
    direccion: f.address,
    telefono: f.phone,
    whatsapp: f.whatsapp,
    email: f.email,
    horario: f.hours,
    mapUrl: f.mapUrl,
    imagenUrl: f.imagenUrl,
    servicios: f.servicios,
    destacados: f.destacados,
    sortOrder: f.sortOrder,
    active: f.active,
    ventasHoy: Number(ventas.find((v) => v.branchId === f.id)?.total ?? 0),
    pedidosHoy: ventas.find((v) => v.branchId === f.id)?.pedidos ?? 0,
    clientesAtendidos: ventas.find((v) => v.branchId === f.id)?.clientes ?? 0,
    pedidosAbiertos: abiertos.find((a) => a.branchId === f.id)?.n ?? 0,
    cortesEnCola: cortes.find((c) => c.branchId === f.id)?.n ?? 0,
    stockValor: Number(valorStock.find((s) => s.branchId === f.id)?.total ?? 0),
    productosStockBajo: reponer.find((r) => r.branchId === f.id)?.n ?? 0,
  }));
}

/**
 * Lo que no está asignado a ninguna sucursal.
 *
 * Los pedidos de la tienda con envío a domicilio pueden quedar sin `branchId`
 * hasta que alguien los toma. Si no se muestran en algún lado, la suma de las
 * dos sucursales no da el total del panel y parecen números rotos.
 */
export async function sinSucursalAsignada() {
  await requireStaff();

  const [pedidos, cortes] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          sql`${orders.branchId} is null`,
          sql`${orders.estado} not in ('entregado', 'cancelado')`,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(cuttingOrders)
      .where(
        and(
          sql`${cuttingOrders.branchId} is null`,
          sql`${cuttingOrders.estado} in ('en-cola', 'en-proceso')`,
        ),
      ),
  ]);

  return {
    pedidos: pedidos[0]?.n ?? 0,
    cortes: cortes[0]?.n ?? 0,
  };
}
