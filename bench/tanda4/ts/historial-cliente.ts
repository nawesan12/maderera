import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  accountMovements,
  cheques,
  orders,
  payments,
  receiptParts,
  receipts,
} from "@/lib/db/schema";
import { nombreDelCheque } from "@/lib/cheques/numero";
import { NOMBRE_DEL_MEDIO } from "@/lib/cobros/partes";

/**
 * Todo lo que pasó con la plata de un cliente, en una sola línea de tiempo.
 *
 * De la clienta (30/9/2026): «agregar movimientos normales al usuario». Hasta
 * acá el cliente veía el libro de su cuenta corriente —y solo si tenía
 * crédito—, y nada más: una compra de contado, una transferencia que informó
 * y está en revisión, un cheque que mandó y todavía nadie aceptó, no
 * aparecían en ningún lado. La pregunta «¿les llegó mi transferencia?» se
 * contestaba por WhatsApp.
 *
 * Junta cuatro fuentes, y dice de cada renglón si **mueve el saldo** o no:
 *
 * - El libro (`account_movements`): compras a cuenta, pagos —con su recibo—,
 *   notas de crédito y débito, ajustes. Lo único que mueve el saldo.
 * - Las compras de contado: no deben nada, pero son compras.
 * - Los pagos informados que no se acreditaron: en revisión, o rechazados con
 *   su motivo.
 * - Los cheques que no entraron al libro: por recibir, o rechazados al
 *   recibirlos.
 *
 * **No controla acceso**: lo usan Mi cuenta (con el cliente de la sesión) y la
 * ficha del panel (con `requireStaff`), que ya saben quién pide.
 */

export type ClaseDeMovimiento =
  | "compra"
  | "pago"
  | "nota_credito"
  | "nota_debito"
  | "ajuste"
  | "compra_contado"
  | "pago_en_revision"
  | "pago_rechazado"
  | "cheque_por_recibir"
  | "cheque_rechazado";

export interface MovimientoDelCliente {
  id: string;
  fecha: Date;
  clase: ClaseDeMovimiento;
  titulo: string;
  detalle: string | null;
  /** Con signo: positivo suma deuda. Nulo en lo que no mueve la cuenta. */
  importe: number | null;
  /** El importe de lo que no mueve la cuenta, para mostrarlo igual. */
  importeInformativo: number | null;
  pedido: { id: string; numero: string } | null;
  recibo: { id: string; numero: string; anulado: boolean } | null;
}

/** Los filtros que entiende la línea de tiempo. */
export type FiltroDeMovimientos = "todo" | "compras" | "pagos" | "cheques" | "ajustes";

const CLASES_POR_FILTRO: Record<FiltroDeMovimientos, ClaseDeMovimiento[] | null> = {
  todo: null,
  compras: ["compra", "compra_contado"],
  pagos: ["pago", "pago_en_revision", "pago_rechazado"],
  cheques: ["cheque_por_recibir", "cheque_rechazado", "nota_debito"],
  ajustes: ["ajuste", "nota_credito", "nota_debito"],
};

const TITULO_DEL_LIBRO: Record<string, string> = {
  compra: "Compra a cuenta",
  pago: "Pago",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  ajuste: "Ajuste",
};

const MEDIO_INFORMADO: Record<string, string> = {
  transferencia: "Transferencia",
  deposito: "Depósito",
};

