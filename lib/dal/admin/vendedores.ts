import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, sellers } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

/**
 * Los vendedores de la casa.
 *
 * Existen para que "el vendedor asignado" sea una persona concreta y no un
 * texto tipeado distinto en cada ficha. El reporte de ventas por vendedor y el
 * presupuesto impreso leen de acá.
 */

export interface VendedorConCartera {
  id: string;
  nombre: string;
  tipo: "salon" | "calle";
  activo: boolean;
  /** Cuántos clientes lo tienen asignado. Es lo que frena una baja a ciegas. */
  clientes: number;
}

export async function listarVendedores(): Promise<VendedorConCartera[]> {
  await requireStaff();

  const filas = await db
    .select({
      id: sellers.id,
      nombre: sellers.nombre,
      tipo: sellers.tipo,
      activo: sellers.activo,
      clientes: sql<number>`count(${customers.id})::int`,
    })
    .from(sellers)
    .leftJoin(customers, eq(customers.sellerId, sellers.id))
    .groupBy(sellers.id)
    .orderBy(asc(sellers.nombre));

  return filas;
}

export interface VendedorParaElegir {
  id: string;
  nombre: string;
  tipo: "salon" | "calle";
}

/** Los activos, para los selects de cliente, presupuesto y pedido. */
export async function vendedoresActivos(): Promise<VendedorParaElegir[]> {
  await requireStaff();

  return db
    .select({ id: sellers.id, nombre: sellers.nombre, tipo: sellers.tipo })
    .from(sellers)
    .where(eq(sellers.activo, true))
    .orderBy(asc(sellers.nombre));
}
