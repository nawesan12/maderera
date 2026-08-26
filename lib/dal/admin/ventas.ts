import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  customers,
  orderItems,
  orderStatusHistory,
  orders,
  quoteItems,
  quotes,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { coincideBusqueda } from "@/lib/busqueda";
import { estadoDelPlazo } from "@/lib/plazos";

/* -------------------------------------------------------------------------- */
/* Presupuestos                                                                */
/* -------------------------------------------------------------------------- */

export interface PresupuestoListado {
  id: string;
  numero: string;
  cliente: string;
  empresa: string | null;
  customerId: string | null;
  sucursal: string | null;
  estado: string;
  origen: string;
  total: number;
  items: number;
  asesor: string | null;
  createdAt: Date;
  validoHasta: Date | null;
  vencido: boolean;
  /** Compromiso de respuesta, solo en los express del portal profesional. */
  respondeHasta: Date | null;
  /** Cómo se lee ese plazo: "Quedan 3 h", "Se pasó de hora". */
  plazo: { texto: string; urgente: boolean; vencido: boolean } | null;
}

export async function listarPresupuestos(
  filtros: { busqueda?: string; estado?: string } = {},
): Promise<PresupuestoListado[]> {
  await requireStaff();

  const condiciones = [];
  if (filtros.estado && filtros.estado !== "todos") {
    condiciones.push(eq(quotes.estado, filtros.estado as never));
  }
  if (filtros.busqueda) {
    const coincidencia = coincideBusqueda(filtros.busqueda, [
      quotes.numero,
      quotes.contactoNombre,
      customers.razonSocial,
    ]);
    if (coincidencia) condiciones.push(coincidencia);
  }

  const conteo = db
    .select({
      quoteId: quoteItems.quoteId,
      items: sql<number>`count(*)::int`.as("items"),
    })
    .from(quoteItems)
    .groupBy(quoteItems.quoteId)
    .as("conteo");

  const filas = await db
    .select({
      id: quotes.id,
      numero: quotes.numero,
      cliente: quotes.contactoNombre,
      empresa: customers.razonSocial,
      customerId: quotes.customerId,
      sucursal: branches.name,
      estado: quotes.estado,
      origen: quotes.origen,
      total: quotes.total,
      asesor: quotes.asesor,
      createdAt: quotes.createdAt,
      validoHasta: quotes.validoHasta,
      respondeHasta: quotes.respondeHasta,
      items: conteo.items,
    })
    .from(quotes)
    .leftJoin(customers, eq(customers.id, quotes.customerId))
    .leftJoin(branches, eq(branches.id, quotes.branchId))
    .leftJoin(conteo, eq(conteo.quoteId, quotes.id))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    // Primero lo que tiene compromiso de respuesta y está más cerca de
    // vencerlo. Ordenar solo por fecha de alta dejaba un express de hace tres
    // horas debajo de una consulta suelta de hace dos.
    .orderBy(
      sql`case when ${quotes.respondeHasta} is null then 1 else 0 end`,
      sql`${quotes.respondeHasta} asc nulls last`,
      desc(quotes.createdAt),
    );

  const ahora = new Date();

  return filas.map((f) => ({
    ...f,
    total: Number(f.total),
    items: f.items ?? 0,
    vencido:
      f.validoHasta !== null &&
      f.validoHasta.getTime() < ahora.getTime() &&
      !["aceptado", "rechazado"].includes(f.estado),
    plazo:
      f.respondeHasta && f.estado === "pendiente"
        ? estadoDelPlazo(f.respondeHasta, ahora)
        : null,
  }));
}

export async function obtenerPresupuesto(id: string) {
  await requireStaff();

  const [presupuesto] = await db
    .select({
      id: quotes.id,
      numero: quotes.numero,
      cliente: quotes.contactoNombre,
      email: quotes.contactoEmail,
      telefono: quotes.contactoTelefono,
      empresa: customers.razonSocial,
      customerId: quotes.customerId,
      sucursal: branches.name,
      estado: quotes.estado,
      origen: quotes.origen,
      subtotal: quotes.subtotal,
      total: quotes.total,
      notas: quotes.notas,
      asesor: quotes.asesor,
      validoHasta: quotes.validoHasta,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .leftJoin(customers, eq(customers.id, quotes.customerId))
    .leftJoin(branches, eq(branches.id, quotes.branchId))
    .where(eq(quotes.id, id))
    .limit(1);

  if (!presupuesto) return null;

  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, id))
    .orderBy(asc(quoteItems.orden));

  return { ...presupuesto, items };
}

/* -------------------------------------------------------------------------- */
/* Pedidos                                                                     */
/* -------------------------------------------------------------------------- */

export interface PedidoListado {
  id: string;
  numero: string;
  cliente: string;
  empresa: string | null;
  sucursal: string | null;
  sucursalSlug: string | null;
  estado: string;
  tipoEntrega: string;
  direccionEntrega: string | null;
  medioPago: string | null;
  estadoPago: string;
  total: number;
  items: number;
  createdAt: Date;
}

