import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cheques,
  customers,
  supplierPayments,
  supplierPaymentParts,
  suppliers,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

/**
 * La cartera de cheques.
 *
 * La pregunta que contesta es "qué vence cuándo": un cheque a 90 días es
 * plata que todavía no existe, y la de esta semana es la que hay que salir a
 * depositar.
 */

export interface ChequeListado {
  id: string;
  sentido: "recibido" | "entregado";
  tipo: "fisico" | "echeq";
  numero: string;
  banco: string | null;
  librador: string | null;
  fechaPago: Date;
  importe: number;
  estado: string;
  cliente: string | null;
  customerId: string | null;
  circuito: string;
  /** A qué proveedor se le entregó, si salió en un pago. */
  proveedor: string | null;
  notas: string | null;
}

export async function listarCheques(
  filtros: { estado?: string; sentido?: string } = {},
): Promise<ChequeListado[]> {
  await requireStaff();

  const condiciones = [];
  if (filtros.estado && filtros.estado !== "todos") {
    condiciones.push(eq(cheques.estado, filtros.estado as never));
  }
  if (filtros.sentido && filtros.sentido !== "todos") {
    condiciones.push(eq(cheques.sentido, filtros.sentido as never));
  }

  const filas = await db
    .select({
      id: cheques.id,
      sentido: cheques.sentido,
      tipo: cheques.tipo,
      numero: cheques.numero,
      banco: cheques.banco,
      librador: cheques.librador,
      fechaPago: cheques.fechaPago,
      importe: cheques.importe,
      estado: cheques.estado,
      cliente: customers.nombre,
      customerId: cheques.customerId,
      circuito: cheques.circuito,
      /*
       * De dónde vino y a dónde fue.
       *
       * El schema guardaba las dos puntas desde el principio y la pantalla no
       * mostraba ninguna: un cheque rechazado obligaba a adivinar de qué
       * cliente era, que es justo el momento en que hay que llamarlo.
       */
      proveedor: suppliers.nombre,
      notas: cheques.notas,
    })
    .from(cheques)
    .leftJoin(customers, eq(customers.id, cheques.customerId))
    /*
     * El camino al proveedor va por el renglón del pago: un pago a proveedor se
     * puede partir en una transferencia y dos cheques, y es ese renglón el que
     * apunta al cheque. Por eso son dos saltos y no una columna en `cheques`.
     */
    .leftJoin(supplierPaymentParts, eq(supplierPaymentParts.chequeId, cheques.id))
    .leftJoin(
      supplierPayments,
      eq(supplierPayments.id, supplierPaymentParts.paymentId),
    )
    .leftJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    // Lo vivo primero y por vencimiento: es el orden en el que se decide.
    .orderBy(
      sql`case when ${cheques.estado} in ('cartera', 'depositado', 'entregado') then 0 else 1 end`,
      asc(cheques.fechaPago),
      desc(cheques.createdAt),
    );

  return filas.map((f) => ({ ...f, importe: Number(f.importe) }));
}

/** Los recibidos que siguen en el cajón, para endosarlos en un pago. */
export async function chequesEnCartera() {
  await requireStaff();

  const filas = await db
    .select({
      id: cheques.id,
      numero: cheques.numero,
      banco: cheques.banco,
      fechaPago: cheques.fechaPago,
      importe: cheques.importe,
      cliente: customers.nombre,
    })
    .from(cheques)
    .leftJoin(customers, eq(customers.id, cheques.customerId))
    .where(and(eq(cheques.estado, "cartera"), eq(cheques.sentido, "recibido")))
    .orderBy(asc(cheques.fechaPago));

  return filas.map((f) => ({ ...f, importe: Number(f.importe) }));
}
