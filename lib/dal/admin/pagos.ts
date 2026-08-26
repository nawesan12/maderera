import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";
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

export async function resumenPagos(): Promise<ResumenPagos> {
  await requireStaff();

  const inicioDeMes = new Date();
  inicioDeMes.setDate(1);
  inicioDeMes.setHours(0, 0, 0, 0);

  const [mes] = await db
    .select({
      total: sql<string>`coalesce(sum(${payments.monto}), 0)`,
      cantidad: sql<number>`count(*)::int`,
    })
    .from(payments)
    .where(
      and(eq(payments.estado, "aprobado"), gte(payments.acreditadoAt, inicioDeMes)),
    );

  const [revision] = await db
    .select({
      total: sql<string>`coalesce(sum(${payments.monto}), 0)`,
      cantidad: sql<number>`count(*)::int`,
    })
    .from(payments)
    .where(eq(payments.estado, "en_revision"));

  const [rechazados] = await db
    .select({ cantidad: sql<number>`count(*)::int` })
    .from(payments)
    .where(
      and(eq(payments.estado, "rechazado"), gte(payments.createdAt, inicioDeMes)),
    );

  const [errores] = await db
    .select({ cantidad: sql<number>`count(*)::int` })
    .from(paymentEvents)
    .where(
      and(
        gte(paymentEvents.createdAt, inicioDeMes),
        sql`${paymentEvents.error} is not null`,
      ),
    );

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
