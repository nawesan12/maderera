import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";

/**
 * Las órdenes de compra.
 *
 * Contestan la pregunta que el sistema no podía contestar: **qué está por
 * llegar**. Sin eso, el encargado que ve tres placas en el estante no sabe si
 * pedir más o si el camión sale mañana, y termina pidiendo de nuevo lo que ya
 * venía en camino.
 */
export async function listarOrdenesDeCompra(limite = 60) {
  await requireStaffRole("admin");

  const totales = db
    .select({
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      lineas: sql<number>`count(*)::int`.as("lineas"),
      neto: sql<string>`sum(${purchaseOrderItems.cantidad} * ${purchaseOrderItems.costoUnitario})`.as(
        "neto",
      ),
      pendientes: sql<number>`count(*) filter (where ${purchaseOrderItems.cantidadRecibida} < ${purchaseOrderItems.cantidad})::int`.as(
        "pendientes",
      ),
    })
    .from(purchaseOrderItems)
    .groupBy(purchaseOrderItems.purchaseOrderId)
    .as("totales");

  const filas = await db
    .select({
      id: purchaseOrders.id,
      numero: purchaseOrders.numero,
      estado: purchaseOrders.estado,
      fechaPrometida: purchaseOrders.fechaPrometida,
      createdAt: purchaseOrders.createdAt,
      proveedor: suppliers.nombre,
      supplierId: purchaseOrders.supplierId,
      sucursal: branches.name,
      lineas: totales.lineas,
      neto: totales.neto,
      pendientes: totales.pendientes,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(branches, eq(branches.id, purchaseOrders.branchId))
    .leftJoin(totales, eq(totales.purchaseOrderId, purchaseOrders.id))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(limite);

  return filas.map((f) => ({
    ...f,
    lineas: Number(f.lineas ?? 0),
    neto: Number(f.neto ?? 0),
    pendientes: Number(f.pendientes ?? 0),
  }));
}

export async function obtenerOrdenDeCompra(id: string) {
  await requireStaffRole("admin");

  const [orden] = await db
    .select({
      id: purchaseOrders.id,
      numero: purchaseOrders.numero,
      estado: purchaseOrders.estado,
      fechaPrometida: purchaseOrders.fechaPrometida,
      notas: purchaseOrders.notas,
      createdAt: purchaseOrders.createdAt,
      enviadaAt: purchaseOrders.enviadaAt,
      supplierId: purchaseOrders.supplierId,
      proveedor: suppliers.nombre,
      branchId: purchaseOrders.branchId,
      sucursal: branches.name,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(branches, eq(branches.id, purchaseOrders.branchId))
    .where(eq(purchaseOrders.id, id))
    .limit(1);

  if (!orden) return null;

  const items = await db
    .select()
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, id))
    .orderBy(asc(purchaseOrderItems.orden));

  return { ...orden, items };
}

/**
 * Lo que todavía falta recibir, por variante.
 *
 * Es lo que hace útil la orden en el día a día: al reponer stock, saber que ya
 * hay 40 placas pedidas evita el segundo pedido. Se limita a las órdenes vivas
 * —enviadas o parciales—: una orden en borrador no está pedida y una anulada
 * no va a llegar.
 */
export async function loQueEstaPorLlegar(branchId?: string) {
  await requireStaffRole("admin");

  const condiciones = [
    sql`${purchaseOrders.estado} in ('enviada', 'parcial')`,
    sql`${purchaseOrderItems.cantidadRecibida} < ${purchaseOrderItems.cantidad}`,
  ];
  if (branchId) condiciones.push(eq(purchaseOrders.branchId, branchId));

  return db
    .select({
      variantId: purchaseOrderItems.variantId,
      descripcion: purchaseOrderItems.descripcion,
      pendiente: sql<string>`sum(${purchaseOrderItems.cantidad} - ${purchaseOrderItems.cantidadRecibida})`,
      proximaEntrega: sql<Date | null>`min(${purchaseOrders.fechaPrometida})`,
    })
    .from(purchaseOrderItems)
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId),
    )
    .where(and(...condiciones))
    .groupBy(purchaseOrderItems.variantId, purchaseOrderItems.descripcion);
}

/** Las órdenes vivas de un proveedor, para elegir al cargar una recepción. */
export async function ordenesAbiertasDe(supplierId: string) {
  await requireStaffRole("admin");

  return db
    .select({
      id: purchaseOrders.id,
      numero: purchaseOrders.numero,
      fechaPrometida: purchaseOrders.fechaPrometida,
    })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.supplierId, supplierId),
        sql`${purchaseOrders.estado} in ('enviada', 'parcial')`,
      ),
    )
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(20);
}