export async function listarPedidos(
  filtros: { busqueda?: string; estado?: string; sucursal?: string } = {},
): Promise<PedidoListado[]> {
  await requireStaff();

  const condiciones = [];
  if (filtros.estado && filtros.estado !== "todos") {
    condiciones.push(eq(orders.estado, filtros.estado as never));
  }
  if (filtros.sucursal && filtros.sucursal !== "todas") {
    condiciones.push(eq(branches.slug, filtros.sucursal));
  }
  if (filtros.busqueda) {
    const coincidencia = coincideBusqueda(filtros.busqueda, [
      orders.numero,
      orders.contactoNombre,
      orders.direccionEntrega,
      customers.razonSocial,
    ]);
    if (coincidencia) condiciones.push(coincidencia);
  }

  const conteo = db
    .select({
      orderId: orderItems.orderId,
      items: sql<number>`count(*)::int`.as("items"),
    })
    .from(orderItems)
    .groupBy(orderItems.orderId)
    .as("conteo");

  const filas = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      cliente: orders.contactoNombre,
      empresa: customers.razonSocial,
      sucursal: branches.name,
      sucursalSlug: branches.slug,
      estado: orders.estado,
      tipoEntrega: orders.tipoEntrega,
      direccionEntrega: orders.direccionEntrega,
      medioPago: orders.medioPago,
      estadoPago: orders.estadoPago,
      total: orders.total,
      createdAt: orders.createdAt,
      items: conteo.items,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .leftJoin(conteo, eq(conteo.orderId, orders.id))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(orders.createdAt));

  return filas.map((f) => ({
    ...f,
    total: Number(f.total),
    items: f.items ?? 0,
  }));
}

export async function obtenerPedido(id: string) {
  await requireStaff();

  const [pedido] = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      cliente: orders.contactoNombre,
      email: orders.contactoEmail,
      telefono: orders.contactoTelefono,
      empresa: customers.razonSocial,
      customerId: orders.customerId,
      sucursal: branches.name,
      estado: orders.estado,
      origen: orders.origen,
      tipoEntrega: orders.tipoEntrega,
      direccionEntrega: orders.direccionEntrega,
      zonaEnvio: orders.zonaEnvio,
      costoEnvio: orders.costoEnvio,
      subtotal: orders.subtotal,
      total: orders.total,
      medioPago: orders.medioPago,
      estadoPago: orders.estadoPago,
      notas: orders.notas,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .where(eq(orders.id, id))
    .limit(1);

  if (!pedido) return null;

  const [items, historial] = await Promise.all([
    db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id))
      .orderBy(asc(orderItems.orden)),
    db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, id))
      .orderBy(desc(orderStatusHistory.createdAt)),
  ]);

  return { ...pedido, items, historial };
}

/** Clientes y sucursales para los formularios de alta. */
export async function opcionesDeVenta() {
  await requireStaff();

  const [listaClientes, listaSucursales] = await Promise.all([
    db
      .select({
        id: customers.id,
        nombre: customers.nombre,
        razonSocial: customers.razonSocial,
        email: customers.email,
        telefono: customers.telefono,
      })
      .from(customers)
      .where(eq(customers.active, true))
      .orderBy(asc(customers.nombre)),
    db.select().from(branches).orderBy(asc(branches.sortOrder)),
  ]);

  return { clientes: listaClientes, sucursales: listaSucursales };
}

/**
 * Siguiente número de una serie.
 *
 * Toma el número más alto usado, no el registro más reciente: el pedido cargado
 * hace un rato puede tener un número menor que otro cargado antes, y ordenar por
 * fecha devuelve un número ya ocupado.
 *
 * Igual el índice único de `numero` es la garantía final. Si dos personas graban
 * al mismo tiempo, una de las dos falla y vuelve a intentar con el siguiente.
 */
export async function siguienteNumero(
  prefijo: "P" | "PED",
): Promise<string> {
  if (prefijo === "P") {
    const anio = new Date().getFullYear();

    const [fila] = await db
      .select({
        maximo: sql<number>`coalesce(max(nullif(regexp_replace(${quotes.numero}, '\\D', '', 'g'), '')::bigint % 10000), 0)::int`,
      })
      .from(quotes)
      .where(sql`${quotes.numero} like ${`P-${anio}-%`}`);

    return `P-${anio}-${String((fila?.maximo ?? 0) + 1).padStart(4, "0")}`;
  }

  const [fila] = await db
    .select({
      maximo: sql<number>`coalesce(max(nullif(regexp_replace(${orders.numero}, '\\D', '', 'g'), '')::bigint), 999)::int`,
    })
    .from(orders);

  return `PED-${(fila?.maximo ?? 999) + 1}`;
}

