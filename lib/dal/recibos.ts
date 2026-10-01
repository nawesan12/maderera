import "server-only";

import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  cheques,
  customers,
  receiptParts,
  receipts,
  user,
} from "@/lib/db/schema";
import type { MedioDeCobro } from "@/lib/cobros/partes";

export interface ParteDelRecibo {
  medio: MedioDeCobro;
  importe: number;
  referencia: string | null;
  cheque: {
    id: string;
    tipo: "fisico" | "echeq";
    numero: string;
    banco: string | null;
    librador: string | null;
    fechaPago: Date;
    estado: string;
  } | null;
}

export interface ReciboCompleto {
  id: string;
  numero: string;
  fecha: Date;
  estado: "emitido" | "anulado";
  origen: string;
  concepto: string | null;
  total: number;
  recibidoDe: string;
  motivoAnulacion: string | null;
  anuladoAt: Date | null;
  cliente: { id: string; cuit: string | null; direccion: string | null } | null;
  partes: ParteDelRecibo[];
  /**
   * Cómo quedó la cuenta después de este pago, sumando hasta él.
   *
   * Se suma y no se guarda, como todo saldo del proyecto. Es la línea que el
   * cliente mira primero en el papel: «¿cuánto me queda?».
   */
  saldoDespues: number | null;
  emitidoPor: string | null;
}

/**
 * Un recibo con todo lo que hace falta para imprimirlo.
 *
 * **No controla acceso**: lo hacen la ruta del PDF y la página de impresión,
 * que saben quién pide. Así la misma lectura sirve para el panel y para Mi
 * cuenta sin dos versiones.
 */
export async function reciboCompleto(id: string): Promise<ReciboCompleto | null> {
  const [fila] = await db
    .select({
      id: receipts.id,
      numero: receipts.numero,
      fecha: receipts.createdAt,
      estado: receipts.estado,
      origen: receipts.origen,
      concepto: receipts.concepto,
      total: receipts.total,
      recibidoDe: receipts.recibidoDe,
      motivoAnulacion: receipts.motivoAnulacion,
      anuladoAt: receipts.anuladoAt,
      customerId: receipts.customerId,
      accountMovementId: receipts.accountMovementId,
      cuit: customers.cuit,
      direccion: customers.direccion,
      emitidoPor: user.name,
    })
    .from(receipts)
    .leftJoin(customers, eq(customers.id, receipts.customerId))
    .leftJoin(user, eq(user.id, receipts.createdByUserId))
    .where(eq(receipts.id, id))
    .limit(1);

  if (!fila) return null;

  const partes = await db
    .select({
      medio: receiptParts.medio,
      importe: receiptParts.importe,
      referencia: receiptParts.referencia,
      chequeId: cheques.id,
      tipo: cheques.tipo,
      numero: cheques.numero,
      banco: cheques.banco,
      librador: cheques.librador,
      fechaPago: cheques.fechaPago,
      estadoCheque: cheques.estado,
    })
    .from(receiptParts)
    .leftJoin(cheques, eq(cheques.id, receiptParts.chequeId))
    .where(eq(receiptParts.receiptId, id))
    .orderBy(asc(receiptParts.orden));

  let saldoDespues: number | null = null;
  if (fila.customerId && fila.accountMovementId) {
    /*
     * La fecha del pago se compara **dentro de la base**. Traerla a un `Date`
     * y devolverla perdía los microsegundos de Postgres, y el propio pago
     * quedaba afuera de la suma: el recibo decía que la cuenta seguía igual
     * que antes de pagar.
     */
    const [suma] = await db
      .select({ saldo: sql<string>`coalesce(sum(${accountMovements.monto}), 0)` })
      .from(accountMovements)
      .where(
        and(
          eq(accountMovements.customerId, fila.customerId),
          lte(
            accountMovements.createdAt,
            sql`(select created_at from account_movements where id = ${fila.accountMovementId})`,
          ),
        ),
      );
    saldoDespues = Number(suma?.saldo ?? 0);
  }

  return {
    id: fila.id,
    numero: fila.numero,
    fecha: fila.fecha,
    estado: fila.estado,
    origen: fila.origen,
    concepto: fila.concepto,
    total: Number(fila.total),
    recibidoDe: fila.recibidoDe,
    motivoAnulacion: fila.motivoAnulacion,
    anuladoAt: fila.anuladoAt,
    cliente: fila.customerId
      ? { id: fila.customerId, cuit: fila.cuit, direccion: fila.direccion }
      : null,
    partes: partes.map((p) => ({
      medio: p.medio,
      importe: Number(p.importe),
      referencia: p.referencia,
      cheque: p.chequeId
        ? {
            id: p.chequeId,
            tipo: p.tipo!,
            numero: p.numero!,
            banco: p.banco,
            librador: p.librador,
            fechaPago: p.fechaPago!,
            estado: p.estadoCheque!,
          }
        : null,
    })),
    saldoDespues,
    emitidoPor: fila.emitidoPor,
  };
}

/** De quién es un recibo, para la regla de propiedad de las descargas. */
export async function clienteDelRecibo(id: string): Promise<string | null | undefined> {
  const [fila] = await db
    .select({ customerId: receipts.customerId })
    .from(receipts)
    .where(eq(receipts.id, id))
    .limit(1);
  return fila ? fila.customerId : undefined;
}
