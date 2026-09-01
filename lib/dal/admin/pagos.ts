import "server-only";

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { resolverPeriodo, type Periodo } from "@/lib/periodos";
import { db } from "@/lib/db";
import {
  customers,
  datosBancarios,
  orders,
  paymentEvents,
  payments,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { cobrosEnVivo } from "@/lib/pagos";

/** Lectura de cobros para el panel. Solo personal de la empresa. */

export interface PagoListado {
  id: string;
  tipo: string;
  proveedor: string;
  estado: string;
  monto: number;
  medio: string | null;
  comprobanteUrl: string | null;
  motivoRechazo: string | null;
  proveedorPaymentId: string | null;
  numeroPedido: string | null;
  orderId: string | null;
  cliente: string | null;
  customerId: string | null;
  createdAt: Date;
  acreditadoAt: Date | null;
}

export async function listarPagos(
  filtros: { estado?: string; desde?: Date } = {},
): Promise<PagoListado[]> {
  await requireStaff();

  const condiciones = [
    filtros.estado
      ? eq(payments.estado, filtros.estado as "aprobado")
      : undefined,
    filtros.desde ? gte(payments.createdAt, filtros.desde) : undefined,
  ].filter(Boolean);

  const filas = await db
    .select({
      id: payments.id,
      tipo: payments.tipo,
      proveedor: payments.proveedor,
      estado: payments.estado,
      monto: payments.monto,
      medio: payments.medio,
      comprobanteUrl: payments.comprobanteUrl,
      motivoRechazo: payments.motivoRechazo,
      proveedorPaymentId: payments.proveedorPaymentId,
      numeroPedido: orders.numero,
      orderId: payments.orderId,
      cliente: customers.nombre,
      customerId: payments.customerId,
      createdAt: payments.createdAt,
      acreditadoAt: payments.acreditadoAt,
    })
    .from(payments)
    .leftJoin(orders, eq(orders.id, payments.orderId))
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(300);

  return filas.map((f) => ({ ...f, monto: Number(f.monto) }));
}

export interface ResumenPagos {
  acreditadoMes: number;
  cantidadMes: number;
  enRevision: number;
  montoEnRevision: number;
  rechazadosMes: number;
  /** Falso mientras corra el proveedor de demostración. */
  enVivo: boolean;
  /** Avisos recibidos que no se pudieron procesar. Cero es lo normal. */
  avisosConError: number;
}

export async function resumenPagos(periodo?: Periodo): Promise<ResumenPagos> {
  await requireStaff();

  const rango = periodo ?? resolverPeriodo("mes");
  const desde = rango.desde;
  const hasta = rango.hasta;

  /*
   * Los tres números que salen de `payments` en una sola consulta, con
   * `filter`, en vez de tres recorridas de la misma tabla. Postgres la lee una
   * vez y reparte.
   *
   * "En revisión" no lleva el corte de fecha a propósito: es lo que está
   * trabado *ahora*, y un cobro de hace dos meses esperando verificación sigue
   * esperando aunque uno mire el mes actual. Filtrarlo por período lo haría
   * desaparecer justo de la pantalla donde hay que resolverlo.
   */
  const enRango = (columna: AnyPgColumn) =>
    sql`${desde ? sql`${columna} >= ${desde}` : sql`true`} and ${
      hasta ? sql`${columna} < ${hasta}` : sql`true`
    }`;

  const [totales] = await db
    .select({
      totalMes: sql<string>`coalesce(sum(${payments.monto}) filter (where ${payments.estado} = 'aprobado' and ${enRango(payments.acreditadoAt)}), 0)`,
      cantidadMes: sql<number>`(count(*) filter (where ${payments.estado} = 'aprobado' and ${enRango(payments.acreditadoAt)}))::int`,
      totalRevision: sql<string>`coalesce(sum(${payments.monto}) filter (where ${payments.estado} = 'en_revision'), 0)`,
      cantidadRevision: sql<number>`(count(*) filter (where ${payments.estado} = 'en_revision'))::int`,
      rechazados: sql<number>`(count(*) filter (where ${payments.estado} = 'rechazado' and ${enRango(payments.createdAt)}))::int`,
    })
    .from(payments);

  const [errores] = await db
    .select({ cantidad: sql<number>`count(*)::int` })
    .from(paymentEvents)
    .where(
      and(
        desde ? gte(paymentEvents.createdAt, desde) : undefined,
        hasta ? lt(paymentEvents.createdAt, hasta) : undefined,
        sql`${paymentEvents.error} is not null`,
      ),
    );

  const mes = { total: totales?.totalMes, cantidad: totales?.cantidadMes };
  const revision = {
    total: totales?.totalRevision,
    cantidad: totales?.cantidadRevision,
  };
  const rechazados = { cantidad: totales?.rechazados };

  return {
    acreditadoMes: Number(mes?.total ?? 0),
    cantidadMes: mes?.cantidad ?? 0,
    enRevision: revision?.cantidad ?? 0,
    montoEnRevision: Number(revision?.total ?? 0),
    rechazadosMes: rechazados?.cantidad ?? 0,
    enVivo: cobrosEnVivo(),
    avisosConError: errores?.cantidad ?? 0,
  };
}

export interface AvisoListado {
  id: string;
  proveedor: string;
  eventoId: string;
  tipo: string | null;
  firmaValida: string | null;
  error: string | null;
  procesadoAt: Date | null;
  createdAt: Date;
}

/**
 * Últimos avisos recibidos.
 *
 * Es la pantalla a la que ir cuando un cliente dice que pagó y el pedido sigue
 * pendiente: o el aviso no llegó, o llegó y falló, y las dos respuestas están
 * acá.
 */
export async function ultimosAvisos(limite = 20): Promise<AvisoListado[]> {
  await requireStaff();

  return db
    .select({
      id: paymentEvents.id,
      proveedor: paymentEvents.proveedor,
      eventoId: paymentEvents.eventoId,
      tipo: paymentEvents.tipo,
      firmaValida: paymentEvents.firmaValida,
      error: paymentEvents.error,
      procesadoAt: paymentEvents.procesadoAt,
      createdAt: paymentEvents.createdAt,
    })
    .from(paymentEvents)
    .orderBy(desc(paymentEvents.createdAt))
    .limit(limite);
}

export async function obtenerDatosBancarios() {
  await requireStaff();
  const [fila] = await db.select().from(datosBancarios).limit(1);
  return fila ?? null;
}
