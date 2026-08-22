import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, cuttingItems, cuttingOrders, customers } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { coincideBusqueda } from "@/lib/busqueda";

export interface CorteListado {
  id: string;
  numero: string;
  cliente: string;
  material: string;
  placas: number;
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
): Promise<CorteListado[]> {
  await requireStaff();

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

export async function obtenerCorte(id: string) {
  await requireStaff();

  const [corte] = await db
    .select({
      id: cuttingOrders.id,
      numero: cuttingOrders.numero,
      cliente: cuttingOrders.contactoNombre,
      customerId: cuttingOrders.customerId,
      empresa: customers.razonSocial,
      material: cuttingOrders.materialDescripcion,
      placas: cuttingOrders.placas,
      estado: cuttingOrders.estado,
      urgente: cuttingOrders.urgente,
      notas: cuttingOrders.notas,
      sucursal: branches.name,
      createdAt: cuttingOrders.createdAt,
    })
    .from(cuttingOrders)
    .leftJoin(customers, eq(customers.id, cuttingOrders.customerId))
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