export async function historialDelCliente(
  customerId: string,
  opciones: { desde?: Date | null; filtro?: FiltroDeMovimientos; tope?: number } = {},
): Promise<{ movimientos: MovimientoDelCliente[]; hayMas: boolean }> {
  const desde = opciones.desde ?? null;
  const tope = opciones.tope ?? 200;
  const enPeriodo = (columna: PgColumn) => (desde ? gte(columna, desde) : undefined);

  const [libro, contado, informados, chequesSueltos] = await Promise.all([
    db
      .select({
        id: accountMovements.id,
        fecha: accountMovements.createdAt,
        tipo: accountMovements.tipo,
        monto: accountMovements.monto,
        detalle: accountMovements.detalle,
        referencia: accountMovements.referencia,
        pedidoId: orders.id,
        reciboId: receipts.id,
        reciboNumero: receipts.numero,
        reciboEstado: receipts.estado,
      })
      .from(accountMovements)
      // `referencia` guarda el número del pedido como texto: el enlace sale de
      // ahí, igual que en la ficha del panel.
      .leftJoin(orders, eq(orders.numero, accountMovements.referencia))
      .leftJoin(receipts, eq(receipts.id, accountMovements.receiptId))
      .where(and(eq(accountMovements.customerId, customerId), enPeriodo(accountMovements.createdAt)))
      .orderBy(desc(accountMovements.createdAt))
      .limit(tope + 1),

    // Lo de contado: lo que no se cargó a la cuenta. El pedido a cuenta
    // corriente ya está en el libro como «compra», y contarlo dos veces
    // haría que el cliente vea la misma compra en dos renglones.
    db
      .select({
        id: orders.id,
        fecha: orders.createdAt,
        numero: orders.numero,
        total: orders.total,
        estadoPago: orders.estadoPago,
        medioPago: orders.medioPago,
      })
      .from(orders)
      .where(
        and(
          eq(orders.customerId, customerId),
          or(isNull(orders.medioPago), ne(orders.medioPago, "cuenta_corriente")),
          ne(orders.estado, "cancelado"),
          enPeriodo(orders.createdAt),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(tope + 1),

    // Lo que el cliente informó y no se acreditó. Lo acreditado ya está en el
    // libro con su recibo.
    db
      .select({
        id: payments.id,
        fecha: payments.createdAt,
        monto: payments.monto,
        estado: payments.estado,
        medio: payments.medio,
        motivo: payments.motivoRechazo,
      })
      .from(payments)
      .where(
        and(
          eq(payments.customerId, customerId),
          eq(payments.tipo, "deuda"),
          inArray(payments.estado, ["en_revision", "rechazado"]),
          enPeriodo(payments.createdAt),
        ),
      )
      .orderBy(desc(payments.createdAt)),

    // Los cheques que no llegaron al libro: el que espera que lo acepten, y el
    // que se rechazó al recibirlo (nunca bajó la deuda). El rechazado por el
    // banco sí está en el libro, como nota de débito.
    db
      .select({
        id: cheques.id,
        fecha: cheques.updatedAt,
        tipo: cheques.tipo,
        numero: cheques.numero,
        banco: cheques.banco,
        importe: cheques.importe,
        estado: cheques.estado,
        fechaPago: cheques.fechaPago,
        motivo: cheques.motivoRechazo,
      })
      .from(cheques)
      .where(
        and(
          eq(cheques.customerId, customerId),
          eq(cheques.sentido, "recibido"),
          or(
            eq(cheques.estado, "informado"),
            and(eq(cheques.estado, "rechazado"), isNull(cheques.receiptId)),
          ),
          enPeriodo(cheques.createdAt),
        ),
      )
      .orderBy(asc(cheques.fechaPago)),
  ]);

  // Con qué se pagó cada recibo, en una consulta para todos: «Efectivo $50.000
  // · Cheque BBVA N° 87654321». Es lo primero que se pregunta de un pago.
  const recibosDelLibro = [...new Set(libro.map((m) => m.reciboId).filter((r): r is string => Boolean(r)))];
  const partes = recibosDelLibro.length
    ? await db
        .select({
          receiptId: receiptParts.receiptId,
          medio: receiptParts.medio,
          importe: receiptParts.importe,
          banco: cheques.banco,
          numero: cheques.numero,
          tipo: cheques.tipo,
        })
        .from(receiptParts)
        .leftJoin(cheques, eq(cheques.id, receiptParts.chequeId))
        .where(inArray(receiptParts.receiptId, recibosDelLibro))
        .orderBy(asc(receiptParts.orden))
    : [];
  const mediosPorRecibo = new Map<string, string>();
  for (const p of partes) {
    const texto = p.numero
      ? `${nombreDelCheque({ tipo: p.tipo, banco: p.banco, numero: p.numero })} ${PESOS.format(Number(p.importe))}`
      : `${NOMBRE_DEL_MEDIO[p.medio]} ${PESOS.format(Number(p.importe))}`;
    const previo = mediosPorRecibo.get(p.receiptId);
    mediosPorRecibo.set(p.receiptId, previo ? `${previo} · ${texto}` : texto);
  }

  const movimientos: MovimientoDelCliente[] = [
    ...libro.slice(0, tope).map((m): MovimientoDelCliente => ({
      id: m.id,
      fecha: m.fecha,
      clase: m.tipo,
      titulo:
        m.tipo === "pago" && m.reciboId
          ? conceptoDelPago(m.detalle, m.reciboNumero)
          : TITULO_DEL_LIBRO[m.tipo] ?? m.tipo,
      detalle: m.tipo === "pago" && m.reciboId ? (mediosPorRecibo.get(m.reciboId) ?? null) : m.detalle,
      importe: Number(m.monto),
      importeInformativo: null,
      pedido: m.pedidoId && m.referencia ? { id: m.pedidoId, numero: m.referencia } : null,
      recibo: m.reciboId
        ? { id: m.reciboId, numero: m.reciboNumero!, anulado: m.reciboEstado === "anulado" }
        : null,
    })),
    ...contado.slice(0, tope).map((p): MovimientoDelCliente => ({
      id: p.id,
      fecha: p.fecha,
      clase: "compra_contado",
      titulo: `Compra ${p.numero}`,
      detalle: p.estadoPago === "pagado" ? "Pagada en el momento" : "Pago pendiente",
      importe: null,
      importeInformativo: Number(p.total),
      pedido: { id: p.id, numero: p.numero },
      recibo: null,
    })),
    ...informados.map((p): MovimientoDelCliente => ({
      id: p.id,
      fecha: p.fecha,
      clase: p.estado === "rechazado" ? "pago_rechazado" : "pago_en_revision",
      titulo: `${MEDIO_INFORMADO[p.medio ?? ""] ?? "Transferencia"} informada`,
      detalle:
        p.estado === "rechazado"
          ? `No se acreditó${p.motivo ? `: ${p.motivo}` : ""}`
          : "La estamos verificando en el banco",
      importe: null,
      importeInformativo: Number(p.monto),
      pedido: null,
      recibo: null,
    })),
    ...chequesSueltos.map((c): MovimientoDelCliente => ({
      id: c.id,
      fecha: c.fecha,
      clase: c.estado === "informado" ? "cheque_por_recibir" : "cheque_rechazado",
      titulo: nombreDelCheque(c),
      detalle:
        c.estado === "informado"
          ? `Por recibir · al ${c.fechaPago.toLocaleDateString("es-AR")}`
          : `No lo pudimos tomar${c.motivo ? `: ${c.motivo}` : ""}`,
      importe: null,
      importeInformativo: Number(c.importe),
      pedido: null,
      recibo: null,
    })),
  ];

  const clases = CLASES_POR_FILTRO[opciones.filtro ?? "todo"];
  const filtrados = clases ? movimientos.filter((m) => clases.includes(m.clase)) : movimientos;
  filtrados.sort((a, b) => b.fecha.getTime() - a.fecha.getTime());

  return {
    movimientos: filtrados.slice(0, tope),
    hayMas: libro.length > tope || contado.length > tope || filtrados.length > tope,
  };
}

const PESOS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/**
 * El concepto de un pago sin el «— recibo REC-0001» que lleva el detalle del
 * libro: el número ya está en el enlace al recibo, y repetido tres veces en un
 * renglón no se lee.
 */
function conceptoDelPago(detalle: string | null, recibo: string | null): string {
  if (!detalle) return "Pago";
  const sinRecibo = recibo ? detalle.replace(` — recibo ${recibo}`, "").replace(`Recibo ${recibo}`, "") : detalle;
  return sinRecibo.trim() || "Pago";
}

/** El saldo de la cuenta, sumado. Se usa junto con el historial. */
export async function saldoDelCliente(customerId: string): Promise<number> {
  const [fila] = await db
    .select({ saldo: sql<string>`coalesce(sum(${accountMovements.monto}), 0)` })
    .from(accountMovements)
    .where(eq(accountMovements.customerId, customerId));
  return Number(fila?.saldo ?? 0);
}

/** «Últimos 3 meses», «último año», «todo»: el período que se elige en pantalla. */
export function desdeDelPeriodo(periodo: string | undefined, hoy = new Date()): Date | null {
  if (periodo === "todo") return null;
  const meses = periodo === "3m" ? 3 : periodo === "6m" ? 6 : 12;
  const desde = new Date(hoy);
  desde.setMonth(desde.getMonth() - meses);
  return desde;
}
