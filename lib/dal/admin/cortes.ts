import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  cuttingItems,
  cuttingOrders,
  customers,
  orders,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { coincideBusqueda } from "@/lib/busqueda";

export interface CorteListado {
  id: string;
  numero: string;
  cliente: string;
  material: string;
  placas: number;
  /** Pasadas de sierra medidas al optimizar. Cero es «todavía no se midió». */
  pasadas: number;
  estado: string;
  urgente: boolean;
  sucursal: string | null;
  notas: string | null;
  piezas: number;
  /** Metros cuadrados a cortar, para dimensionar el trabajo de un vistazo. */
  metrosCuadrados: number;
  createdAt: Date;
}

export async function listarCortes(
  filtros: { busqueda?: string; estado?: string } = {},
  /**
   * Quién ya validó el acceso, cuando no es una sesión del panel.
   *
   * Lo usa el agente del taller, que se autentica con un token compartido y no
   * tiene cookie: sin esto `requireStaff()` lo redirigiría a `/ingresar` en vez
   * de responderle. Va como parámetro explícito y no como una variante suelta
   * de la consulta, para que quien lea la firma vea que hay un segundo camino
   * de autorización y dónde está.
   */
  autorizadoPor?: "agente-del-taller",
): Promise<CorteListado[]> {
  if (!autorizadoPor) await requireStaff();

  const condiciones = [];
  if (filtros.estado && filtros.estado !== "todos") {
    condiciones.push(eq(cuttingOrders.estado, filtros.estado as never));
  }
  if (filtros.busqueda) {
    const coincidencia = coincideBusqueda(filtros.busqueda, [
      cuttingOrders.numero,
      cuttingOrders.contactoNombre,
      cuttingOrders.materialDescripcion,
    ]);
    if (coincidencia) condiciones.push(coincidencia);
  }

  const resumen = db
    .select({
      cuttingOrderId: cuttingItems.cuttingOrderId,
      piezas: sql<number>`sum(${cuttingItems.cantidad})::int`.as("piezas"),
      superficie:
        sql<string>`sum(${cuttingItems.largoMm} * ${cuttingItems.anchoMm} * ${cuttingItems.cantidad} / 1000000.0)`.as(
          "superficie",
        ),
    })
    .from(cuttingItems)
    .groupBy(cuttingItems.cuttingOrderId)
    .as("resumen");

  const filas = await db
    .select({
      id: cuttingOrders.id,
      numero: cuttingOrders.numero,
      cliente: cuttingOrders.contactoNombre,
      material: cuttingOrders.materialDescripcion,
      placas: cuttingOrders.placas,
      pasadas: cuttingOrders.pasadas,
      estado: cuttingOrders.estado,
      urgente: cuttingOrders.urgente,
      notas: cuttingOrders.notas,
      sucursal: branches.name,
      createdAt: cuttingOrders.createdAt,
      piezas: resumen.piezas,
      superficie: resumen.superficie,
    })
    .from(cuttingOrders)
    .leftJoin(branches, eq(branches.id, cuttingOrders.branchId))
    .leftJoin(resumen, eq(resumen.cuttingOrderId, cuttingOrders.id))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    // Primero lo urgente, después por antigüedad: así se lee como la cola real.
    .orderBy(desc(cuttingOrders.urgente), asc(cuttingOrders.createdAt));

  return filas.map((f) => ({
    ...f,
    urgente: f.urgente === 1,
    piezas: f.piezas ?? 0,
    metrosCuadrados: Math.round(Number(f.superficie ?? 0) * 100) / 100,
  }));
}

export async function obtenerCorte(
  id: string,
  autorizadoPor?: "agente-del-taller",
) {
  if (!autorizadoPor) await requireStaff();

  const [corte] = await db
    .select({
      id: cuttingOrders.id,
      numero: cuttingOrders.numero,
      cliente: cuttingOrders.contactoNombre,
      customerId: cuttingOrders.customerId,
      // De qué pedido salió, si salió de uno. Lo que permite volver desde la
      // ficha del corte a la venta que lo pidió.
      orderId: cuttingOrders.orderId,
      pedidoNumero: orders.numero,
      empresa: customers.razonSocial,
      // La lista del cliente decide la tarifa del corte: un mayorista paga
      // $996 la pasada donde el público paga $1.200.
      priceListId: customers.priceListId,
      material: cuttingOrders.materialDescripcion,
      placas: cuttingOrders.placas,
      pasadas: cuttingOrders.pasadas,
      cantoDescripcion: cuttingOrders.cantoDescripcion,
      estado: cuttingOrders.estado,
      urgente: cuttingOrders.urgente,
      notas: cuttingOrders.notas,
      sucursal: branches.name,
      createdAt: cuttingOrders.createdAt,
    })
    .from(cuttingOrders)
    .leftJoin(customers, eq(customers.id, cuttingOrders.customerId))
    .leftJoin(orders, eq(orders.id, cuttingOrders.orderId))
    .leftJoin(branches, eq(branches.id, cuttingOrders.branchId))
    .where(eq(cuttingOrders.id, id))
    .limit(1);

  if (!corte) return null;

  const piezas = await db
    .select()
    .from(cuttingItems)
    .where(eq(cuttingItems.cuttingOrderId, id))
    .orderBy(asc(cuttingItems.orden));

  return { ...corte, urgente: corte.urgente === 1, piezas };
}

/**
 * Los cortes que salieron de un pedido.
 *
 * Es la mitad que faltaba del puente: desde el pedido, saber si hay algo
 * esperando la seccionadora. Sin esto, un pedido podía figurar "listo" con el
 * corte todavía sin hacer, y nadie se enteraba hasta que el cliente venía a
 * retirarlo.
 */
export async function cortesDelPedido(orderId: string) {
  await requireStaff();

  return db
    .select({
      id: cuttingOrders.id,
      numero: cuttingOrders.numero,
      material: cuttingOrders.materialDescripcion,
      estado: cuttingOrders.estado,
      urgente: cuttingOrders.urgente,
      createdAt: cuttingOrders.createdAt,
    })
    .from(cuttingOrders)
    .where(eq(cuttingOrders.orderId, orderId))
    .orderBy(desc(cuttingOrders.createdAt));
}
